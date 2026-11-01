import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Equipment register edits: rename, calibration renewal, out of use / back in use. Real HTTP + PostgreSQL. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const openFridgeTasks = async () => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks WHERE equipment_id = $1 AND status = 'open'
     AND due_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')`, [demo.fridgeId])).rows[0].n as number;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 7);
});
afterAll(async () => { await env?.close(); });

describe('equipment edits', () => {
  it('a site manager renames a unit and renews a thermometer calibration; the change is kept and audited', async () => {
    const r = await manager().patch(`${C()}/equipment/${demo.thermometerId}`, { name: 'Dijital termometre · Mutfak', calibratedUntil: '2031-03-31' });
    expect(r.status).toBe(200);
    const list = (await owner().get(`${C()}/sites/${demo.siteId}/equipment`)).body as any[];
    expect(list.find(e => e.id === demo.thermometerId)).toMatchObject({ name: 'Dijital termometre · Mutfak', calibrated_until: '2031-03-31', active: true });
    const a = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'equipment.updated' AND entity_id = $1`, [demo.thermometerId])).rows[0];
    expect(a.payload.changes.calibrated_until.to).toBe('2031-03-31');
  });

  it('staff cannot edit equipment; an unknown unit is not found', async () => {
    expect((await staff().patch(`${C()}/equipment/${demo.fridgeId}`, { name: 'Başka ad' })).status).toBe(403);
    expect((await owner().patch(`${C()}/equipment/00000000-0000-4000-8000-000000000000`, { name: 'Başka ad' })).status).toBe(404);
  });

  it('taking a unit out of use needs a reason and cancels only its open checks from today on', async () => {
    expect(await openFridgeTasks()).toBeGreaterThan(0);
    expect((await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: false })).status).toBe(422);
    const r = await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: false, reason: 'Arızalı, servise gitti' });
    expect(r.status).toBe(200);
    expect(r.body.cancelledTasks).toBeGreaterThan(0);
    expect(await openFridgeTasks()).toBe(0);
    const reason = (await env.ownerDb.query(`SELECT status_reason FROM tasks WHERE equipment_id = $1 AND status = 'cancelled' LIMIT 1`, [demo.fridgeId])).rows[0].status_reason;
    expect(reason).toContain('Arızalı');
    // While out of use, no new checks are generated for it.
    await topUpAllSites(env.db, 10);
    expect(await openFridgeTasks()).toBe(0);
  });

  it('back in use: checks are generated again', async () => {
    const r = await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: true });
    expect(r.status).toBe(200);
    expect(r.body.createdTasks).toBeGreaterThan(0);
    expect(await openFridgeTasks()).toBe(r.body.createdTasks);
  });
});
