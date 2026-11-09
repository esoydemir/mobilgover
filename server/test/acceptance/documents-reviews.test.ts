import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { scanDocumentExpiry } from '../../src/services/documents';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Document vault (types, links, versions, validity, review, reminders) and reviews of
 * delivered services (only accepted jobs; shown on the provider profile only if allowed).
 * Real HTTP + PostgreSQL. Document types and the 30-day window are EXAMPLES.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let provider: { id: string; token: string };
let otherManager: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const notes = async (userId: string, kind: string) => (await env.ownerDb.query(
  `SELECT entity_id, dedupe_key FROM notifications WHERE user_id = $1 AND kind = $2`, [userId, kind])).rows;
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  provider = await seedDemoProvider(env.db, platform.marketReviewer.id);
  otherManager = await env.db.system(async tx => {
    const s = (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Beşiktaş') RETURNING id`, [demo.companyId])).rows[0].id;
    const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Kerem (Beşiktaş müdürü)', 'kerem.doc@ornek.test') RETURNING id`)).rows[0].id;
    await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,$3,'site_manager','active',now())`, [u, demo.companyId, s]);
    return { id: u as string, token: await createSession(tx, u) };
  });
});
afterAll(async () => { await env?.close(); });

describe('document vault', () => {
  let calib: string, license: string, v1: { versionId: string; evidenceId: string };

  it('documents are typed and linked to the business, a site or a piece of equipment; staff and other sites cannot add', async () => {
    const c = await manager().post(`${C()}/documents`, { docType: 'calibration_certificate', title: 'Soğutucu termometre kalibrasyonu', equipmentId: demo.fridgeId, issuer: 'Örnek Lab' });
    expect(c.status).toBe(201);
    calib = c.body.id;
    // A site manager cannot add a company-wide document; the owner can.
    expect((await manager().post(`${C()}/documents`, { docType: 'business_license', title: 'İşyeri açma ruhsatı' })).status).toBe(403);
    const l = await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'İşyeri açma ruhsatı', siteId: demo.siteId });
    expect(l.status).toBe(201);
    license = l.body.id;
    expect((await staff().post(`${C()}/documents`, { docType: 'other', title: 'Deneme', siteId: demo.siteId })).status).toBe(403);
    expect((await client(env, otherManager.token).post(`${C()}/documents`, { docType: 'other', title: 'Deneme', siteId: demo.siteId })).status).toBe(403);
    expect((await manager().post(`${C()}/documents`, { docType: 'made_up', title: 'Deneme', siteId: demo.siteId })).status).toBe(422);
    const d = (await manager().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ siteId: demo.siteId, equipmentId: demo.fridgeId, status: 'no_file' });
    expect((await client(env, otherManager.token).get(`${C()}/documents/${calib}`)).status).toBe(404);
    expect((await client(env, demo.users.expert.token).get(`${C()}/documents/${calib}`)).status).toBe(404); // no documents access in the grant
  });

  it('an uploaded file is not a verified or valid document; the keepers are asked to review', async () => {
    const f = pdf('kalibrasyon-2026');
    const r = await manager().post(`${C()}/documents/${calib}/versions`, { validFrom: day(-300), validUntil: day(10), file: fileOf(f) });
    expect(r.status).toBe(201);
    v1 = r.body;
    expect((await manager().get(`${C()}/documents/${calib}`)).body.status).toBe('file_pending');
    expect((await manager().put(`${C()}/evidence/${v1.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
    const d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ status: 'unreviewed', validUntil: null, currentVersionId: null });
    expect(d.versions[0]).toMatchObject({ version: 1, review_status: 'unreviewed', file_status: 'stored', canReview: true });
    expect((await notes(demo.users.owner.id, 'doc_review_needed')).length).toBe(1);
    expect((await notes(demo.users.manager.id, 'doc_review_needed')).length).toBe(0); // the uploader
    const list = (await owner().get(`${C()}/documents`)).body as any[];
    expect(list.find(x => x.id === calib)).toMatchObject({ status: 'unreviewed', pendingReview: true });
  });

  it('the uploader cannot review their own upload; a review needs notes; the reviewer confirms the dates', async () => {
    const R = `${C()}/documents/${calib}/versions/${v1.versionId}/review`;
    expect((await manager().post(R, { decision: 'verified', notes: 'Kontrol ettim.' })).body.error.code).toBe('REVIEWER_IS_UPLOADER');
    expect((await manager().get(`${C()}/documents/${calib}`)).body.versions[0].reviewBlockedReason).toContain('başka bir yetkili');
    expect((await staff().post(R, { decision: 'verified', notes: 'Kontrol ettim.' })).status).toBe(404);
    expect((await owner().post(R, { decision: 'verified', notes: 'kı' })).status).toBe(422);
    expect((await owner().post(R, { decision: 'verified', notes: 'Belgedeki tarih ve cihaz seri no kayıtla aynı.' })).status).toBe(200);
    expect((await owner().post(R, { decision: 'verified', notes: 'İkinci kez.' })).body.error.code).toBe('ALREADY_REVIEWED');
    const d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ status: 'internally_reviewed', expiring: true, validUntil: day(10), currentVersionId: v1.versionId });
    expect((await notes(demo.users.manager.id, 'doc_verified')).length).toBe(1);
  });

  it('end-date reminders: once before the end and once after it, to the keepers of that site only', async () => {
    await scanDocumentExpiry(env.db);
    await scanDocumentExpiry(env.db);
    expect((await notes(demo.users.manager.id, 'doc_expiring')).length).toBe(1);
    expect((await notes(demo.users.owner.id, 'doc_expiring')).length).toBe(1);
    expect((await notes(otherManager.id, 'doc_expiring')).length).toBe(0);
    expect((await notes(demo.users.staff.id, 'doc_expiring')).length).toBe(0);
    const later = new Date(Date.now() + 12 * 86400_000);
    await scanDocumentExpiry(env.db, later);
    await scanDocumentExpiry(env.db, later);
    expect((await notes(demo.users.manager.id, 'doc_expired')).length).toBe(1);
  });

  it('a renewal waiting for review does not make the document valid; once reviewed it does; a rejected one stays in the history', async () => {
    const f2 = pdf('kalibrasyon-2027');
    const v2 = (await manager().post(`${C()}/documents/${calib}/versions`, { validFrom: day(0), validUntil: day(365), file: fileOf(f2) })).body;
    await manager().put(`${C()}/evidence/${v2.evidenceId}/content`, f2, 'application/pdf');
    let d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ status: 'internally_reviewed', expiring: true, currentVersionId: v1.versionId }); // still the old one
    // The reviewer reads a different end date on the document and corrects it.
    expect((await owner().post(`${C()}/documents/${calib}/versions/${v2.versionId}/review`, { decision: 'verified', notes: 'Bitiş tarihi belgede farklı yazıyor, düzelttim.', validUntil: day(200) })).status).toBe(200);
    d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ status: 'internally_reviewed', expiring: false, currentVersionId: v2.versionId, validUntil: day(200) });
    const f3 = pdf('yanlis-belge');
    const v3 = (await manager().post(`${C()}/documents/${calib}/versions`, { validFrom: null, validUntil: day(900), file: fileOf(f3) })).body;
    await manager().put(`${C()}/evidence/${v3.evidenceId}/content`, f3, 'application/pdf');
    expect((await owner().post(`${C()}/documents/${calib}/versions/${v3.versionId}/review`, { decision: 'rejected', notes: 'Bu belge başka bir cihaza ait.' })).status).toBe(200);
    d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d).toMatchObject({ status: 'internally_reviewed', currentVersionId: v2.versionId });
    expect(d.versions.map((v: any) => v.review_status)).toEqual(['rejected', 'verified', 'verified']);
    const audit = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE entity_type = 'document' AND entity_id = $1 ORDER BY seq`, [calib])).rows.map(r => r.event_type);
    expect(audit).toEqual(['document.created', 'document.version_added', 'document.version_verified', 'document.version_added', 'document.version_verified', 'document.version_added', 'document.version_rejected']);
  });

  it('a file that never arrived cannot be reviewed; a wrong file is refused; the file opens only for people who may see the document', async () => {
    const f = pdf('ruhsat');
    const v = (await owner().post(`${C()}/documents/${license}/versions`, { validFrom: day(-1000), validUntil: null, file: fileOf(f) })).body;
    expect((await manager().post(`${C()}/documents/${license}/versions/${v.versionId}/review`, { decision: 'verified', notes: 'Ruhsat aslı görüldü.' })).body.error.code).toBe('FILE_MISSING');
    expect((await owner().put(`${C()}/evidence/${v.evidenceId}/content`, pdf('baska'), 'application/pdf')).status).toBe(422);
    const v2 = (await owner().post(`${C()}/documents/${license}/versions`, { validFrom: day(-1000), validUntil: null, file: fileOf(f) })).body;
    expect((await owner().put(`${C()}/evidence/${v2.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
    expect((await manager().post(`${C()}/documents/${license}/versions/${v2.versionId}/review`, { decision: 'verified', notes: 'Ruhsat aslı görüldü, süresiz.' })).status).toBe(200);
    expect((await owner().get(`${C()}/documents/${license}`)).body).toMatchObject({ status: 'internally_reviewed', validUntil: null });
    const get = (token: string) => env.app.inject({ method: 'GET', url: `${C()}/evidence/${v2.evidenceId}/content`, headers: { authorization: `Bearer ${token}` } });
    expect((await get(demo.users.manager.token)).statusCode).toBe(200);
    expect((await get(otherManager.token)).statusCode).toBe(404);
    expect((await get(demo.users.staff.token)).statusCode).toBe(404);
  });
});

describe('service reviews and marketplace notifications', () => {
  let requestId: string, jobId: string;
  const pro = () => client(env, provider.token);

  it('a new quote and a delivered report are announced to the business, once each', async () => {
    const req = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Dolap bakımı',
      description: 'Yıllık bakım.', city: 'İstanbul' });
    requestId = req.body.id;
    const q = await pro().post(`/pro/requests/${requestId}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 400, vatRate: 20,
      materials: '-', durationText: '1 saat', warrantyText: '1 ay', deliverable: 'Servis raporu ve ölçüm kaydı', validUntil: new Date(Date.now() + 3 * 86400_000).toISOString() });
    expect(q.status).toBe(201);
    expect((await notes(demo.users.owner.id, 'quote_received')).length).toBe(1);
    expect((await notes(demo.users.manager.id, 'quote_received')).length).toBe(1);
    expect((await notes(otherManager.id, 'quote_received')).length).toBe(0);
    expect((await notes(demo.users.staff.id, 'quote_received')).length).toBe(0);
    const acc = await owner().post(`${C()}/quotes/${q.body.id}/accept`);
    jobId = acc.body.jobId;
    // Not delivered, not accepted: no review.
    expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 5, communication: 5 })).body.error.code).toBe('JOB_NOT_ACCEPTED');
    await pro().post(`/pro/jobs/${jobId}/check-in`, { code: acc.body.checkinCode });
    await pro().post(`/pro/jobs/${jobId}/report`, { report: 'Kondenser temizlendi, gaz basıncı ölçüldü, iç sıcaklık 3 °C.' });
    expect((await notes(demo.users.owner.id, 'service_report_delivered')).length).toBe(1);
    expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 5, communication: 5 })).body.error.code).toBe('JOB_NOT_ACCEPTED');
    const inbox = (await manager().get(`${C()}/notifications`)).body.items as any[];
    expect(inbox.some(n => n.kind === 'quote_received' && n.entity_id === requestId)).toBe(true);
  });

  it('only an accepted job can be reviewed, once; it is hidden from the profile unless allowed', async () => {
    await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: true, note: 'Rapor okundu, dolap çalışıyor.' });
    let detail = (await owner().get(`${C()}/service-requests/${requestId}`)).body;
    expect(detail.canReview).toBe(true);
    expect((await staff().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 5, communication: 5 })).status).toBe(404);
    expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 6, timeliness: 5, communication: 5 })).status).toBe(422);
    expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 4, timeliness: 5, communication: 3, comment: 'Zamanında geldi.' })).status).toBe(201);
    expect((await owner().post(`${C()}/jobs/${jobId}/review`, { quality: 5, timeliness: 5, communication: 5 })).body.error.code).toBe('ALREADY_REVIEWED');
    detail = (await owner().get(`${C()}/service-requests/${requestId}`)).body;
    expect(detail).toMatchObject({ canReview: false, review: { quality: 4, show_on_profile: false } });
    const prof = (await pro().get(`/pro/profile`)).body;
    expect(prof.serviceHistory.items).toEqual([]);
  });

  it('with the business\'s permission the job shows on the profile without the business name', async () => {
    const req = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Conta değişimi',
      description: 'Kapı contası.', city: 'İstanbul' });
    const q = await pro().post(`/pro/requests/${req.body.id}/quotes`, { scope: 'Conta', exclusions: 'Menteşe', priceNet: 300, vatRate: 20,
      materials: 'Conta', durationText: '1 saat', warrantyText: '3 ay', deliverable: 'Servis raporu ve ölçüm kaydı', validUntil: new Date(Date.now() + 3 * 86400_000).toISOString() });
    expect(q.body).toEqual({ id: expect.any(String) });
    const acc = await owner().post(`${C()}/quotes/${q.body.id}/accept`);
    expect(acc.body.jobId).toEqual(expect.any(String));
    await pro().post(`/pro/jobs/${acc.body.jobId}/check-in`, { code: acc.body.checkinCode });
    await pro().post(`/pro/jobs/${acc.body.jobId}/report`, { report: 'Conta değiştirildi, kapı tam kapanıyor, iç sıcaklık 3 °C.' });
    await owner().post(`${C()}/jobs/${acc.body.jobId}/acceptance`, { accept: true, note: 'Kapı kapanıyor.' });
    const rv = await owner().post(`${C()}/jobs/${acc.body.jobId}/review`, { quality: 5, timeliness: 4, communication: 5, comment: 'Temiz iş.', showOnProfile: true });
    expect(rv.body).toEqual({ id: expect.any(String) });
    const prof = (await pro().get(`/pro/profile`)).body;
    expect(prof.serviceHistory.summary).toMatchObject({ count: 1, quality: 5, timeliness: 4 });
    expect(prof.serviceHistory.items[0]).toMatchObject({ category_name: expect.any(String), comment: 'Temiz iş.' });
    expect(JSON.stringify(prof.serviceHistory)).not.toContain(demo.companyId);
    const company = (await env.ownerDb.query(`SELECT name FROM companies WHERE id = $1`, [demo.companyId])).rows[0].name;
    expect(JSON.stringify(prof.serviceHistory)).not.toContain(company);
  });
});
