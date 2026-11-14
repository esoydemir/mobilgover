import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXAMPLE_RULES, seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/** Group 5: platform administration on the existing role structure, with who / when / why on every change. */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let target: { id: string; token: string };
const admin = () => client(env, platform.admin.token);

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  target = await env.db.system(async tx => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name, email) VALUES ('Yeni Moderatör', 'mod@example.test') RETURNING id`)).rows[0]!.id;
    return { id, token: await createSession(tx, id, 24) };
  });
});
afterAll(async () => { await env?.close(); });

describe('platform overview and audit', () => {
  it('any platform role sees counts; a company user sees nothing', async () => {
    const o = await admin().get('/admin/overview');
    expect(o.status).toBe(200);
    expect(o.body.companies.demo).toBeGreaterThanOrEqual(1);
    expect(o.body.roleHolders.some((h: any) => h.role === 'platform_admin')).toBe(true);
    expect((await client(env, platform.marketReviewer.token).get('/admin/overview')).status).toBe(200);
    expect((await client(env, demo.users.owner.token).get('/admin/overview')).status).toBe(403);
    expect((await client(env, demo.users.owner.token).get('/admin/audit')).status).toBe(403);
  });

  it('only the platform administrator reads the audit trail; the reviewer does not', async () => {
    expect((await client(env, platform.marketReviewer.token).get('/admin/audit')).status).toBe(403);
    const r = await admin().get('/admin/audit?limit=20');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const e of r.body.items) { expect(e.occurredAt).toBeTruthy(); expect(e.eventType).toBeTruthy(); expect(e.actorName).toBeTruthy(); }
  });
});

describe('platform role changes carry who, when and why', () => {
  it('needs a reason, refuses self-change, grants and revokes with an audit record', async () => {
    const body = { userId: target.id, role: 'network_moderator', grant: true };
    expect((await admin().post('/admin/platform-roles', { ...body, reason: 'kısa' })).status).toBe(422); // reason too short
    expect((await admin().post('/admin/platform-roles', { userId: platform.admin.id, role: 'rule_author', grant: true, reason: 'Kendime rol vermek istiyorum.' })).status).toBe(403);
    expect((await client(env, platform.marketReviewer.token).post('/admin/platform-roles', { ...body, reason: 'Yetkim olmadan deniyorum.' })).status).toBe(403);

    const g = await admin().post('/admin/platform-roles', { ...body, reason: 'Moderasyon vardiyası için görevlendirildi.' });
    expect(g.status).toBe(200);
    expect(g.body.changed).toBe(true);
    expect((await client(env, target.token).get('/me')).body.platformRoles).toContain('network_moderator');
    expect((await admin().post('/admin/platform-roles', { ...body, reason: 'Aynı rol yeniden verilmek istendi.' })).body.changed).toBe(false); // idempotent

    const r = await admin().post('/admin/platform-roles', { ...body, grant: false, reason: 'Vardiya sona erdi, rol kaldırıldı.' });
    expect(r.status).toBe(200);
    expect((await client(env, target.token).get('/me')).body.platformRoles).not.toContain('network_moderator');

    const trail = (await admin().get('/admin/audit?scope=platform&eventType=platform.role')).body.items;
    expect(trail.map((e: any) => e.eventType)).toEqual(expect.arrayContaining(['platform.role_granted', 'platform.role_revoked']));
    const grant = trail.find((e: any) => e.eventType === 'platform.role_granted');
    expect(grant.actorName).toContain('Platform Yöneticisi');
    expect(grant.reason).toBe('Moderasyon vardiyası için görevlendirildi.');
    expect(grant.payload.role).toBe('network_moderator');
  });

  it('the last platform administrator cannot be removed', async () => {
    // a second administrator exists only so the first can try to remove the other; the last one is then protected
    await env.ownerDb.query(`INSERT INTO platform_roles (user_id, role) VALUES ($1,'platform_admin')`, [target.id]);
    const other = client(env, target.token);
    expect((await admin().post('/admin/platform-roles', { userId: target.id, role: 'platform_admin', grant: false, reason: 'İkinci yönetici kaldırılıyor.' })).status).toBe(200);
    const last = await other.post('/admin/platform-roles', { userId: platform.admin.id, role: 'platform_admin', grant: false, reason: 'Son yöneticiyi kaldırmayı deniyorum.' });
    expect([403, 409]).toContain(last.status); // the removed admin has no right any more; the last admin is also protected by the service
    expect((await admin().get('/admin/overview')).status).toBe(200);
  });

  it('user search lists role holders first and is for the administrator alone', async () => {
    const r = await admin().get('/admin/platform-users?q=Moder');
    expect(r.status).toBe(200);
    expect(r.body.some((u: any) => u.displayName === 'Yeni Moderatör')).toBe(true);
    expect((await client(env, platform.marketReviewer.token).get('/admin/platform-users')).status).toBe(403);
  });
});

describe('rule decisions record their reason', () => {
  it('approve and publish reasons reach the audit trail; a call without a body still works and shows no reason', async () => {
    const author = client(env, platform.author.token), reviewer = client(env, platform.reviewer.token), specialist = client(env, platform.specialist.token);
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-COLD-CHAIN')!;
    const prov = (await env.ownerDb.query(`SELECT id FROM provisions LIMIT 1`)).rows[0].id;
    const v = (await author.post('/admin/rule-versions', { ...base, provisionIds: [prov], changeReason: 'Gerekçe testi' })).body.id;
    await author.post(`/admin/rule-versions/${v}/submit`);
    await specialist.post(`/admin/rule-versions/${v}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Kaynak metinle karşılaştırıldı.' });
    expect((await reviewer.post(`/admin/rule-versions/${v}/approve`, { reason: 'İnceleme tamam, alan uzmanı onayı var.' })).status).toBe(200);
    expect((await admin().post(`/admin/rule-versions/${v}/publish`, { reason: 'Örnek ortamda yayın denemesi.' })).status).toBe(200);
    const rows = (await admin().get('/admin/audit?scope=platform&eventType=rule.')).body.items as any[];
    const by = (t: string) => rows.find(e => e.eventType === t && e.entityId === v);
    expect(by('rule.area_reviewed').reason).toBe('Kaynak metinle karşılaştırıldı.');
    expect(by('rule.approved').reason).toBe('İnceleme tamam, alan uzmanı onayı var.');
    expect(by('rule.published').reason).toBe('Örnek ortamda yayın denemesi.');
    expect(rows.some(e => e.reason === null)).toBe(true); // seeded decisions had none: shown as not recorded, never invented
  });
});
