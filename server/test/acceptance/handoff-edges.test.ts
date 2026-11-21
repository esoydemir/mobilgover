import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReportRules, seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Role hand-offs and races: a task whose assignee is suspended, the same quote accepted twice at the same moment,
 * and an outside verifier whose grant ends while their page is open.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let pro: { id: string; token: string };
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  env = await freshEnv();
  const platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await ensureReportRules(env.db);
  await topUpAllSites(env.db, 14);
  pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.devir@ornek.test');
});
afterAll(async () => { await env?.close(); });

describe('assignee suspended while holding open tasks', () => {
  it('the open tasks do not stay silently with a person who can no longer act', async () => {
    const from = new Date().toISOString(), to = new Date(Date.now() + 3 * 864e5).toISOString();
    const all = (await manager().get(`${C()}/tasks?siteId=${demo.siteId}&from=${from}&to=${to}`)).body as any[];
    const t = all.find(x => x.status === 'open')!;
    expect((await manager().post(`${C()}/tasks/${t.id}/assign`, { userId: demo.users.staff.id })).status).toBe(200);
    expect((await staff().get(`${C()}/tasks/${t.id}`)).status).toBe(200);
    const m = ((await owner().get(`${C()}/members`)).body as any[]).find(x => x.id === demo.users.staff.id)!;
    expect((await owner().post(`${C()}/members/${m.membership_id}/suspend`, { reason: 'İşten ayrıldı' })).status).toBe(200);
    // The former assignee can no longer read or act.
    expect((await staff().get(`${C()}/tasks/${t.id}`)).status).toBe(404);
    // It surfaces in the managers' reassignment queue (computed from active memberships), and the managers were told once.
    const q = (await manager().get(`${C()}/reassignment-queue`)).body;
    expect(q.tasks.map((x: any) => x.id)).toContain(t.id);
    const told = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'reassignment_needed'`, [demo.users.manager.id])).rows[0].n;
    expect(told).toBe(1);
    // A manager can give it to someone else and the new person sees it.
    expect((await manager().post(`${C()}/tasks/${t.id}/assign`, { userId: demo.users.manager.id })).status).toBe(200);
    expect((await manager().get(`${C()}/reassignment-queue`)).body.tasks.map((x: any) => x.id)).not.toContain(t.id);
  });
});

describe('the same quote accepted at the same moment', () => {
  it('gives one job, one set of notifications; the second answer is a clear refusal or the same job', async () => {
    const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Yarış denemesi', description: 'Servis.', city: 'İstanbul', ncrId: null, taskId: null })).body.id;
    const q = (await client(env, pro.token).post(`/pro/requests/${reqId}/quotes`, { scope: 'Servis', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Parça', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
    const [a, b] = await Promise.all([owner().post(`${C()}/quotes/${q}/accept`), manager().post(`${C()}/quotes/${q}/accept`)]);
    const codes = [a.status, b.status].sort();
    expect(codes.every(s => s === 200 || s === 201 || s === 409 || s === 422)).toBe(true);
    expect(codes.some(s => s === 200 || s === 201)).toBe(true);
    const jobs = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM service_jobs WHERE request_id = $1`, [reqId])).rows[0].n;
    expect(jobs).toBe(1);
    const acc = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM audit_events WHERE company_id = $1 AND event_type = 'service.quote_accepted' AND payload::text LIKE '%' || $2 || '%'`, [demo.companyId, q])).rows[0].n;
    expect(acc).toBe(1);
    const notes = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'service_quote_accepted'`, [pro.id])).rows[0].n;
    expect(notes).toBeLessThanOrEqual(1);
  });
});

describe('outside verifier whose permission ends while their page is open', () => {
  it('the next page load, file access and decision follow the current permission', async () => {
    const ncr = await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'İzin süresi denemesi', description: 'Açıklama: test kaydı.', hazardType: 'cleaning', severity: 'major', containment: 'Alan kapatıldı.' });
    expect(ncr.status).toBe(201);
    const email = 'bagimsiz.izin@ornek.test';
    expect((await owner().post(`${C()}/verifiers`, { email, siteId: demo.siteId, days: 30, note: 'Bağımsız doğrulama için.' })).status).toBe(201);
    const uid = (await env.ownerDb.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
    const tok = await env.db.system(async tx => createSession(tx, uid));
    const ex = () => client(env, tok);
    const url = `${C()}/nonconformities/${ncr.body.id}`;
    expect((await ex().get(url)).status).toBe(200);
    await env.ownerDb.query(`UPDATE access_grants SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [uid]);
    expect((await ex().get(url)).status).toBe(404);
    expect((await ex().get(`${C()}/verification-queue`)).status).toBe(404);
    const decide = await ex().post(`${url}/closure`, { result: 'effective', notes: 'Süresi dolmuş izinle karar denemesi.' });
    expect([403, 404, 422]).toContain(decide.status);
    // The decision attempt wrote nothing.
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM ncr_verifications WHERE ncr_id = $1`, [ncr.body.id])).rows[0].n).toBe(0);
  });
});
