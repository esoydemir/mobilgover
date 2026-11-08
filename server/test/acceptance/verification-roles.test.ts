import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { scanDeadlines } from '../../src/services/notifications';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 4: verification by risk (labelled self-verification for low risk only), an outside
 * verifier with a limited grant for a single-manager business, separate roles on an action,
 * older "completed" actions on open cases, document review vs issuer check, controlled site
 * reading of company-wide documents, provider and overdue-task notifications.
 * Real HTTP + PostgreSQL. Rules, categories and risk levels are EXAMPLES.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>; // single-manager business (manager suspended)
let full: Awaited<ReturnType<typeof seedDemoCompany>>; // normal business: owner, site manager, staff
let provider: { id: string; token: string };
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const C = () => `/companies/${demo.companyId}`;
const F = () => `/companies/${full.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const staff = () => client(env, demo.users.staff.token);
const kinds = async (userId: string, kind: string) => (await env.ownerDb.query(`SELECT entity_id, body FROM notifications WHERE user_id = $1 AND kind = $2`, [userId, kind])).rows;
const sessionFor = async (email: string) => env.db.system(async tx => {
  const u = (await tx.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
  return { id: u, token: await createSession(tx, u) };
});
async function openCase(c: ReturnType<typeof client>, base: string, siteId: string, severity: string, title: string) {
  const r = await c.post(`${base}/nonconformities`, { siteId, title, description: 'Açıklama: test kaydı.', hazardType: 'cleaning', severity, containment: 'Alan kapatıldı.' });
  expect(r.status).toBe(201);
  return r.body;
}

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { name: 'Tek Yöneticili Büfe (DEMO)' });
  full = await seedDemoCompany(env.db, { name: 'Kalabalık Kafe (DEMO)' });
  provider = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.pro@ornek.test');
  // Single manager: the site manager of this business is suspended; only the owner manages.
  await env.ownerDb.query(`UPDATE memberships SET status = 'suspended', suspended_at = now(), suspended_by = $3, suspend_reason = 'Tek yöneticili senaryo'
     WHERE user_id = $1 AND company_id = $2`, [demo.users.manager.id, demo.companyId, demo.users.owner.id]);
});
afterAll(async () => { await env?.close(); });

describe('low risk: labelled self-verification by the only manager', () => {
  it('a contributor must say it is self-verification and give a reason; it is labelled; closure too', async () => {
    const n = await openCase(owner(), C(), demo.siteId, 'minor', 'Depo rafı tozlu');
    expect(n.riskLevel).toBe('low');
    const N = `${C()}/nonconformities/${n.id}`;
    await owner().post(`${N}/assignment`, { ownerId: demo.users.owner.id, dueAt: later(24) });
    await owner().post(`${N}/causes`, { stage: 'initial', categories: ['process'], notes: 'Temizlik listesinde raf yok.' });
    const a = (await owner().post(`${N}/actions`, { kind: 'correction', description: 'Rafı sil, listeye ekle.' })).body.id;
    await owner().post(`${N}/actions/${a}`, { op: 'done', notes: 'Raf silindi.' });
    const d = (await owner().get(N)).body;
    expect(d.actions[0]).toMatchObject({ can_verify: false, can_self_verify: true });
    expect(d.verificationPolicy).toContain('Düşük risk');
    expect((await owner().post(`${N}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Baktım, temiz.' })).body.error.code).toBe('SELF_VERIFICATION_CONFIRM');
    expect((await owner().post(`${N}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Baktım, temiz.', selfVerify: true })).status).toBe(422); // reason too short
    expect((await owner().post(`${N}/actions/${a}`, { op: 'verify', result: 'accepted', selfVerify: true,
      notes: 'Tek yöneticiyiz; rafı fotoğrafla karşılaştırdım, toz yok.' })).status).toBe(200);
    const row = (await env.ownerDb.query(`SELECT verification_status, verification_mode, verified_via FROM ncr_actions WHERE id = $1`, [a])).rows[0];
    expect(row).toEqual({ verification_status: 'verified', verification_mode: 'self', verified_via: 'membership' });
    await owner().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Bir hafta raflar temiz.' });
    expect((await owner().get(N)).body.permissions).toMatchObject({ verify: false, selfVerify: true });
    expect((await owner().post(`${N}/verify`, { result: 'effective', notes: 'Kontrol ettim.' })).body.error.code).toBe('SELF_VERIFICATION_CONFIRM');
    expect((await owner().post(`${N}/verify`, { result: 'effective', selfVerify: true, notes: 'Tek yöneticiyiz; bir haftalık temizlik kayıtları tam.' })).body.status).toBe('closed');
    const v = (await owner().get(N)).body.verifications.at(-1);
    expect(v).toMatchObject({ result: 'effective', verification_mode: 'self' });
  });
});

describe('high risk: independent verification kept; an invited outside verifier does it', () => {
  let n: string, corr: string, expert: { id: string; token: string };
  const N = () => `${C()}/nonconformities/${n}`;
  const ex = () => client(env, expert.token);

  it('the only manager cannot verify their own work, not even as self-verification', async () => {
    const r = await openCase(owner(), C(), demo.siteId, 'critical', 'Dondurucu alarmı çalışmıyor');
    expect(r.riskLevel).toMatch(/high|critical/);
    n = r.id;
    await owner().post(`${N()}/assignment`, { ownerId: demo.users.owner.id, dueAt: later(24) });
    await owner().post(`${N()}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Pil bitmiş olabilir.' });
    corr = (await owner().post(`${N()}/actions`, { kind: 'correction', description: 'Alarm pilini değiştir.' })).body.id;
    await owner().post(`${N()}/actions/${corr}`, { op: 'done', notes: 'Pil değişti.' });
    const d = (await owner().get(N())).body;
    expect(d.actions[0]).toMatchObject({ can_verify: false, can_self_verify: false });
    expect(d.actions[0].verify_blocked_reason).toContain('dış doğrulayıcı');
    expect(d.permissions.inviteVerifier).toBe(true);
    const self = await owner().post(`${N()}/actions/${corr}`, { op: 'verify', result: 'accepted', selfVerify: true, notes: 'Tek yöneticiyiz, alarmı denedim, çalıştı.' });
    expect(self.body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
  });

  it('the owner invites an outside verifier: limited scope, one site, time-limited; staff cannot invite', async () => {
    expect((await staff().post(`${C()}/verifiers`, { email: 'zeynep.dogrulayici@ornek.test', days: 30, note: 'Bağımsız doğrulama' })).status).toBe(403);
    expect((await owner().post(`${C()}/verifiers`, { email: 'zeynep.dogrulayici@ornek.test', days: 5, note: 'Bağımsız doğrulama' })).status).toBe(422);
    const inv = await owner().post(`${C()}/verifiers`, { email: 'zeynep.dogrulayici@ornek.test', siteId: demo.siteId, days: 30, note: 'Tek yöneticiliyiz; yüksek riskli kayıtları bağımsız doğrulaması için.' });
    expect(inv.status).toBe(201);
    expect((await owner().post(`${C()}/verifiers`, { email: 'zeynep.dogrulayici@ornek.test', siteId: demo.siteId, days: 30, note: 'Tekrar davet' })).status).toBe(409);
    expert = await sessionFor('zeynep.dogrulayici@ornek.test');
    expect((await kinds(expert.id, 'verifier_invited')).length).toBe(1);
    // Told about the claim waiting for an independent check (nobody inside is eligible).
    const list = (await owner().get(`${C()}/verifiers`)).body;
    expect(list.find((g: any) => g.user_id === expert.id)).toMatchObject({ active: true, site_id: demo.siteId, scopes: ['ncr_verify'] });
  });

  it('the verifier can read and verify, but cannot act, assign, see other data, or other sites', async () => {
    expect((await ex().get(N())).status).toBe(200);
    expect((await ex().post(`${N()}/actions`, { kind: 'correction', description: 'Ben de ekleyeyim.' })).status).not.toBe(201);
    expect((await ex().post(`${N()}/assignment`, { ownerId: expert.id, dueAt: later(5) })).status).not.toBe(200);
    expect((await ex().get(`${C()}/tasks`)).status === 200 ? (await ex().get(`${C()}/tasks`)).body.length : 0).toBe(0);
    expect((await ex().get(`${C()}/documents`)).body).toEqual([]);
    const other = await env.db.system(async tx => (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Şube 2') RETURNING id`, [demo.companyId])).rows[0].id);
    const elsewhere = await openCase(owner(), C(), other, 'major', 'Başka şubede kayıt');
    expect((await ex().get(`${C()}/nonconformities/${elsewhere.id}`)).status).toBe(404);
    const q = (await ex().get(`${C()}/verification-queue`)).body;
    expect(q).toEqual([expect.objectContaining({ kind: 'action', ncrId: n, actionId: corr, canVerify: true })]);
    expect((await ex().post(`${N()}/actions/${corr}`, { op: 'verify', result: 'accepted', notes: 'Alarmı test butonuyla denedim, çalıyor.' })).status).toBe(200);
    expect((await env.ownerDb.query(`SELECT verification_mode, verified_via FROM ncr_actions WHERE id = $1`, [corr])).rows[0])
      .toEqual({ verification_mode: 'independent', verified_via: 'grant' });
  });

  it('corrective action and closure: the owner cannot close own work; the outside verifier closes', async () => {
    const ca = (await owner().post(`${N()}/actions`, { kind: 'corrective_action', description: 'Alarm testini haftalık listeye ekle.' })).body.id;
    await owner().post(`${N()}/actions/${ca}`, { op: 'done', notes: 'Listeye eklendi.' });
    expect((await kinds(expert.id, 'action_declared')).length).toBe(1);
    await ex().post(`${N()}/actions/${ca}`, { op: 'verify', result: 'accepted', notes: 'Haftalık listede alarm maddesini gördüm.' });
    await owner().post(`${N()}/causes`, { stage: 'verified', categories: ['equipment', 'process'], notes: 'Pil ömrü takip edilmiyordu; listede alarm yoktu.' });
    expect((await owner().post(`${N()}/steps`, { step: 'effectiveness_check', notes: 'İki hafta alarm testleri başarılı.' })).status).toBe(201);
    expect((await kinds(expert.id, 'ncr_verification_requested')).length).toBe(1);
    expect((await owner().post(`${N()}/verify`, { result: 'effective', selfVerify: true, notes: 'Tek yöneticiyiz, alarm testleri iki hafta başarılı.' })).body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
    expect((await ex().post(`${N()}/verify`, { result: 'effective', notes: 'Test kayıtları ve alarm denemesi yerinde incelendi.' })).body.status).toBe('closed');
    expect((await owner().get(N())).body.verifications.at(-1)).toMatchObject({ verification_mode: 'independent', verified_via: 'grant' });
  });

  it('an outside verifier who delivered a service for the case cannot verify it; a revoked grant gives nothing', async () => {
    const r = await openCase(owner(), C(), demo.siteId, 'critical', 'Soğutucu sıcaklığı yüksek');
    const M = `${C()}/nonconformities/${r.id}`;
    await owner().post(`${M}/assignment`, { ownerId: demo.users.owner.id, dueAt: later(24) });
    await owner().post(`${M}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Kompresör zayıf.' });
    const pro = client(env, provider.token);
    const req = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu bakımı', description: 'Sıcaklık yüksek.', city: 'İstanbul', ncrId: r.id });
    const qt = await pro.post(`/pro/requests/${req.body.id}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 300, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48) });
    const acc = await owner().post(`${C()}/quotes/${qt.body.id}/accept`);
    await pro.post(`/pro/jobs/${acc.body.jobId}/check-in`, { code: acc.body.checkinCode });
    await pro.post(`/pro/jobs/${acc.body.jobId}/report`, { report: 'Kondenser temizlendi, gaz basıncı normale döndü, 3 °C.' });
    await owner().post(`${C()}/jobs/${acc.body.jobId}/acceptance`, { accept: true, note: 'Rapor okundu.' });
    // The same person is invited as an outside verifier.
    expect((await owner().post(`${C()}/verifiers`, { email: 'murat.pro@ornek.test', days: 7, note: 'Hızlı doğrulama için davet' })).status).toBe(201);
    const a = (await owner().post(`${M}/actions`, { kind: 'correction', description: 'Uzman bakımı yapıldı.' })).body.id;
    await owner().post(`${M}/actions/${a}`, { op: 'done', notes: 'Bakım raporu alındı.' });
    const proV = client(env, (await sessionFor('murat.pro@ornek.test')).token);
    expect((await proV.post(`${M}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Bakımı ben yaptım, çalışıyor.' })).body.error.code).toBe('VERIFIER_IS_PROVIDER');
    expect((await proV.get(M)).body.actions[0].verify_blocked_reason).toContain('hizmeti sen verdin');
    // Revoke the first verifier: nothing visible any more.
    const g = (await owner().get(`${C()}/verifiers`)).body.find((x: any) => x.user_id === expert.id);
    expect((await owner().post(`${C()}/verifiers/${g.id}/revoke`)).status).toBe(200);
    expect((await client(env, (await sessionFor('zeynep.dogrulayici@ornek.test')).token).get(M)).status).toBe(404);
  });
});

describe('separate roles: responsible, doer, declarer, evidence giver, verifier', () => {
  it('the business-owner ROLE alone does not exclude; any part does', async () => {
    const mgr = client(env, full.users.manager.token), own = client(env, full.users.owner.token);
    const r = await openCase(mgr, F(), full.siteId, 'critical', 'Kapı contası yırtık');
    const N = `${F()}/nonconformities/${r.id}`;
    await mgr.post(`${N}/assignment`, { ownerId: full.users.manager.id, dueAt: later(24) });
    await mgr.post(`${N}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Conta aşınmış.' });
    // Responsible: manager. Work done by: staff. Declared by: manager.
    const a = (await mgr.post(`${N}/actions`, { kind: 'correction', description: 'Contayı bantla.' })).body.id;
    expect((await mgr.post(`${N}/actions/${a}`, { op: 'done', notes: 'Elif bantladı.', performedBy: full.users.staff.id })).status).toBe(200);
    const row = (await own.get(N)).body.actions[0];
    expect(row).toMatchObject({ owner_id: full.users.manager.id, performed_by: full.users.staff.id, done_by: full.users.manager.id, can_verify: true });
    expect((await own.post(`${N}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Kapıyı kapatıp denedim.' })).status).toBe(200);
    // Owner role with a part (evidence giver) on the next one: excluded at high risk.
    const b = (await mgr.post(`${N}/actions`, { kind: 'corrective_action', description: 'Conta kontrolünü listeye ekle.', evidenceRequired: 'photo' })).body.id;
    const img = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('liste')]);
    const ev = await own.post(`${N}/actions/${b}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(img).digest('hex'), sizeBytes: img.length });
    await own.put(`${F()}/evidence/${ev.body.id}/content`, img, 'image/jpeg');
    await mgr.post(`${N}/actions/${b}`, { op: 'done', notes: 'Listeye eklendi.' });
    expect((await own.post(`${N}/actions/${b}`, { op: 'verify', result: 'accepted', notes: 'Listeyi gördüm.' })).body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
  });
});

describe('older "completed" actions on open cases', () => {
  it('cannot carry an open case to closure until verified; closed history is not changed', async () => {
    const mgr = client(env, full.users.manager.token), own = client(env, full.users.owner.token);
    const r = await openCase(mgr, F(), full.siteId, 'minor', 'Eski kayıt benzeri');
    const N = `${F()}/nonconformities/${r.id}`;
    const a = (await mgr.post(`${N}/actions`, { kind: 'correction', description: 'Eski düzeltme.' })).body.id;
    // As migrated from the first flow: v1 case, action completed before claims needed verification.
    await env.ownerDb.query(`UPDATE nonconformities SET flow_version = 1 WHERE id = $1`, [r.id]);
    await env.ownerDb.query(`UPDATE ncr_actions SET status = 'done', done_by = $2, done_at = now(), result_notes = 'Eski sürüm', verification_status = 'legacy' WHERE id = $1`, [a, full.users.manager.id]);
    let d = (await own.get(N)).body;
    expect(d.actions[0]).toMatchObject({ legacy_unverified: true, can_verify: true });
    expect(d.flow.blockers.join(' ')).toContain('eski aksiyon');
    expect((await mgr.post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Sorun yok.' })).body.error.code).toBe('FLOW_INCOMPLETE');
    expect((await own.post(`${N}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Eski kaydı yerinde kontrol ettim.' })).status).toBe(200);
    expect((await mgr.post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Bir hafta sorun yok.' })).status).toBe(201);
    // A case already closed on legacy actions keeps its history as it was.
    const c2 = await openCase(mgr, F(), full.siteId, 'minor', 'Kapanmış eski kayıt');
    const a2 = (await mgr.post(`${F()}/nonconformities/${c2.id}/actions`, { kind: 'correction', description: 'Eski.' })).body.id;
    await env.ownerDb.query(`UPDATE ncr_actions SET status = 'done', done_by = $2, done_at = now(), verification_status = 'legacy' WHERE id = $1`, [a2, full.users.manager.id]);
    await env.ownerDb.query(`UPDATE nonconformities SET flow_version = 1, status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`, [c2.id, full.users.owner.id]);
    d = (await own.get(`${F()}/nonconformities/${c2.id}`)).body;
    expect(d.status).toBe('closed');
    expect(d.actions[0]).toMatchObject({ verification_status: 'legacy', legacy_unverified: false, can_verify: false });
  });
});

describe('documents: internal review is not an issuer check; controlled site reading', () => {
  it('statuses stay apart; an issuer check needs a method and reference; shared docs are read-only', async () => {
    const own = client(env, full.users.owner.token), mgr = client(env, full.users.manager.token);
    const lic = (await own.post(`${F()}/documents`, { docType: 'business_license', title: 'İşyeri ruhsatı (merkez)' })).body.id;
    expect((await mgr.get(`${F()}/documents/${lic}`)).status).toBe(404);
    const pdf = Buffer.from('%PDF-1.4\nruhsat\n');
    const v = (await own.post(`${F()}/documents/${lic}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: createHash('sha256').update(pdf).digest('hex'), sizeBytes: pdf.length } })).body;
    await own.put(`${F()}/evidence/${v.evidenceId}/content`, pdf, 'application/pdf');
    expect((await own.get(`${F()}/documents/${lic}`)).body.status).toBe('unreviewed');
    // Share with the site: the site manager can read and open, not review or change.
    expect((await own.post(`${F()}/documents/${lic}/shares`, { siteId: full.siteId, share: true })).status).toBe(200);
    const seen = (await mgr.get(`${F()}/documents`)).body.find((x: any) => x.id === lic);
    expect(seen).toMatchObject({ sharedReadOnly: true, status: 'unreviewed' });
    expect((await mgr.get(`${F()}/documents/${lic}`)).body.permissions).toMatchObject({ write: false, review: false });
    expect((await env.app.inject({ method: 'GET', url: `${F()}/evidence/${v.evidenceId}/content`, headers: { authorization: `Bearer ${full.users.manager.token}` } })).statusCode).toBe(200);
    expect((await mgr.post(`${F()}/documents/${lic}/versions/${v.versionId}/review`, { decision: 'verified', notes: 'Gördüm.' })).status).toBe(403);
    expect((await own.post(`${F()}/documents/${lic}/versions/${v.versionId}/issuer-check`, { method: 'barcode_query', reference: '12345' })).body.error.code).toBe('NOT_REVIEWED');
    // Internal review by an outside reviewer with document access (the owner uploaded it).
    await own.post(`${F()}/verifiers`, { email: 'belge.inceleme@ornek.test', days: 30, note: 'Belge incelemesi için', documents: true });
    const rev = client(env, (await sessionFor('belge.inceleme@ornek.test')).token);
    expect((await rev.post(`${F()}/documents/${lic}/versions/${v.versionId}/review`, { decision: 'verified', notes: 'Aslıyla karşılaştırıldı.' })).status).toBe(200);
    expect((await own.get(`${F()}/documents/${lic}`)).body.status).toBe('internally_reviewed');
    expect((await own.post(`${F()}/documents/${lic}/versions/${v.versionId}/issuer-check`, { method: 'barcode_query', reference: '' })).status).toBe(422);
    expect((await own.post(`${F()}/documents/${lic}/versions/${v.versionId}/issuer-check`, { method: 'barcode_query', reference: 'Barkod 9988-7766', notes: 'Belediye e-sorgu ekranı' })).status).toBe(200);
    const d = (await own.get(`${F()}/documents/${lic}`)).body;
    expect(d.status).toBe('issuer_verified');
    expect(d.versions[0]).toMatchObject({ issuer_check_method: 'barcode_query', issuer_check_ref: 'Barkod 9988-7766' });
    // Revoke the share: the site no longer sees it.
    await own.post(`${F()}/documents/${lic}/shares`, { siteId: full.siteId, share: false });
    expect((await mgr.get(`${F()}/documents/${lic}`)).status).toBe(404);
  });
});

describe('notifications: provider side and overdue checks, once each', () => {
  it('provider hears of a new request, the accepted quote and the delivery result; never the business name before award', async () => {
    const pro = client(env, provider.token), own = client(env, full.users.owner.token);
    const req = await own.post(`${F()}/service-requests`, { siteId: full.siteId, categoryCode: 'refrigeration_service', title: 'Dolap bakımı', description: 'Yıllık bakım.', city: 'İstanbul' });
    const inbox1 = (await pro.get('/pro/notifications')).body;
    const nr = inbox1.items.filter((x: any) => x.kind === 'provider_new_request' && x.entity_id === req.body.id);
    expect(nr.length).toBe(1);
    expect(JSON.stringify(nr)).not.toContain('Kalabalık Kafe');
    const qt = await pro.post(`/pro/requests/${req.body.id}/quotes`, { scope: 'Bakım', exclusions: 'Parça', priceNet: 300, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48) });
    const acc = await own.post(`${F()}/quotes/${qt.body.id}/accept`);
    await pro.post(`/pro/jobs/${acc.body.jobId}/check-in`, { code: acc.body.checkinCode });
    await pro.post(`/pro/jobs/${acc.body.jobId}/report`, { report: 'Kondenser temizlendi, iç sıcaklık 3 °C ölçüldü.' });
    await own.post(`${F()}/jobs/${acc.body.jobId}/acceptance`, { accept: true, note: 'Rapor okundu.' });
    const inbox = (await pro.get('/pro/notifications')).body.items;
    expect(inbox.filter((x: any) => x.kind === 'quote_accepted' && x.entity_id === acc.body.jobId).length).toBe(1);
    expect(inbox.filter((x: any) => x.kind === 'job_accepted' && x.entity_id === acc.body.jobId).length).toBe(1);
    // Provider items stay out of the business inbox.
    expect((await own.get(`${F()}/notifications`)).body.items.some((x: any) => x.entity_type === 'pro_job')).toBe(false);
    expect((await pro.post('/pro/notifications/read', { ids: 'all' })).body.marked).toBeGreaterThan(0);
  });

  it('an overdue check: the responsible person once, the site managers one daily summary', async () => {
    const t = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND status = 'open' ORDER BY due_at LIMIT 1`, [full.companyId])).rows[0]?.id
      ?? (await (async () => { const { topUpAllSites } = await import('../../src/services/horizon'); await topUpAllSites(env.db, 3);
        return (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND status = 'open' ORDER BY due_at LIMIT 1`, [full.companyId])).rows[0].id; })());
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '2 hours', assignee_id = $2 WHERE id = $1`, [t, full.users.staff.id]);
    await scanDeadlines(env.db);
    await scanDeadlines(env.db);
    expect((await kinds(full.users.staff.id, 'task_overdue')).filter(x => x.entity_id === t).length).toBe(1);
    expect((await kinds(full.users.manager.id, 'tasks_overdue')).length).toBe(1);
    expect((await kinds(full.users.owner.id, 'tasks_overdue')).length).toBe(1);
  });
});
