import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { scanDeadlines } from '../../src/services/notifications';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Nonconformity flow v2 end to end, over real HTTP and PostgreSQL:
 * manual report → risk and first response → owner and due date → cause assessment
 * (first view vs verified root cause, several causes) → support suggestion → actions
 * → effectiveness check → verification (fail keeps it open) → close → reopen with reason.
 * Plus in-app notifications (no duplicates, role and site limits) and reassignment.
 * Rules, limits and service categories are EXAMPLES.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let provider: { id: string; token: string };
let otherSite: string, otherManager: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const notes = async (userId: string, kind?: string) => (await env.ownerDb.query(
  `SELECT kind, entity_id, dedupe_key FROM notifications WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY created_at`, [userId, kind ?? null])).rows;

let ncr: string;

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  provider = await seedDemoProvider(env.db, platform.marketReviewer.id);
  // A second site with its own manager: must not see or be told about the first site's cases.
  ({ otherSite, otherManager } = await env.db.system(async tx => {
    const s = (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Beşiktaş') RETURNING id`, [demo.companyId])).rows[0].id;
    const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Kerem (Beşiktaş müdürü)', 'kerem@ornek.test') RETURNING id`)).rows[0].id;
    await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,$3,'site_manager','active',now())`, [u, demo.companyId, s]);
    return { otherSite: s as string, otherManager: { id: u as string, token: await createSession(tx, u) } };
  }));
  void otherSite;
});
afterAll(async () => { await env?.close(); });

describe('manual report, risk, first response', () => {
  it('staff report a problem they noticed; risk is sized; the reporter stays responsible until a manager assigns', async () => {
    const r = await staff().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Soğutucu kapısı tam kapanmıyor', description: 'Mutfak arkadaki dolabın kapısı açık kalıyor, conta yırtık görünüyor.',
      hazardType: 'cold_chain_temperature', severity: 'critical', equipmentId: demo.fridgeId, containment: 'Ürünleri yan dolaba taşıdım.' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ riskLevel: 'high', depth: 'capa' });
    ncr = r.body.id;
    const d = (await staff().get(`${C()}/nonconformities/${ncr}`)).body;
    expect(d).toMatchObject({ source: 'manual', status: 'open', owner: { id: demo.users.staff.id } });
    expect(d.flow.stages.find((s: any) => s.key === 'containment').state).toBe('done');
    expect(d.permissions).toMatchObject({ act: true, manage: false, verify: false });
  });

  it('managers of that site are told once; the other site manager is not, and cannot open it', async () => {
    expect((await notes(demo.users.owner.id, 'ncr_reported')).length).toBe(1);
    expect((await notes(demo.users.manager.id, 'ncr_reported')).length).toBe(1);
    expect((await notes(otherManager.id)).length).toBe(0);
    expect((await client(env, otherManager.token).get(`${C()}/nonconformities/${ncr}`)).status).toBe(404);
  });

  it('a reporter outside the site, or an unknown topic, is refused', async () => {
    expect((await client(env, otherManager.token).post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Deneme kaydı', description: 'Başka şube',
      hazardType: 'other', severity: 'minor' })).status).toBe(403);
    expect((await staff().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Deneme kaydı', description: 'Uydurma konu',
      hazardType: 'made_up', severity: 'minor' })).status).toBe(422);
  });
});

describe('owner and due date', () => {
  it('only managers assign; the new owner is told once; changing the due date later needs a reason; history keeps it', async () => {
    expect((await staff().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: later(24) })).status).toBe(403);
    expect((await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: otherManager.id, dueAt: later(24) })).status).toBe(422);
    const due = later(48);
    expect((await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: due })).status).toBe(200);
    // Same assignment again: nothing changes, no second notification.
    expect((await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: due })).body.changed).toBe(false);
    expect((await notes(demo.users.staff.id, 'ncr_assigned')).length).toBe(1);
    expect((await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: later(72) })).status).toBe(422);
    expect((await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.staff.id, dueAt: later(72), reason: 'Yedek parça cuma geliyor.' })).status).toBe(200);
    const d = (await owner().get(`${C()}/nonconformities/${ncr}`)).body;
    const changes = d.history.filter((h: any) => h.event_type === 'nonconformity.assigned');
    expect(changes.length).toBe(2);
    expect(changes[1].payload.reason).toContain('Yedek parça');
    expect((await notes(demo.users.staff.id, 'ncr_assigned')).length).toBe(2); // due date moved: told once more
  });
});

describe('cause assessment and support', () => {
  it('several causes can be picked; a first assessment is not a verified root cause', async () => {
    expect((await staff().post(`${C()}/nonconformities/${ncr}/causes`, { stage: 'initial', categories: ['equipment', 'knowledge'], notes: 'Conta yırtık; kapının kontrol edileceğini bilmiyordum.' })).status).toBe(201);
    const d = (await staff().get(`${C()}/nonconformities/${ncr}`)).body;
    expect(d.cause.initial.categories).toEqual(['equipment', 'knowledge']);
    expect(d.cause.verified).toBeNull();
    expect(d.flow.stages.find((s: any) => s.key === 'root_cause').state).not.toBe('done');
    // Staff may not confirm the root cause.
    expect((await staff().post(`${C()}/nonconformities/${ncr}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Conta aşınmış, bakım planında yok.' })).status).toBe(403);
  });

  it('suggestions point to an explanation or a service request draft; nothing is ordered by itself', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_requests`)).rows[0].n;
    const d = (await owner().get(`${C()}/nonconformities/${ncr}`)).body;
    const kinds = d.suggestions.map((s: any) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['service_request', 'equipment', 'training', 'explanation']));
    expect(d.suggestions.find((s: any) => s.kind === 'service_request').serviceCategory).toBe('refrigeration_service');
    expect(d.suggestions.find((s: any) => s.kind === 'training').available).toBe(false); // no training module yet
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_requests`)).rows[0].n).toBe(before);
  });
});

describe('actions, deadlines and notifications', () => {
  let correction: string;
  it('staff add an action for themselves; a manager can give one to someone else; staff cannot', async () => {
    const a = await staff().post(`${C()}/nonconformities/${ncr}/actions`, { kind: 'correction', description: 'Contayı geçici bantla kapat, servisi bekle.', dueAt: later(2) });
    expect(a.status).toBe(201);
    correction = a.body.id;
    expect((await staff().post(`${C()}/nonconformities/${ncr}/actions`, { kind: 'follow_up', description: 'Müdür kontrol etsin', ownerId: demo.users.manager.id })).status).toBe(403);
    const b = await manager().post(`${C()}/nonconformities/${ncr}/actions`, { kind: 'follow_up', description: 'Kapı kontrolünü açılış listesine ekle.', ownerId: demo.users.staff.id, dueAt: later(-1) });
    expect(b.status).toBe(201);
    expect((await notes(demo.users.staff.id, 'action_assigned')).length).toBe(1);
  });

  it('due soon and overdue are announced once each, however often the scan runs', async () => {
    await scanDeadlines(env.db);
    await scanDeadlines(env.db);
    expect((await notes(demo.users.staff.id, 'action_due_soon')).length).toBe(1);
    expect((await notes(demo.users.staff.id, 'action_overdue')).length).toBe(1);
    // The case itself becomes overdue later: owner and managers are told, once.
    await scanDeadlines(env.db, new Date(Date.now() + 80 * 3600_000));
    await scanDeadlines(env.db, new Date(Date.now() + 81 * 3600_000));
    expect((await notes(demo.users.staff.id, 'ncr_overdue')).length).toBe(1);
    expect((await notes(demo.users.manager.id, 'ncr_overdue')).length).toBe(1);
    expect((await notes(otherManager.id)).length).toBe(0);
  });

  it('the inbox shows only what the person can open, with an unread count; marking read works', async () => {
    const inbox = (await staff().get(`${C()}/notifications`)).body;
    expect(inbox.unread).toBeGreaterThan(0);
    expect(inbox.items.every((n: any) => n.entity_id)).toBe(true);
    expect((await staff().post(`${C()}/notifications/read`, { ids: 'all' })).status).toBe(200);
    expect((await staff().get(`${C()}/notifications`)).body.unread).toBe(0);
    expect((await client(env, otherManager.token).get(`${C()}/notifications`)).body.items).toEqual([]);
  });

  it('the effectiveness check waits until actions are done and the root cause is verified', async () => {
    const N = `${C()}/nonconformities/${ncr}`;
    expect((await staff().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Kapı kapanıyor.' })).body.error.code).toBe('FLOW_INCOMPLETE');
    expect((await staff().post(`${N}/actions/${correction}`, { op: 'done', notes: 'Bant yapıştırıldı, kapı kapanıyor.' })).status).toBe(200);
    const ca = await manager().post(`${N}/actions`, { kind: 'corrective_action', description: 'Contayı yenisiyle değiştir (servis).', ownerId: demo.users.manager.id });
    expect((await manager().post(`${N}/actions/${ca.body.id}`, { op: 'done', notes: 'Yeni conta takıldı.' })).status).toBe(200);
    const d = (await staff().get(N)).body;
    expect(d.flow.blockers.join(' ')).toContain('Kök neden');
    expect((await manager().post(`${N}/causes`, { stage: 'verified', categories: ['equipment', 'process'], notes: 'Conta aşınmış; açılış kontrolünde kapı yoktu.' })).status).toBe(201);
    expect((await staff().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'İki gün boyunca kapı kapalı, ölçümler 3 °C.' })).status).toBe(201);
    expect((await notes(demo.users.manager.id, 'ncr_verification_requested')).length).toBe(1);
    expect((await notes(demo.users.owner.id, 'ncr_verification_requested')).length).toBe(1);
  });
});

describe('verification, failure, close, reopen', () => {
  it('a failed verification keeps the case open and asks for a new round', async () => {
    const N = `${C()}/nonconformities/${ncr}`;
    expect((await owner().post(`${N}/verify`, { result: 'not_effective', notes: 'kısa' })).status).toBe(422);
    const r = await owner().post(`${N}/verify`, { result: 'not_effective', notes: 'Bugünkü ölçüm 7 °C; kapı yine aralık kalıyor.' });
    expect(r.body).toEqual({ status: 'open', iteration: 2 });
    expect((await notes(demo.users.staff.id, 'ncr_verification_failed')).length).toBe(1);
    const d = (await staff().get(N)).body;
    expect(d.status).toBe('open');
    expect(d.flow.blockers.join(' ')).toContain('yeni bir aksiyon');
    expect((await staff().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Tekrar baktım.' })).body.error.code).toBe('FLOW_INCOMPLETE');
  });

  it('new round: new action, root cause confirmed again, new check; the person who fixed it cannot verify', async () => {
    const N = `${C()}/nonconformities/${ncr}`;
    const a = await manager().post(`${N}/actions`, { kind: 'corrective_action', description: 'Kapı menteşesi ayarlansın (servis).', ownerId: demo.users.manager.id });
    await manager().post(`${N}/actions/${a.body.id}`, { op: 'done', notes: 'Menteşe ayarlandı, kapı kendiliğinden kapanıyor.' });
    await manager().post(`${N}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Menteşe sarkmış; conta tek başına yetmedi.' });
    expect((await staff().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'Üç gün boyunca 2–4 °C.' })).status).toBe(201);
    expect((await manager().post(`${N}/verify`, { result: 'effective', notes: 'Kontrol ettim.' })).body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
    expect((await owner().post(`${N}/verify`, { result: 'effective', notes: 'Ölçüm kayıtları ve servis raporu incelendi.' })).body.status).toBe('closed');
  });

  it('reopening needs a reason, starts a new round and keeps the earlier closure in the history', async () => {
    const N = `${C()}/nonconformities/${ncr}`;
    expect((await staff().post(`${N}/reopen`, { reason: 'Sorun tekrarladı, kapı açık.' })).status).toBe(403);
    expect((await owner().post(`${N}/reopen`, { reason: 'kısa' })).status).toBe(422);
    expect((await owner().post(`${N}/reopen`, { reason: 'Sabah ölçümü 9 °C; kapı yine açık kalmış.' })).status).toBe(200);
    const d = (await owner().get(N)).body;
    expect(d).toMatchObject({ status: 'open', iteration: 3, reopened_count: 1, closed_at: null });
    expect(d.verifications.map((v: any) => v.result)).toEqual(['not_effective', 'effective', 'reopened']);
    expect((await notes(demo.users.staff.id, 'ncr_reopened')).length).toBe(1);
  });
});

describe('service delivery does not close a case', () => {
  it('accepting the service report leaves the linked case open', async () => {
    const pro = client(env, provider.token);
    const req = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Kapı ve conta onarımı',
      description: 'Kapı açık kalıyor.', city: 'İstanbul', ncrId: ncr });
    expect(req.status).toBe(201);
    const q = await pro.post(`/pro/requests/${req.body.id}/quotes`, { scope: 'Conta ve menteşe', exclusions: 'Kompresör', priceNet: 500, vatRate: 20,
      materials: 'Conta', durationText: '1 saat', warrantyText: '3 ay', validUntil: later(72) });
    const acc = await owner().post(`${C()}/quotes/${q.body.id}/accept`);
    await pro.post(`/pro/jobs/${acc.body.jobId}/check-in`, { code: acc.body.checkinCode });
    await pro.post(`/pro/jobs/${acc.body.jobId}/report`, { report: 'Conta ve menteşe değiştirildi; 30 dk sonra iç sıcaklık 3 °C ölçüldü.' });
    const done = await owner().post(`${C()}/jobs/${acc.body.jobId}/acceptance`, { accept: true, note: 'Rapor okundu.' });
    expect(done.status).toBe(200);
    const d = (await owner().get(`${C()}/nonconformities/${ncr}`)).body;
    expect(d.status).toBe('open');
    expect(d.services[0]).toMatchObject({ status: 'completed', job_status: 'accepted' });
  });
});

describe('suspended owner → reassignment list', () => {
  it('open work of a suspended person shows up for managers, who are told once', async () => {
    const members = (await owner().get(`${C()}/members`)).body as any[];
    const m = members.find(x => x.id === demo.users.staff.id)!;
    const a = await manager().post(`${C()}/nonconformities/${ncr}/actions`, { kind: 'corrective_action', description: 'Kapı alarmı tak.', ownerId: demo.users.staff.id });
    expect(a.status).toBe(201);
    expect((await owner().post(`${C()}/members/${m.membership_id}/suspend`, { reason: 'İzinli, ayrıldı' })).status).toBe(200);
    const q = (await manager().get(`${C()}/reassignment-queue`)).body;
    expect(q.nonconformities.map((x: any) => x.id)).toContain(ncr);
    expect(q.actions.map((x: any) => x.id)).toContain(a.body.id);
    expect((await client(env, otherManager.token).get(`${C()}/reassignment-queue`)).body.nonconformities).toEqual([]);
    expect((await notes(demo.users.manager.id, 'reassignment_needed')).length).toBe(1);
    // Reassigning removes it from the list.
    await manager().post(`${C()}/nonconformities/${ncr}/assignment`, { ownerId: demo.users.manager.id, dueAt: later(24), reason: 'Elif ayrıldı, ben alıyorum.' });
    expect(q.actions.length).toBe(2); // this one and the earlier follow-up still open
    for (const x of q.actions) await manager().post(`${C()}/nonconformities/${ncr}/actions/${x.id}`, { op: 'reassign', ownerId: demo.users.manager.id });
    const q2 = (await manager().get(`${C()}/reassignment-queue`)).body;
    expect(q2.nonconformities).toEqual([]);
    expect(q2.actions).toEqual([]);
  });
});
