import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../../src/services/principal';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** Real HTTP + real PostgreSQL. Service categories and credential names are EXAMPLES. */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let proToken: string, otherProToken: string;
let requestId: string, quoteId: string, jobId: string, checkinCode: string;
const future = () => new Date(Date.now() + 3 * 86400_000).toISOString();

async function newUser(name: string) {
  return env.db.system(async tx => {
    const id = (await tx.query(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
    return createSession(tx, id);
  });
}

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  proToken = await newUser('Usta Ali');
  otherProToken = await newUser('Gazcı Veli');
});
afterAll(async () => { await env?.close(); });

const reviewer = () => client(env, platform.marketReviewer.token);
const pro = () => client(env, proToken);
const owner = () => client(env, demo.users.owner.token);
const C = () => `/companies/${demo.companyId}`;

describe('professional profile and authorization', () => {
  it('opening a profile grants nothing', async () => {
    expect((await pro().post('/pro/profile', { kind: 'individual', displayName: 'Usta Ali', headline: 'Soğutma', city: 'İstanbul' })).status).toBe(200);
    const inbox = (await pro().get('/pro/inbox')).body;
    expect(inbox.requests).toEqual([]);
    expect((await owner().get(`${C()}/providers?category=refrigeration_service`)).body).toEqual([]);
  });

  it('identity verification alone does not authorize a category', async () => {
    const id = (await pro().post('/pro/verifications', { kind: 'identity', issuer: 'T.C. kimlik', documentRef: 'K-1' })).body;
    const authReq = (await pro().post('/pro/authorizations', { categoryCode: 'refrigeration_service' })).body;
    expect((await pro().post(`/admin/marketplace/verifications/${id.id}/decide`, { decision: 'verified', checkMethod: 'kendim baktım' })).status).toBe(403);
    expect((await reviewer().post(`/admin/marketplace/verifications/${id.id}/decide`, { decision: 'verified', checkMethod: 'e-Devlet sorgusu' })).status).toBe(200);
    const r = await reviewer().post(`/admin/marketplace/authorizations/${authReq.id}/decide`, { decision: 'approved', reason: 'Kimlik tamam' });
    expect(r.body.error.code).toBe('CREDENTIALS_MISSING');
    expect(r.body.error.details.missing).toEqual(['refrigeration_technician']);
  });

  it('an expired credential does not count; a valid one does, and the basis is recorded', async () => {
    const old = (await pro().post('/pro/verifications', { kind: 'credential', credentialType: 'refrigeration_technician', issuer: 'Örnek kurum', documentRef: 'B-OLD', validUntil: '2020-01-01' })).body;
    await reviewer().post(`/admin/marketplace/verifications/${old.id}/decide`, { decision: 'verified', checkMethod: 'Belge numarası sorgusu' });
    const queue = (await reviewer().get('/admin/marketplace/queue')).body;
    const authId = queue.authorizations[0].id;
    expect((await reviewer().post(`/admin/marketplace/authorizations/${authId}/decide`, { decision: 'approved', reason: 'deneme' })).body.error.code).toBe('CREDENTIALS_MISSING');
    const cur = (await pro().post('/pro/verifications', { kind: 'credential', credentialType: 'refrigeration_technician', issuer: 'Örnek kurum', documentRef: 'B-NEW', validUntil: '2031-01-01' })).body;
    await reviewer().post(`/admin/marketplace/verifications/${cur.id}/decide`, { decision: 'verified', checkMethod: 'Belge numarası sorgusu' });
    expect((await reviewer().post(`/admin/marketplace/authorizations/${authId}/decide`, { decision: 'approved', reason: 'Kimlik ve güncel belge doğrulandı' })).status).toBe(200);
    const basis = (await env.ownerDb.query(`SELECT basis_verification_ids FROM service_authorizations WHERE id = $1`, [authId])).rows[0].basis_verification_ids;
    expect(basis).toContain(cur.id);
    expect(basis).not.toContain(old.id);
  });

  it('the public profile shows each check separately and says identity is not competence', async () => {
    const mine = (await pro().get('/pro/profile')).body;
    const view = (await owner().get(`/professionals/${mine.profile.id}`)).body;
    expect(view.identity.status).toBe('verified');
    expect(view.credentials.find((c: any) => c.document_ref === undefined && c.expired)).toBeTruthy();
    expect(view.authorizedCategories.map((a: any) => a.category_code)).toEqual(['refrigeration_service']);
    expect(view.disclaimer).toContain('mesleki yetkinlik onayı değildir');
    expect(view.notChecked.length).toBeGreaterThan(0);
  });
});

describe('request → quote → job → acceptance', () => {
  it('a business opens a request; only authorized providers see it, without the business name', async () => {
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Buzdolabı soğutmuyor', description: 'Mutfak arkadaki dolap 12 °C gösteriyor.', city: 'İstanbul' });
    expect(r.status).toBe(201);
    requestId = r.body.id;
    const providers = (await owner().get(`${C()}/providers?category=refrigeration_service`)).body;
    expect(providers.every((x: any) => x.sponsored === false)).toBe(true);
    const inbox = (await pro().get('/pro/inbox')).body;
    expect(inbox.requests.map((x: any) => x.id)).toEqual([requestId]);
    expect(JSON.stringify(inbox.requests)).not.toContain('Kahve Durağı');
    // A profile without this category sees nothing and cannot quote.
    await client(env, otherProToken).post('/pro/profile', { kind: 'individual', displayName: 'Gazcı Veli', city: 'İstanbul' });
    expect((await client(env, otherProToken).get('/pro/inbox')).body.requests).toEqual([]);
    expect((await client(env, otherProToken).post(`/pro/requests/${requestId}/quotes`, { scope: 'Kontrol', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: '-', durationText: '1 saat', warrantyText: 'yok', validUntil: future() })).status).toBe(404);
  });

  it('quotes use comparable fields; accepting one awards the job and states payment is out of scope', async () => {
    const q = await pro().post(`/pro/requests/${requestId}/quotes`, { scope: 'Termostat ve gaz basıncı kontrolü', exclusions: 'Kompresör değişimi', priceNet: 850, vatRate: 20,
      materials: 'Gerekirse termostat', durationText: '1–2 saat', warrantyText: '3 ay işçilik', validUntil: future() });
    expect(q.status).toBe(201);
    quoteId = q.body.id;
    const detail = (await owner().get(`${C()}/service-requests/${requestId}`)).body;
    expect(detail.quotes[0]).toMatchObject({ exclusions: 'Kompresör değişimi', price_gross: 1020 });
    const acc = await owner().post(`${C()}/quotes/${quoteId}/accept`);
    expect(acc.status).toBe(200);
    expect(acc.body.payment).toContain('uygulama dışında');
    jobId = acc.body.jobId; checkinCode = acc.body.checkinCode;
    expect((await env.ownerDb.query(`SELECT payment_status FROM service_jobs WHERE id = $1`, [jobId])).rows[0].payment_status).toBe('not_in_scope');
  });

  it('check-in only records presence; acceptance needs the report', async () => {
    expect((await pro().post(`/pro/jobs/${jobId}/check-in`, { code: '00000000' === checkinCode ? '11111111' : '00000000' })).body.error.code).toBe('CHECKIN_CODE_INVALID');
    expect((await pro().post(`/pro/jobs/${jobId}/check-in`, { code: checkinCode })).status).toBe(200);
    expect((await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: true, note: 'Geldi, tamam' })).body.error.code).toBe('REPORT_MISSING');
    expect((await pro().post(`/pro/jobs/${jobId}/report`, { report: 'kısa' })).status).toBe(422);
    expect((await pro().post(`/pro/jobs/${jobId}/report`, { report: 'Termostat değiştirildi, 30 dk sonra iç sıcaklık 3 °C ölçüldü. Kapı contası kontrol edildi.' })).status).toBe(200);
    const done = await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: true, note: 'Rapor okundu, ölçüm tekrarlandı.' });
    expect(done.body.status).toBe('accepted');
    expect((await owner().get(`${C()}/service-requests`)).body[0].status).toBe('completed');
    const inbox = (await pro().get('/pro/inbox')).body;
    expect(inbox.jobs[0]).toMatchObject({ status: 'accepted', company_name: 'Kahve Durağı (DEMO)' });
  });

  it('another business cannot see the request', async () => {
    const other = await seedDemoCompany(env.db, { name: 'Diğer Kafe' });
    expect((await client(env, other.users.owner.token).get(`/companies/${other.companyId}/service-requests/${requestId}`)).status).toBe(404);
    expect((await client(env, other.users.owner.token).get(`${C()}/service-requests`)).status).toBe(404);
  });
});
