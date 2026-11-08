import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Manual "does not apply" decision and its withdrawal. Rules are EXAMPLES. Real HTTP + PostgreSQL. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
let gloveId: string;
let overrideId: string;
const openGlove = async () => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND template_code = 'glove_daily' AND status = 'open'`, [demo.companyId])).rows[0].n as number;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 7);
  const list = (await owner().get(`${C()}/obligations`)).body as any[];
  gloveId = list.find(o => o.rule === 'EX-GLOVE').id;
});
afterAll(async () => { await env?.close(); });

describe('manual "does not apply"', () => {
  it('a site manager may not decide it; a short reason is refused', async () => {
    expect((await manager().post(`${C()}/obligations/${gloveId}/not-applicable`, { reason: 'Bizde eldiven kullanılmıyor, çünkü…' })).status).toBe(403);
    expect((await owner().post(`${C()}/obligations/${gloveId}/not-applicable`, { reason: 'yok' })).status).toBe(422);
  });

  it('the owner decides with a reason: open checks are cancelled, the decision shows who made it', async () => {
    expect(await openGlove()).toBeGreaterThan(0);
    const r = await owner().post(`${C()}/obligations/${gloveId}/not-applicable`, { reason: 'Mutfakta yalnızca paketli ürün servis ediliyor, hazırlık yapılmıyor.' });
    expect(r.status).toBe(201);
    overrideId = r.body.id;
    expect(await openGlove()).toBe(0);
    const e = (await owner().get(`${C()}/obligations/${overrideId}/explanation`)).body;
    expect(e.obligation).toMatchObject({ decision: 'not_applicable', manual: true, isCurrent: true, canOverride: true });
    expect(e.obligation.decidedByName).toContain('Ahmet');
    const old = (await owner().get(`${C()}/obligations/${gloveId}/explanation`)).body;
    expect(old.obligation).toMatchObject({ isCurrent: false, currentId: overrideId });
    // It stands: generation adds no checks for it.
    await topUpAllSites(env.db, 7);
    expect(await openGlove()).toBe(0);
  });

  it('withdrawing it lets the engine decide again and brings the checks back; history keeps all three', async () => {
    expect((await manager().post(`${C()}/obligations/${overrideId}/withdraw-override`, {})).status).toBe(403);
    expect((await owner().post(`${C()}/obligations/${gloveId}/withdraw-override`, {})).status).toBe(409); // not the current decision
    const r = await owner().post(`${C()}/obligations/${overrideId}/withdraw-override`, {});
    expect(r.status).toBe(200);
    expect(r.body.decision).toBe('applies');
    expect(r.body.createdTasks).toBeGreaterThan(0);
    expect(await openGlove()).toBeGreaterThan(0);
    const e = (await owner().get(`${C()}/obligations/${r.body.id}/explanation`)).body;
    expect(e.obligation.manual).toBe(false);
    expect(e.history.map((h: any) => h.decision)).toEqual(['applies', 'not_applicable', 'applies']);
    expect((await owner().post(`${C()}/obligations/${r.body.id}/withdraw-override`, {})).status).toBe(409); // engine decision
    const audit = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'obligation.override_withdrawn'`)).rows[0].n;
    expect(audit).toBe(1);
  });
});

describe('"does not apply" on a mandatory obligation goes to review', () => {
  const expert = () => client(env, demo.users.expert.token);
  const staffC = () => client(env, demo.users.staff.token);
  let coldId: string, requestId: string, overdueTask: string;

  it('the request does not take effect; checks continue; the requester cannot review it', async () => {
    const list = (await owner().get(`${C()}/obligations`)).body as any[];
    coldId = list.find(o => o.rule === 'EX-COLD-CHAIN').id;
    expect((await manager().post(`${C()}/obligations/${coldId}/not-applicable`, { reason: 'Bizde soğuk muhafaza yok, dolap boş duruyor.' })).status).toBe(403);
    const r = await owner().post(`${C()}/obligations/${coldId}/not-applicable`, { reason: 'Dolap yalnızca içecek için; gıda saklanmıyor.' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending_review');
    requestId = r.body.requestId;
    expect((await owner().post(`${C()}/obligations/${coldId}/not-applicable`, { reason: 'Tekrar deniyorum, aynı gerekçe.' })).status).toBe(409);
    const e = (await owner().get(`${C()}/obligations/${coldId}/explanation`)).body;
    expect(e.obligation).toMatchObject({ decision: 'applies', isCurrent: true, mandatory: true });
    expect(e.pendingReview).toMatchObject({ id: requestId, canReview: false });
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND template_code = 'fridge_temp' AND status = 'open'`, [demo.companyId])).rows[0].n).toBeGreaterThan(0);
    expect((await owner().post(`${C()}/override-requests/${requestId}/review`, { decision: 'approved', notes: 'Kendi isteğim.' })).status).toBe(403);
    expect((await staffC().post(`${C()}/override-requests/${requestId}/review`, { decision: 'approved', notes: 'Onaylıyorum.' })).status).toBe(403);
    // Reviewers are told (the expert holds review access); the requester is not.
    const n = (await env.ownerDb.query(`SELECT user_id FROM notifications WHERE kind = 'obligation_review_requested'`)).rows.map(r => r.user_id);
    expect(n).toEqual([demo.users.expert.id]);
  });

  it('approved by the expert: future checks are cancelled, an overdue check becomes "missed" and stays in the audit file; records stay', async () => {
    overdueTask = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND template_code = 'fridge_temp' AND status = 'open' ORDER BY due_at LIMIT 1`, [demo.companyId])).rows[0].id;
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '3 hours' WHERE id = $1`, [overdueTask]);
    const before = (await env.ownerDb.query(`SELECT (SELECT count(*) FROM measurements)::int AS m, (SELECT count(*) FROM evidence)::int AS e, (SELECT count(*) FROM tasks)::int AS t`)).rows[0];
    const r = await expert().post(`${C()}/override-requests/${requestId}/review`, { decision: 'approved', notes: 'Fotoğraflarda dolapta yalnızca içecek var.' });
    expect(r.status).toBe(200);
    const e = (await owner().get(`${C()}/obligations/${r.body.obligationId}/explanation`)).body;
    expect(e.obligation).toMatchObject({ decision: 'not_applicable', manual: true });
    expect(e.reviews.at(-1)).toMatchObject({ status: 'approved' });
    expect((await env.ownerDb.query(`SELECT status, status_reason FROM tasks WHERE id = $1`, [overdueTask])).rows[0].status).toBe('missed');
    const after = (await env.ownerDb.query(`SELECT (SELECT count(*) FROM measurements)::int AS m, (SELECT count(*) FROM evidence)::int AS e, (SELECT count(*) FROM tasks)::int AS t`)).rows[0];
    expect(after).toEqual(before);
    const period = `from=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}T00:00:00%2B03:00&to=2099-01-01T00:00:00Z`;
    const audit = (await owner().get(`${C()}/audit-export?${period}`)).body;
    expect(audit.gaps.some((g: any) => g.type === 'overdue_check' && g.taskId === overdueTask)).toBe(true);
  });

  it('a rejected request changes nothing; the requester is told', async () => {
    const list = (await owner().get(`${C()}/obligations`)).body as any[];
    const lpg = list.find(o => o.rule === 'EX-LPG-CHECK');
    const r = await owner().post(`${C()}/obligations/${lpg.id}/not-applicable`, { reason: 'LPG tüpü bahçede, mutfakta değil.' });
    expect(r.body.status).toBe('pending_review');
    expect((await expert().post(`${C()}/override-requests/${r.body.requestId}/review`, { decision: 'rejected', notes: 'Tüp nerede olursa olsun bağlantı mutfakta.' })).status).toBe(200);
    const e = (await owner().get(`${C()}/obligations/${lpg.id}/explanation`)).body;
    expect(e.obligation).toMatchObject({ decision: 'applies', isCurrent: true });
    expect(e.pendingReview).toBeNull();
    const told = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'obligation_review_done'`, [demo.users.owner.id])).rows[0].n;
    expect(told).toBe(2);
  });
});
