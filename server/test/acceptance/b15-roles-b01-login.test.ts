import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** B-15: moderation is its own platform role; platform administration does not include it. B-01: the sign-in code shortcut exists only in demo. */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
beforeAll(async () => { env = await freshEnv(); platform = await seedPlatform(env.db); });
afterAll(async () => { await env?.close(); });

describe('B-15 platform administrator is not a moderator', () => {
  it('has the administration role only, and every moderation entry refuses them', async () => {
    const admin = client(env, platform.admin.token);
    expect((await admin.get('/me')).body.platformRoles).toEqual(['platform_admin']);
    expect((await admin.get('/network/moderation/reports')).status).toBe(403);
    expect((await admin.get('/network/moderation/appeals')).status).toBe(403);
    expect((await admin.post('/network/moderation/reports/00000000-0000-4000-8000-000000000000', { decision: 'hide', notes: 'Yönetici olarak karar vermeyi deniyorum.' })).status).toBe(403);
  });

  it('moderation arrives only through an explicit, reasoned role grant, and is visible in the role list', async () => {
    const admin = client(env, platform.admin.token);
    const target = platform.marketReviewer.id;
    expect((await env.ownerDb.query(`SELECT role FROM platform_roles WHERE user_id = $1 ORDER BY role`, [target])).rows.map(r => r.role)).toEqual(['marketplace_reviewer']);
    expect((await admin.post('/admin/platform-roles', { userId: target, role: 'network_moderator', grant: true, reason: 'Moderasyon vardiyası için görevlendirildi.' })).status).toBe(200);
    expect((await client(env, platform.marketReviewer.token).get('/me')).body.platformRoles.sort()).toEqual(['marketplace_reviewer', 'network_moderator']);
    // Granting administration to someone does not add moderation either.
    const author = platform.author.id;
    await admin.post('/admin/platform-roles', { userId: author, role: 'platform_admin', grant: true, reason: 'Yönetim yardımcısı olarak görevlendirildi.' });
    expect((await env.ownerDb.query(`SELECT role FROM platform_roles WHERE user_id = $1 ORDER BY role`, [author])).rows.map(r => r.role)).not.toContain('network_moderator');
  });
});

describe('B-01 pilot sign-in has no demo-code shortcut', () => {
  it('a pilot environment reports pilot mode with no demo domain and a closed dev outbox', async () => {
    const pilot = await freshEnv({ demoMode: false });
    try {
      const anon = client(pilot, '');
      const e = (await anon.get('/env')).body;
      expect(e.mode).toBe('pilot');
      expect(e.demoLoginDomain).toBeUndefined();
      await anon.post('/auth/email/start', { email: 'pilot.kullanici@ornek.com.tr' });
      expect((await anon.get('/dev/outbox/latest?email=pilot.kullanici@ornek.com.tr')).status).toBe(404);
    } finally { await pilot.close(); }
  });

  it('the demo environment signs in normally through its outbox', async () => {
    const demo = await freshEnv({ demoMode: true, demoLoginDomain: 'demo.goverhub.test' });
    try {
      const anon = client(demo, '');
      expect((await anon.get('/env')).body).toMatchObject({ mode: 'demo', demoLoginDomain: 'demo.goverhub.test' });
      expect((await anon.post('/auth/email/start', { email: 'yeni@demo.goverhub.test' })).status).toBe(200);
      const code = /(\d{6})/.exec((await anon.get('/dev/outbox/latest?email=yeni@demo.goverhub.test')).body.body)![1];
      expect((await anon.post('/auth/email/verify', { email: 'yeni@demo.goverhub.test', code })).body.token).toBeTruthy();
    } finally { await demo.close(); }
  });
});
