import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDay } from '../../src/domain/schedule';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Task horizon and assignment. Real HTTP + real PostgreSQL. Rules are EXAMPLES.
 * - Tasks keep coming after the first week (server-side top-up, idempotent).
 * - Staff only see what is assigned to them, so managers can assign a task and make
 *   someone responsible for a recurring check; later tasks are assigned automatically.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const DAY = 86_400_000;
const range = (fromDays: number, toDays: number) =>
  `from=${encodeURIComponent(new Date(Date.now() + fromDays * DAY).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + toDays * DAY).toISOString())}`;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('task horizon', () => {
  it('fills the coming days for every site, and running again adds nothing', async () => {
    const a = await topUpAllSites(env.db, 14);
    expect(a.failed).toEqual([]);
    expect(a.created).toBeGreaterThan(0);
    const b = await topUpAllSites(env.db, 14);
    expect(b.created).toBe(0);
    const later = await owner().get(`${C()}/tasks?siteId=${demo.siteId}&${range(10, 15)}`);
    expect(later.body.length).toBeGreaterThan(0);
  });

  it('three weeks later, new days are added without touching existing tasks', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n, max(due_at) AS last FROM tasks WHERE company_id = $1`, [demo.companyId])).rows[0];
    const r = await topUpAllSites(env.db, 14, new Date(Date.now() + 21 * DAY));
    expect(r.created).toBeGreaterThan(0);
    const after = (await env.ownerDb.query(`SELECT count(*)::int AS n, max(due_at) AS last FROM tasks WHERE company_id = $1`, [demo.companyId])).rows[0];
    expect(after.n).toBe(before.n + r.created);
    expect(new Date(after.last).getTime()).toBeGreaterThan(new Date(before.last).getTime());
  });
});

describe('assignment', () => {
  let gloveTaskId: string;
  let fridgeTaskId: string;

  it('staff see nothing until something is assigned to them', async () => {
    const r = await staff().get(`${C()}/tasks?siteId=${demo.siteId}&${range(-1, 3)}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('only managers can list assignable people; the list holds active members of the site', async () => {
    expect((await staff().get(`${C()}/sites/${demo.siteId}/assignees`)).status).toBe(403);
    const r = await manager().get(`${C()}/sites/${demo.siteId}/assignees`);
    expect(r.status).toBe(200);
    const ids = r.body.map((m: any) => m.id);
    expect(ids).toEqual(expect.arrayContaining([demo.users.staff.id, demo.users.manager.id, demo.users.owner.id]));
    expect(r.body[0].role).toBe('staff'); // staff first: they are the usual assignees
  });

  it('a manager makes staff responsible for a recurring check; later tasks follow', async () => {
    const today = localDay(new Date(), 'Europe/Istanbul');
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&${range(-1, 14)}&status=open`)).body as any[];
    const glove = list.filter(t => t.title === 'Eldiven ve önlük kontrolü');
    expect(glove.length).toBeGreaterThan(3);
    gloveTaskId = glove[0].id;
    fridgeTaskId = list.find(t => t.equipment_id)!.id;
    const r = await manager().post(`${C()}/tasks/${gloveTaskId}/assign`, { userId: demo.users.staff.id, applyToFuture: true });
    expect(r.status).toBe(200);
    expect(r.body.alsoAssigned).toBeGreaterThan(0);
    expect(r.body.seriesResponsible.id).toBe(demo.users.staff.id);

    const mine = (await staff().get(`${C()}/tasks?siteId=${demo.siteId}&${range(-1, 14)}`)).body as any[];
    expect(mine.length).toBe(glove.length);
    expect(mine.every(t => t.assignee_id === demo.users.staff.id && t.assignee_name)).toBe(true);
    expect(mine.some(t => t.id === fridgeTaskId)).toBe(false);
    // Staff can open and work on the assigned task; the detail says who is responsible.
    const d = await staff().get(`${C()}/tasks/${gloveTaskId}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ assignee: { id: demo.users.staff.id }, seriesResponsible: { id: demo.users.staff.id }, canAssign: false });
    expect(today).toBeTruthy();
  });

  it('newly generated tasks of that check are assigned automatically', async () => {
    await topUpAllSites(env.db, 14, new Date(Date.now() + 40 * DAY));
    const late = (await env.ownerDb.query(
      `SELECT count(*) FILTER (WHERE assignee_id = $2)::int AS mine, count(*)::int AS n FROM tasks
        WHERE company_id = $1 AND template_code = 'glove_daily' AND due_at > now() + interval '41 days'`, [demo.companyId, demo.users.staff.id])).rows[0];
    expect(late.n).toBeGreaterThan(0);
    expect(late.mine).toBe(late.n);
  });

  it('staff cannot assign; a task cannot be given to an outsider; a single task can be reassigned', async () => {
    // Staff can see their own task but may not assign it; a task they cannot see looks nonexistent.
    expect((await staff().post(`${C()}/tasks/${gloveTaskId}/assign`, { userId: demo.users.staff.id, applyToFuture: false })).status).toBe(403);
    expect((await staff().post(`${C()}/tasks/${fridgeTaskId}/assign`, { userId: demo.users.staff.id, applyToFuture: false })).status).toBe(404);
    const outsider = demo.users.expert.id;
    expect((await owner().post(`${C()}/tasks/${fridgeTaskId}/assign`, { userId: outsider, applyToFuture: false })).status).toBe(422);
    const one = await owner().post(`${C()}/tasks/${fridgeTaskId}/assign`, { userId: demo.users.staff.id, applyToFuture: false });
    expect(one.status).toBe(200);
    expect(one.body.alsoAssigned).toBe(0);
    const d = (await owner().get(`${C()}/tasks/${fridgeTaskId}`)).body;
    expect(d.assignee.id).toBe(demo.users.staff.id);
    expect(d.seriesResponsible).toBeNull();
    expect(d.canAssign).toBe(true);
  });

  it('a suspended person is no longer given new tasks', async () => {
    const members = (await owner().get(`${C()}/members`)).body as any[];
    const m = members.find(x => x.id === demo.users.staff.id)!;
    expect((await owner().post(`${C()}/members/${m.membership_id}/suspend`, { reason: 'deneme amaçlı' })).status).toBe(200);
    await topUpAllSites(env.db, 14, new Date(Date.now() + 60 * DAY));
    const r = (await env.ownerDb.query(
      `SELECT count(*) FILTER (WHERE assignee_id IS NULL)::int AS free, count(*)::int AS n FROM tasks
        WHERE company_id = $1 AND template_code = 'glove_daily' AND due_at > now() + interval '61 days'`, [demo.companyId])).rows[0];
    expect(r.n).toBeGreaterThan(0);
    expect(r.free).toBe(r.n);
  });

  it('each assignment is in the audit chain', async () => {
    const n = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE company_id = $1 AND event_type = 'task.assigned'`, [demo.companyId])).rows[0].n;
    expect(n).toBe(2);
  });
});
