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

  it('taking a unit out of use needs a reason; checks ahead are cancelled, a check already past its time stays as overdue', async () => {
    // A check of this unit whose time has passed (overdue): it must not disappear.
    const past = (await env.ownerDb.query(`SELECT id FROM tasks WHERE equipment_id = $1 AND status = 'open' ORDER BY due_at LIMIT 1`, [demo.fridgeId])).rows[0].id;
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '2 hours' WHERE id = $1`, [past]);
    const preview = (await owner().get(`${C()}/equipment/${demo.fridgeId}/open-checks`)).body;
    expect(preview.overdue).toBe(1);
    expect(preview.upcoming).toBeGreaterThan(0);
    expect((await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: false })).status).toBe(422);
    const r = await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: false, reason: 'Arızalı, servise gitti' });
    expect(r.status).toBe(200);
    expect(r.body.cancelledTasks).toBe(preview.upcoming);
    expect(r.body.overdueKept).toBe(1);
    expect((await env.ownerDb.query(`SELECT status FROM tasks WHERE id = $1`, [past])).rows[0].status).toBe('open');
    const reason = (await env.ownerDb.query(`SELECT status_reason, cancel_code FROM tasks WHERE equipment_id = $1 AND status = 'cancelled' LIMIT 1`, [demo.fridgeId])).rows[0];
    expect(reason.status_reason).toContain('Arızalı');
    expect(reason.cancel_code).toBe('equipment_retired');
    // While out of use, no new checks are generated for it.
    await topUpAllSites(env.db, 10);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE equipment_id = $1 AND status = 'open' AND due_at >= now()`, [demo.fridgeId])).rows[0].n).toBe(0);
  });

  it('back in use: the cancelled checks are reopened, not created again; no period has two tasks', async () => {
    const before = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE equipment_id = $1`, [demo.fridgeId])).rows[0].n;
    const r = await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: true });
    expect(r.status).toBe(200);
    expect(r.body.restoredTasks).toBeGreaterThan(0);
    expect(r.body.openChecks).toBeGreaterThanOrEqual(r.body.restoredTasks);
    const after = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE equipment_id = $1`, [demo.fridgeId])).rows[0].n;
    // Only periods beyond the earlier horizon may be new.
    expect(after - before).toBe(r.body.openChecks - r.body.restoredTasks);
    const dup = (await env.ownerDb.query(`SELECT period_key, count(*)::int AS n FROM tasks WHERE equipment_id = $1 GROUP BY template_code, period_key HAVING count(*) > 1`, [demo.fridgeId])).rows;
    expect(dup).toEqual([]);
    // Retire and reactivate again: still one task per period.
    await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: false, reason: 'İkinci kez arıza' });
    await owner().patch(`${C()}/equipment/${demo.fridgeId}`, { active: true });
    await topUpAllSites(env.db, 14);
    const dup2 = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM (SELECT 1 FROM tasks WHERE equipment_id = $1 GROUP BY template_code, period_key HAVING count(*) > 1) d`, [demo.fridgeId])).rows[0].n;
    expect(dup2).toBe(0);
    // The overdue check kept from before is still there, still open.
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE equipment_id = $1 AND status = 'open' AND due_at < now()`, [demo.fridgeId])).rows[0].n).toBe(1);
  });
});
