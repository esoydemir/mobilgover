import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Group 2: bulk assignment shows the affected sites and people first, applies exactly what was shown, and respects site scope. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let site2: string;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const range = () => ({ from: new Date(Date.now() - 864e5).toISOString(), to: new Date(Date.now() + 30 * 864e5).toISOString() });

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 30);
  // Second site with the same answers and a fridge, so it has tasks of its own.
  site2 = (await owner().post(`${C()}/sites`, { name: 'Beşiktaş Çarşı' })).body.id;
  const catalog = (await owner().get('/fact-catalog')).body as { key: string; level: string }[];
  const first = (await owner().get(`${C()}/sites/${demo.siteId}/profile`)).body as Record<string, { value: unknown }>;
  for (const item of catalog.filter(c => c.level === 'site' && first[c.key] && c.key !== 'equipment.types'))
    await owner().post(`${C()}/profile/facts`, { siteId: site2, key: item.key, value: first[item.key]!.value, source: 'user_declared', verification: 'user_confirmed' });
  await owner().post(`${C()}/equipment`, { siteId: site2, type: 'fridge', name: 'Çarşı buzdolabı' });
  await topUpAllSites(env.db, 30);
});
afterAll(async () => { await env?.close(); });

describe('preview', () => {
  it('names each site, the people losing tasks and the sites that are skipped, and changes nothing', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1`, [demo.users.staff.id])).rows[0].n;
    const r = await owner().post(`${C()}/tasks/bulk-assign/preview`, { userId: demo.users.staff.id, ...range() });
    expect(r.status).toBe(200);
    expect(r.body.assignee).toMatchObject({ id: demo.users.staff.id });
    const s1 = r.body.sites.find((s: any) => s.siteId === demo.siteId), s2 = r.body.sites.find((s: any) => s.siteId === site2);
    expect(s1).toMatchObject({ eligible: true, siteName: 'Kadıköy Moda' });
    expect(s1.taskCount).toBeGreaterThan(0);
    expect(s2).toMatchObject({ eligible: false, taskCount: 0 });
    expect(s2.reason).toMatch(/bu şubede görev alamaz/);
    expect(r.body.skippedSites).toEqual([expect.objectContaining({ siteId: site2 })]);
    expect(r.body.total).toBe(s1.taskCount);
    expect(r.body.taskIds).toBeUndefined();
    const after = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1`, [demo.users.staff.id])).rows[0].n;
    expect(after).toBe(before);
  });

  it('a site manager sees only their own site; another site cannot be targeted; staff cannot use it', async () => {
    const r = await manager().post(`${C()}/tasks/bulk-assign/preview`, { userId: demo.users.staff.id, ...range() });
    expect(r.status).toBe(200);
    expect(r.body.sites.map((s: any) => s.siteId)).toEqual([demo.siteId]);
    expect(JSON.stringify(r.body)).not.toMatch(/Beşiktaş/);
    expect((await manager().post(`${C()}/tasks/bulk-assign/preview`, { userId: demo.users.staff.id, siteIds: [site2], ...range() })).status).toBe(422);
    expect((await staff().post(`${C()}/tasks/bulk-assign/preview`, { userId: demo.users.staff.id, ...range() })).status).toBe(403);
  });
});

describe('apply', () => {
  it('refuses when the count differs from what was shown; applies exactly the previewed tasks; writes one audit event', async () => {
    const body = { userId: demo.users.staff.id, ...range() };
    const pre = (await owner().post(`${C()}/tasks/bulk-assign/preview`, body)).body;
    const stale = await owner().post(`${C()}/tasks/bulk-assign`, { ...body, expectedTotal: pre.total + 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BULK_PREVIEW_STALE');
    const ok = await owner().post(`${C()}/tasks/bulk-assign`, { ...body, expectedTotal: pre.total, reason: 'Vardiya değişikliği' });
    expect(ok.status).toBe(200);
    expect(ok.body.assigned).toBe(pre.total);
    const mine = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1 AND site_id = $2 AND status = 'open'`, [demo.users.staff.id, demo.siteId])).rows[0].n;
    expect(mine).toBeGreaterThanOrEqual(pre.total);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1 AND assignee_id = $2`, [site2, demo.users.staff.id])).rows[0].n).toBe(0);
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'task.bulk_assigned'`)).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ assigneeId: demo.users.staff.id, count: pre.total, reason: 'Vardiya değişikliği', skippedSites: [site2] });
    // Running it again finds nothing left to move.
    const again = await owner().post(`${C()}/tasks/bulk-assign/preview`, body);
    expect(again.body.total).toBe(0);
  });
});
