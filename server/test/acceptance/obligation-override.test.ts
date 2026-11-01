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
