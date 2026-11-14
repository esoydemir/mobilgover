import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** A task explains itself (why, legal basis, last/next date) and knows the service requests opened for it. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 7);
});
afterAll(async () => { await env?.close(); });

describe('task context and service link', () => {
  let taskId: string;
  it('the detail says why the task exists, its legal basis, and when the same check was last done and is due next', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
    const fridge = list.filter(t => t.equipment_name).sort((a, b) => a.due_at.localeCompare(b.due_at))[0]!;
    taskId = fridge.id;
    expect(fridge.open_services).toBe(0);
    const d = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(d.rule.title.length).toBeGreaterThan(3);
    expect(d.rule.summary.length).toBeGreaterThan(3);
    expect(Array.isArray(d.legalBasis)).toBe(true);
    expect(d.lastCompletedAt).toBeNull();
    expect(d.nextDueAt).not.toBeNull();
    expect(new Date(d.nextDueAt).getTime()).toBeGreaterThan(new Date(d.dueAt).getTime());
    expect(d.services).toEqual([]);
  });

  it('a service request opened from the task is linked: the list counts it and the detail shows it', async () => {
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Soğutucu kontrolü', description: 'Görevden açılan servis talebi.', city: 'İstanbul', taskId });
    expect(r.status).toBe(201);
    const list = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[];
    expect(list.find(t => t.id === taskId).open_services).toBe(1);
    const d = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(d.services).toHaveLength(1);
    expect(d.services[0].id).toBe(r.body.id);
  });

  it('a task of another business or an unknown task cannot be linked', async () => {
    const r = await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Başka görev', description: 'Yanlış görev kimliği.', city: 'İstanbul', taskId: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(404);
  });
});
