import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_RULES, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** A non-demo deployment: example content and demo resets must be refused. */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;

beforeAll(async () => {
  env = await freshEnv({ demoMode: false, allowExampleRules: false });
  platform = await seedPlatform(env.db);
});
afterAll(async () => { await env?.close(); });

describe('production guards', () => {
  it('refuses to publish an example rule', async () => {
    const author = client(env, platform.author.token), reviewer = client(env, platform.reviewer.token), admin = client(env, platform.admin.token);
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-GLOVE')!;
    const v = await author.post('/admin/rule-versions', { ...base, provisionIds: [], changeReason: 'Örnek: yeni sürüm denemesi' });
    expect(v.status).toBe(201);
    await author.post(`/admin/rule-versions/${v.body.id}/submit`);
    await reviewer.post(`/admin/rule-versions/${v.body.id}/approve`);
    const pub = await admin.post(`/admin/rule-versions/${v.body.id}/publish`);
    expect(pub.status).toBe(403);
    expect(pub.body.error.message).toContain('demo');
  });

  it('reports pilot mode and keeps the dev mail outbox closed', async () => {
    const anon = client(env, '');
    expect((await anon.get('/env')).body.mode).toBe('pilot');
    await anon.post('/auth/email/start', { email: 'pilot@ornek.com.tr' });
    expect((await anon.get('/dev/outbox/latest?email=pilot@ornek.com.tr')).status).toBe(404);
  });

  it('refuses demo reset', async () => {
    expect((await client(env, platform.admin.token).post('/admin/demo/reset')).status).toBe(403);
  });

  it('refuses a real legal requirement without a source provision', async () => {
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-LPG-CHECK')!;
    const r = await client(env, platform.author.token).post('/admin/rule-versions', { ...base, code: 'REAL-LPG', isExample: false, provisionIds: [] });
    expect(r.status).toBe(422);
  });
});

describe('behind a reverse proxy', () => {
  const burst = async (app: Env['app'], xff: string, n: number) => {
    let last = 0;
    for (let i = 0; i < n; i++) last = (await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': xff } })).statusCode;
    return last;
  };
  it('with the proxy trusted, clients are limited separately', async () => {
    const { buildApp } = await import('../../src/http/app');
    const { DevOutboxMailer } = await import('../../src/services/mail');
    const app = buildApp({ db: env.db, store: env.store, mailer: new DevOutboxMailer(env.db),
      config: { demoMode: false, allowExampleRules: false, maxUploadBytes: 1024, mfaEncryptionKey: null, mfaRequiredForPlatform: true, trustProxy: ['127.0.0.1'] } });
    try {
      expect(await burst(app, '203.0.113.10', 301)).toBe(429);
      expect(await burst(app, '203.0.113.11', 1)).toBe(200);
    } finally { await app.close(); }
  });
  it('without it, everyone behind the proxy shares one limit (why TRUST_PROXY must be set)', async () => {
    const { buildApp } = await import('../../src/http/app');
    const { DevOutboxMailer } = await import('../../src/services/mail');
    const app = buildApp({ db: env.db, store: env.store, mailer: new DevOutboxMailer(env.db),
      config: { demoMode: false, allowExampleRules: false, maxUploadBytes: 1024, mfaEncryptionKey: null, mfaRequiredForPlatform: true } });
    try {
      expect(await burst(app, '203.0.113.10', 301)).toBe(429);
      expect(await burst(app, '203.0.113.11', 1)).toBe(429);
    } finally { await app.close(); }
  });
});
