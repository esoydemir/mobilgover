import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GH-06 · GoverUp: need-based suggestions with readable reasons, expired approvals left out, an open request when nobody matches,
 * complaints from both sides (separate from job delivery, report review and the nonconformity), and the five operations lists.
 * The only manual database change is moving one approval's end date into the past (time shift), stated where it happens.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let p1: { id: string; token: string }, p2: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const P1 = () => client(env, p1.token);
const P2 = () => client(env, p2.token);
const REV = () => client(env, platform.marketReviewer.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const quote = (price: number) => ({ scope: 'Conta ve soğutma kontrolü', exclusions: 'Kompresör', priceNet: price, vatRate: 20, materials: 'Conta', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu' });

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  p1 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'p1.gh06@ornek.test');
  p2 = await seedDemoProvider(env.db, platform.marketReviewer.id, 'p2.gh06@ornek.test');
});
afterAll(async () => { await env?.close(); });

describe('suggestions from need', () => {
  it('suggests from profile with a reason the person can read; staff cannot ask', async () => {
    expect((await staff().get(`${C()}/service-suggestions?siteId=${demo.siteId}`)).status).toBe(403);
    const r = (await owner().get(`${C()}/service-suggestions?siteId=${demo.siteId}`)).body;
    const cold = r.suggestions.find((s: any) => s.category.code === 'refrigeration_service');
    expect(cold.reason).toMatch(/soğukta saklanan/);
    expect(cold.basis.some((b: any) => b.kind === 'location')).toBe(true);
    expect(cold.providers).toHaveLength(2);
    expect(cold.providers[0].authorization).toMatchObject({ status: 'approved' });
    expect(cold.providers[0].authorization.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cold.providers[0].authorization.daysLeft).toBeGreaterThan(0);
    expect(JSON.stringify(cold)).not.toMatch(/sponsor|reklam/i);
  });

  it('an open nonconformity and a missing service report add their own reasons and raise urgency', async () => {
    const fridge = (await env.ownerDb.query(`SELECT id FROM equipment WHERE company_id = $1 AND type = 'refrigerator' LIMIT 1`, [demo.companyId])).rows[0].id;
    const n = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Dolap sıcaklığı yüksek', description: 'Dolap 9 dereceyi gösteriyor.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: fridge });
    expect(n.status).toBe(201);
    const cold = (await owner().get(`${C()}/service-suggestions?siteId=${demo.siteId}`)).body.suggestions.find((s: any) => s.category.code === 'refrigeration_service');
    expect(cold.urgency).toBe('case');
    expect(cold.reason).toMatch(/Dolap sıcaklığı yüksek/);
    expect(cold.reason).toMatch(/bakım\/servis raporu yok/);
  });

  it('an expired approval is not matched; the count of left-out providers is shown', async () => {
    // Time shift only: provider 2's approval ends yesterday. Everything else is the public flow.
    await env.ownerDb.query(`UPDATE service_authorizations SET valid_until = (now() - interval '1 day')::date
       WHERE profile_id = (SELECT id FROM professional_profiles WHERE user_id = $1) AND category_code = 'refrigeration_service'`, [p2.id]);
    const cold = (await owner().get(`${C()}/service-suggestions?siteId=${demo.siteId}`)).body.suggestions.find((s: any) => s.category.code === 'refrigeration_service');
    expect(cold.providers).toHaveLength(1);
    expect(cold.leftOutExpiredApproval).toBe(1);
  });

  it('with no matching approved provider, the suggestion offers an open request with location and category only', async () => {
    const gas = (await owner().get(`${C()}/service-suggestions?siteId=${demo.siteId}`)).body.suggestions.find((s: any) => s.category.code === 'gas_installation_check');
    expect(gas.noMatch).toBe(true);
    expect(gas.openRequest).toMatchObject({ siteId: demo.siteId, categoryCode: 'gas_installation_check', city: 'İstanbul' });
    expect(gas.openRequest.note).toMatch(/işletme adı/);
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'gas_installation_check', title: 'Gaz bağlantı kontrolü', description: 'Tüp bağlantısı kontrol edilecek.', city: 'İstanbul' });
    expect(r.status).toBe(201);
  });
});

describe('complaints from both sides', () => {
  let jobId: string, ncrStatusBefore: string;

  it('set up an awarded job through the public flow', async () => {
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu bakımı', description: 'Contalar değişecek.', city: 'İstanbul' });
    expect(r.status).toBe(201);
    expect((await P1().post(`/pro/requests/${r.body.id}/quotes`, quote(1200))).status).toBe(201);
    const q = (await owner().get(`${C()}/service-requests/${r.body.id}`)).body.quotes[0].id;
    jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
    ncrStatusBefore = (await env.ownerDb.query(`SELECT status FROM nonconformities WHERE company_id = $1`, [demo.companyId])).rows[0].status;
  });

  it('the business opens a complaint; the provider is told, answers, a reviewer decides; delivery stays untouched', async () => {
    expect((await staff().post(`${C()}/jobs/${jobId}/complaints`, { reason: 'Uzman gelmedi ve haber vermedi.' })).status).toBe(404);
    expect((await owner().post(`${C()}/jobs/${jobId}/complaints`, { reason: 'kısa' })).status).toBe(422);
    const c = await owner().post(`${C()}/jobs/${jobId}/complaints`, { reason: 'Uzman randevuya gelmedi ve haber vermedi.' });
    expect(c.status).toBe(201);
    expect((await owner().post(`${C()}/jobs/${jobId}/complaints`, { reason: 'Aynı konuda ikinci şikâyet metni.' })).status).toBe(409);
    expect(((await P1().get('/pro/notifications')).body.items as any[]).some(n => n.kind === 'complaint_opened')).toBe(true);
    // The opener cannot answer their own complaint; the other side can.
    expect((await owner().post(`${C()}/complaints/${c.body.id}/respond`, { response: 'Kendi şikâyetime yanıt.' })).status).toBe(403);
    expect((await P1().post(`/pro/complaints/${c.body.id}/respond`, { response: 'Müşteri adresi yanlış vermişti; yeni randevu önerdim.' })).status).toBe(200);
    expect(((await owner().get(`${C()}/notifications`)).body.items as any[]).some(n => n.kind === 'complaint_responded')).toBe(true);
    // Neither the business role nor the provider can decide; only a marketplace reviewer.
    expect((await owner().post(`/admin/marketplace/complaints/${c.body.id}/resolve`, { resolution: 'Ben karar vereyim bu işte.' })).status).toBe(403);
    expect((await REV().post(`/admin/marketplace/complaints/${c.body.id}/resolve`, { resolution: 'Taraflar yeni randevuda anlaştı; şikâyet kapandı.' })).status).toBe(200);
    expect((await REV().post(`/admin/marketplace/complaints/${c.body.id}/resolve`, { resolution: 'İkinci kez karar vermeye çalışıyorum.' })).status).toBe(409);
    const seen = (await P1().get(`/pro/jobs/${jobId}/complaints`)).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ opened_side: 'business', status: 'resolved' });
    // A complaint is its own record: the job, the report review and the nonconformity did not move.
    const job = (await env.ownerDb.query(`SELECT status, accepted_at FROM service_jobs WHERE id = $1`, [jobId])).rows[0];
    expect(job).toMatchObject({ status: 'scheduled', accepted_at: null });
    expect((await env.ownerDb.query(`SELECT status FROM nonconformities WHERE company_id = $1`, [demo.companyId])).rows[0].status).toBe(ncrStatusBefore);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE company_id = $1 AND event_type LIKE 'service.complaint_%'`, [demo.companyId])).rows[0].n).toBe(3);
  });

  it('the provider can complain too; the business answers; another provider cannot touch it', async () => {
    const c = await P1().post(`/pro/jobs/${jobId}/complaints`, { reason: 'İşletme ulaşılamıyor, kapıyı açmadı.' });
    expect(c.status).toBe(201);
    expect((await P2().post(`/pro/jobs/${jobId}/complaints`, { reason: 'Bu iş bana ait değil ama deniyorum.' })).status).toBe(404);
    expect((await P2().post(`/pro/complaints/${c.body.id}/respond`, { response: 'Başkasının şikâyetine yanıt.' })).status).toBe(404);
    expect(((await manager().get(`${C()}/notifications`)).body.items as any[]).some(n => n.kind === 'complaint_opened')).toBe(true);
    expect((await P1().post(`/pro/complaints/${c.body.id}/respond`, { response: 'Kendi şikâyetime yanıt vermeye çalışıyorum.' })).status).toBe(403);
    expect((await manager().post(`${C()}/complaints/${c.body.id}/respond`, { response: 'Kapıda görevli vardı; yeni saat önerdik.' })).status).toBe(200);
    expect((await owner().get(`${C()}/jobs/${jobId}/complaints`)).body).toHaveLength(2);
  });
});

describe('operations lists', () => {
  it('only a marketplace reviewer sees them; each row names who waits, how long and what to do next', async () => {
    expect((await owner().get('/admin/marketplace/operations')).status).toBe(403);
    // Time shift for the late-appointment list: a slot proposed in the future, then its start moved into the past.
    const jobId = (await env.ownerDb.query(`SELECT id FROM service_jobs WHERE company_id = $1`, [demo.companyId])).rows[0].id;
    expect((await owner().post(`${C()}/jobs/${jobId}/appointments`, { startsAt: later(24), endsAt: later(26) })).status).toBe(201);
    await env.ownerDb.query(`UPDATE service_appointments SET starts_at = now() - interval '73 hours', ends_at = now() - interval '71 hours', created_at = now() - interval '4 days' WHERE job_id = $1`, [jobId]);
    const ops = (await REV().get('/admin/marketplace/operations')).body;
    expect(ops.counts).toMatchObject({ openRequests: 1, lateAppointments: 1, expiringApprovals: 1, openComplaints: 1, rejectedReports: 0 });
    for (const rows of Object.values(ops.lists) as any[][]) for (const row of rows) {
      expect(row.responsible).toBeTruthy(); expect(row.nextAction).toBeTruthy(); expect(row.record.id).toBeTruthy(); expect(typeof row.waitingDays).toBe('number');
    }
    expect(ops.lists.lateAppointments[0].waitingDays).toBeGreaterThanOrEqual(3);
    expect(ops.lists.expiringApprovals[0].title).toMatch(/süresi doldu/);
    expect(ops.lists.openComplaints[0].title).toMatch(/uzman şikâyeti/);
  });

  it('a report sent back for revision shows up with who must act', async () => {
    const jobId = (await env.ownerDb.query(`SELECT id FROM service_jobs WHERE company_id = $1`, [demo.companyId])).rows[0].id;
    const code = (await env.ownerDb.query(`SELECT checkin_code FROM service_jobs WHERE id = $1`, [jobId])).rows[0].checkin_code;
    await env.ownerDb.query(`UPDATE service_appointments SET status = 'cancelled' WHERE job_id = $1`, [jobId]);
    expect((await P1().post(`/pro/jobs/${jobId}/check-in`, { code })).status).toBe(200);
    const f = Buffer.from('%PDF-1.4 servis raporu');
    const sha = (await import('node:crypto')).createHash('sha256').update(f).digest('hex');
    const rep = await P1().post(`/pro/jobs/${jobId}/report`, { report: 'Conta değiştirildi, sıcaklık normale döndü, ölçümler rapora eklendi.', file: { mime: 'application/pdf', sha256: sha, sizeBytes: f.length } });
    await P1().put(`/pro/jobs/${jobId}/report/${rep.body.evidenceId}/content`, f, 'application/pdf');
    expect((await owner().post(`${C()}/jobs/${jobId}/acceptance`, { accept: false, note: 'Ölçüm değerleri eksik.' })).status).toBe(200);
    const ops = (await REV().get('/admin/marketplace/operations')).body;
    expect(ops.lists.rejectedReports).toHaveLength(1);
    expect(ops.lists.rejectedReports[0].responsible).toMatch(/Uzman/);
    expect(ops.lists.rejectedReports[0].title).toMatch(/Ölçüm değerleri eksik/);
    expect(ops.lists.lateAppointments).toHaveLength(0);
  });
});
