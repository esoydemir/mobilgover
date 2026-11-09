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
    expect((await reviewer().post(`/admin/marketplace/authorizations/${authId}/decide`, { decision: 'approved', reason: 'Kimlik ve güncel belge doğrulandı', validUntil: '2030-06-30' })).status).toBe(200);
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
    expect((await client(env, otherProToken).post(`/pro/requests/${requestId}/quotes`, { scope: 'Kontrol', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: '-', durationText: '1 saat', warrantyText: 'yok', deliverable: 'Servis raporu ve ölçüm kaydı', validUntil: future() })).status).toBe(404);
  });

  it('quotes use comparable fields; accepting one awards the job and states payment is out of scope', async () => {
    const q = await pro().post(`/pro/requests/${requestId}/quotes`, { scope: 'Termostat ve gaz basıncı kontrolü', exclusions: 'Kompresör değişimi', priceNet: 850, vatRate: 20,
      materials: 'Gerekirse termostat', durationText: '1–2 saat', warrantyText: '3 ay işçilik', deliverable: 'Servis raporu ve ölçüm kaydı', validUntil: future() });
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

/**
 * Server-side controls, checked through the API rather than the screens:
 * unapproved categories, expiring approvals/credentials, and what a business shares.
 */
describe('server controls: category approval, expiry, sharing', () => {
  let tech: string, techAuthId: string, credId: string, ncrId: string;
  const quoteBody = () => ({ scope: 'Kontrol ve ayar', exclusions: 'Parça', priceNet: 500, vatRate: 20, materials: '-', durationText: '1 saat', warrantyText: '1 ay', deliverable: 'Servis raporu ve ölçüm kaydı', validUntil: future() });
  const newRequest = async (extra: Record<string, unknown> = {}) => (await owner().post(`${C()}/service-requests`,
    { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Dolap arızası', description: 'Soğutucu ısınıyor, kapı contası yırtık.', city: 'İstanbul', ...extra })).body.id as string;

  beforeAll(async () => {
    tech = await newUser('Teknisyen Can');
    await client(env, tech).post('/pro/profile', { kind: 'individual', displayName: 'Teknisyen Can', city: 'İstanbul' });
    const idv = (await client(env, tech).post('/pro/verifications', { kind: 'identity', issuer: 'T.C. kimlik', documentRef: 'K-9' })).body;
    credId = (await client(env, tech).post('/pro/verifications', { kind: 'credential', credentialType: 'refrigeration_technician', issuer: 'Örnek kurum', documentRef: 'B-9', validUntil: '2030-01-01' })).body.id;
    await reviewer().post(`/admin/marketplace/verifications/${idv.id}/decide`, { decision: 'verified', checkMethod: 'e-Devlet sorgusu' });
    await reviewer().post(`/admin/marketplace/verifications/${credId}/decide`, { decision: 'verified', checkMethod: 'Belge numarası sorgusu' });
    techAuthId = (await client(env, tech).post('/pro/authorizations', { categoryCode: 'refrigeration_service' })).body.id;
    // A nonconformity of the business, to test what is and is not shared.
    ncrId = (await env.ownerDb.query(
      `INSERT INTO nonconformities (company_id, site_id, hazard_type, title, description, risk_level, risk_rationale, depth, detected_by, emergency_instruction)
       VALUES ($1,$2,'temperature','Soğutucu 9 °C','GİZLİ-AYRINTI: personel notu','high','{}','capa',$3,'GİZLİ-TALİMAT') RETURNING id`,
      [demo.companyId, demo.siteId, demo.users.owner.id])).rows[0].id;
  });

  it('a pending, rejected or suspended category cannot quote; it looks like the request does not exist', async () => {
    const req = await newRequest();
    expect((await client(env, tech).get('/pro/inbox')).body.requests).toEqual([]);
    expect((await client(env, tech).post(`/pro/requests/${req}/quotes`, quoteBody())).status).toBe(404); // pending
    await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'rejected', reason: 'Belge okunaksız' });
    expect((await client(env, tech).post(`/pro/requests/${req}/quotes`, quoteBody())).status).toBe(404); // rejected
  });

  it('an approval needs an end date that does not outlast its documents', async () => {
    expect((await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'approved', reason: 'Belgeler tamam' })).status).toBe(422);
    const tooLong = await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'approved', reason: 'Belgeler tamam', validUntil: '2031-01-01' });
    expect(tooLong.body.error).toMatchObject({ code: 'VALIDITY_EXCEEDS_CREDENTIAL', details: { cap: '2030-01-01' } });
    expect((await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'approved', reason: 'Belgeler tamam', validUntil: '2029-12-31' })).status).toBe(200);
    const req = await newRequest();
    expect((await client(env, tech).post(`/pro/requests/${req}/quotes`, quoteBody())).status).toBe(201);
    // Suspension stops new work at once.
    await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'suspended', reason: 'Şikâyet inceleniyor' });
    expect((await client(env, tech).post(`/pro/requests/${await newRequest()}/quotes`, quoteBody())).status).toBe(404);
    await reviewer().post(`/admin/marketplace/authorizations/${techAuthId}/decide`, { decision: 'approved', reason: 'İnceleme kapandı', validUntil: '2029-12-31' });
  });

  it('when the approval ends: no inbox, no new quote, no listing, and an earlier quote can no longer be accepted', async () => {
    const req = await newRequest();
    const q = (await client(env, tech).post(`/pro/requests/${req}/quotes`, quoteBody())).body.id;
    // Time passes: the approval's end date is now in the past.
    await env.ownerDb.query(`UPDATE service_authorizations SET valid_until = current_date - 1 WHERE id = $1`, [techAuthId]);
    const inbox = (await client(env, tech).get('/pro/inbox')).body;
    expect(inbox.requests).toEqual([]);
    expect(inbox.authorizations[0]).toMatchObject({ category_code: 'refrigeration_service', expired: true });
    const r = await client(env, tech).post(`/pro/requests/${await newRequest()}/quotes`, quoteBody());
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('AUTHORIZATION_EXPIRED');
    const providers = (await owner().get(`${C()}/providers?category=refrigeration_service`)).body;
    expect(providers.map((p: any) => p.display_name)).not.toContain('Teknisyen Can');
    const acc = await owner().post(`${C()}/quotes/${q}/accept`);
    expect(acc.status).toBe(409);
    expect(acc.body.error.code).toBe('PROVIDER_NOT_AUTHORIZED');
    const profileId = (await client(env, tech).get('/pro/profile')).body.profile.id;
    expect((await owner().get(`/professionals/${profileId}`)).body.authorizedCategories).toEqual([]);
    await env.ownerDb.query(`UPDATE service_authorizations SET valid_until = '2029-12-31' WHERE id = $1`, [techAuthId]);
  });

  it('when a basis document expires, new work stops even if the approval date has not passed', async () => {
    await env.ownerDb.query(`UPDATE professional_verifications SET valid_until = current_date - 1 WHERE id = $1`, [credId]);
    expect((await client(env, tech).get('/pro/inbox')).body.requests).toEqual([]);
    expect((await client(env, tech).post(`/pro/requests/${await newRequest()}/quotes`, quoteBody())).body.error.code).toBe('AUTHORIZATION_EXPIRED');
    await env.ownerDb.query(`UPDATE professional_verifications SET valid_until = '2030-01-01' WHERE id = $1`, [credId]);
  });

  it('a provider sees only what the business chose to share, and never the business records', async () => {
    const hidden = await newRequest({ ncrId });
    const shared = await newRequest({ ncrId, shareNcrSummary: true });
    expect((await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'x x x', description: 'y y y y y', city: 'İstanbul', shareNcrSummary: true })).status).toBe(422);
    const inbox = (await client(env, tech).get('/pro/inbox')).body.requests;
    expect(inbox.find((r: any) => r.id === hidden).shared_ncr).toBeNull();
    expect(inbox.find((r: any) => r.id === shared).shared_ncr).toEqual({ title: 'Soğutucu 9 °C', riskLevel: 'high', hazardType: 'temperature' });
    const raw = JSON.stringify(inbox);
    for (const secret of ['GİZLİ-AYRINTI', 'GİZLİ-TALİMAT', 'Kahve Durağı', ncrId]) expect(raw).not.toContain(secret);
    // What was shared is recorded with the request.
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE entity_id = $1 AND event_type = 'service.requested'`, [shared])).rows[0].payload;
    expect(ev.sharedWithProviders).toEqual(expect.arrayContaining(['ncr.title', 'ncr.risk_level']));

    // Before and after the award, the provider has no access to the business's own records.
    const probe = async () => {
      const paths = ['/nonconformities', `/nonconformities/${ncrId}`, '/tasks', '/obligations', `/sites/${demo.siteId}/profile`, `/sites/${demo.siteId}/equipment`,
        '/indicators', '/audit-export', '/members', '/service-requests', `/service-requests/${shared}`];
      for (const p of paths) expect([p, (await client(env, tech).get(`${C()}${p}`)).status]).toEqual([p, 404]);
    };
    await probe();
    const q = (await client(env, tech).post(`/pro/requests/${shared}/quotes`, quoteBody())).body.id;
    const acc = await owner().post(`${C()}/quotes/${q}/accept`);
    expect(acc.status).toBe(200);
    await probe();
    const job = (await client(env, tech).get('/pro/inbox')).body.jobs.find((j: any) => j.id === acc.body.jobId);
    expect(Object.keys(job).sort()).toEqual(['accepted_at', 'business_note', 'cancel_reason', 'checked_in_at', 'city', 'company_name', 'id', 'report_submitted_at', 'site_name', 'status', 'title']);
  });
});
