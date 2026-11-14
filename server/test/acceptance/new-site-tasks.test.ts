import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** A site added later: its decisions start at once, the reason for "no tasks" is readable, answers bring tasks, re-runs add nothing twice. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const tasksOf = async (siteId: string) => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1 AND status <> 'cancelled'`, [siteId])).rows[0].n as number;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 7);
});
afterAll(async () => { await env?.close(); });

describe('task generation for a newly added site', () => {
  let siteId: string;

  it('adding a site computes its decisions; without site-level answers they wait for information and no task is invented', async () => {
    const r = await owner().post(`${C()}/sites`, { name: 'Yeni Şube Test' });
    expect(r.status).toBe(201);
    siteId = r.body.id;
    const obs = (await owner().get(`${C()}/obligations?siteId=${siteId}`)).body as any[];
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.some(o => o.decision === 'needs_info')).toBe(true);
    expect(obs.every(o => o.decision !== 'applies' || o.missingFacts.length === 0)).toBe(true);
    expect(await tasksOf(siteId)).toBe(r.body.createdTasks);
  });

  it('after the site-level answers are given, tasks appear without waiting for the hourly top-up', async () => {
    const catalog = (await owner().get('/fact-catalog')).body as { key: string; level: string }[];
    const first = (await owner().get(`${C()}/sites/${demo.siteId}/profile`)).body as Record<string, { value: unknown }>;
    let created = 0;
    for (const item of catalog.filter(c => c.level === 'site' && first[c.key] && c.key !== 'equipment.types')) {
      const res = await owner().post(`${C()}/profile/facts`, { siteId, key: item.key, value: first[item.key]!.value, source: 'user_declared', verification: 'user_confirmed' });
      expect(res.status).toBe(201);
      created += res.body.createdTasks;
    }
    // Per-unit checks need equipment: add the same kind of fridge to the new site; its checks are created in the same request.
    const eq = await owner().post(`${C()}/equipment`, { siteId, type: 'fridge', name: 'Yeni şube buzdolabı' });
    expect(eq.status).toBe(201);
    created += eq.body.createdTasks;
    expect(created).toBeGreaterThan(0);
    expect(await tasksOf(siteId)).toBe(created);
  });

  it('repeating the operation never opens the same task twice', async () => {
    const before = await tasksOf(siteId);
    const day = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < 2; i++) {
      const g = await owner().post(`${C()}/tasks/generate`, { siteId, fromDay: day, toDay: to });
      expect(g.status).toBe(200);
      expect(g.body.created).toBe(0);
    }
    await topUpAllSites(env.db, 14);
    expect(await tasksOf(siteId)).toBe(before);
    const dup = (await env.ownerDb.query(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM tasks WHERE site_id = $1 GROUP BY rule_id, template_code, equipment_id, period_key HAVING count(*) > 1) d`, [siteId])).rows[0].n;
    expect(dup).toBe(0);
  });

  it('a site that has no decisions yet (added before this fix) heals itself on the next generate or top-up', async () => {
    const r = await owner().post(`${C()}/sites`, { name: 'Eski Tip Şube' });
    const old = r.body.id as string;
    await env.ownerDb.query(`DELETE FROM obligations WHERE site_id = $1`, [old]);
    expect((await owner().get(`${C()}/obligations?siteId=${old}`)).body).toHaveLength(0);
    await topUpAllSites(env.db, 7);
    expect(((await owner().get(`${C()}/obligations?siteId=${old}`)).body as any[]).length).toBeGreaterThan(0);
  });
});
