import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDemoDatabase } from '../../src/db/guards';
import { EXAMPLE_RULES, seedDemoCompany, seedPlatform } from '../../src/seed/demo';
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
    await reviewer.post(`/admin/rule-versions/${v.body.id}/approve`, { reason: 'Test: onay gerekçesi' });
    const pub = await admin.post(`/admin/rule-versions/${v.body.id}/publish`, { reason: 'Test: yayın gerekçesi' });
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

  it('demo mode refuses to start on a database holding a real (non-demo) company', async () => {
    await seedDemoCompany(env.db);
    await expect(assertDemoDatabase(env.db)).resolves.toBeUndefined();
    await env.db.system(tx => tx.query(`INSERT INTO companies (name, is_demo) VALUES ('Gerçek İşletme', false)`));
    await expect(assertDemoDatabase(env.db)).rejects.toThrow(/gerçek \(demo olmayan\) işletme/);
  });
});

describe('reverse proxy, direct access and rate limits', () => {
  const mk = async (trustProxy?: string[]) => {
    const { buildApp } = await import('../../src/http/app');
    const { DevOutboxMailer } = await import('../../src/services/mail');
    return buildApp({ db: env.db, store: env.store, mailer: new DevOutboxMailer(env.db),
      config: { demoMode: false, allowExampleRules: false, maxUploadBytes: 1024, mfaEncryptionKey: null, mfaRequiredForPlatform: true, trustProxy } });
  };
  /** n anonymous requests; `from` is the TCP peer, `xff` what arrives in X-Forwarded-For. */
  const burst = async (app: Pick<Env['app'], 'inject'>, n: number, from: string, xff: (i: number) => string | undefined, url = '/health') => {
    let last = 0;
    for (let i = 0; i < n; i++) {
      const h = xff(i);
      last = (await app.inject({ method: 'GET', url, remoteAddress: from, headers: h ? { 'x-forwarded-for': h } : {} })).statusCode;
    }
    return last;
  };

  it('through the trusted proxy, a client cannot escape its limit by sending fake X-Forwarded-For values', async () => {
    const app = await mk(['127.0.0.1']);
    try {
      // Caddy appends the real peer address after whatever the client sent; the API takes the rightmost untrusted one.
      expect(await burst(app, 301, '127.0.0.1', i => `10.${i % 250}.0.1, 203.0.113.10`)).toBe(429);
      // A different real client behind the same proxy is unaffected.
      expect(await burst(app, 1, '127.0.0.1', () => '198.51.100.20')).toBe(200);
    } finally { await app.close(); }
  });

  it('a direct connection that is not the trusted proxy is limited by its own address; its X-Forwarded-For is ignored', async () => {
    const app = await mk(['127.0.0.1']);
    try {
      expect(await burst(app, 301, '198.51.100.7', i => `203.0.113.${i % 250}`)).toBe(429);
      // The address it pretended to be is not affected.
      expect(await burst(app, 1, '127.0.0.1', () => '203.0.113.5')).toBe(200);
    } finally { await app.close(); }
  });

  it('TRUST_PROXY accepts only explicit addresses', async () => {
    const { parseTrustProxy, listenHost } = await import('../../src/config');
    expect(parseTrustProxy('127.0.0.1, ::1, 10.0.0.0/8')).toEqual(['127.0.0.1', '::1', '10.0.0.0/8']);
    for (const bad of ['true', '*', 'all', 'loopback', '0.0.0.0/0', 'caddy.local']) expect(() => parseTrustProxy(bad)).toThrow();
    // A pilot API listens on loopback only.
    expect(listenHost(undefined, false)).toBe('127.0.0.1');
    expect(() => listenHost('0.0.0.0', false)).toThrow('yalnızca yerel');
    expect(listenHost('0.0.0.0', true)).toBe('0.0.0.0'); // demo/dev only
    const { mailTransportFor } = await import('../../src/config');
    expect(() => mailTransportFor('dev_outbox', false)).toThrow('MAIL_TRANSPORT=smtp');
    expect(() => mailTransportFor(undefined, false)).not.toThrow();
    expect(mailTransportFor(undefined, false)).toBe('smtp');
    expect(mailTransportFor(undefined, true)).toBe('dev_outbox');
    expect(() => mailTransportFor('smtp', true)).toThrow('gerçek e-posta göndermez');
    const { demoLoginDomain } = await import('../../src/config');
    expect(() => demoLoginDomain('demo.goverhub.test', false)).toThrow('yalnızca DEMO_MODE=true');
    expect(demoLoginDomain(' Demo.GoverHub.Test ', true)).toBe('demo.goverhub.test');
    expect(demoLoginDomain(undefined, false)).toBeUndefined();
    expect(() => demoLoginDomain('*', true)).toThrow('geçersiz');
  });

  it('listening on loopback, the API cannot be reached from another interface', async () => {
    const { networkInterfaces } = await import('node:os');
    const { connect } = await import('node:net');
    const external = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
    expect(external, 'bu makinede yerel olmayan bir IPv4 adresi bulunamadı').toBeTruthy();
    const app = await mk(['127.0.0.1']);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    try {
      const tryConnect = (host: string) => new Promise<string>(res => { const s = connect({ host, port }); s.once('connect', () => { s.destroy(); res('open'); }); s.once('error', (e: any) => res(e.code)); });
      expect(await tryConnect('127.0.0.1')).toBe('open');
      expect(await tryConnect(external!)).toBe('ECONNREFUSED');
    } finally { await app.close(); }
  });

  it('people on the same business network: accounts are limited separately; the shared address only limits anonymous traffic', async () => {
    const app = await mk(['127.0.0.1']);
    const office = '203.0.113.50';
    const as = (token: string) => ({ authorization: `Bearer ${token}`, 'x-forwarded-for': office });
    try {
      // Two signed-in colleagues behind one office address.
      let last = 0;
      for (let i = 0; i < 301; i++) last = (await app.inject({ method: 'GET', url: '/me', remoteAddress: '127.0.0.1', headers: as(platform.author.token) })).statusCode;
      expect(last).toBe(429);
      expect((await app.inject({ method: 'GET', url: '/me', remoteAddress: '127.0.0.1', headers: as(platform.reviewer.token) })).statusCode).toBe(200);
      // Anonymous requests from the office still have their own (shared) budget.
      expect(await burst(app, 1, '127.0.0.1', () => office)).toBe(200);
    } finally { await app.close(); }
  });

  it('sign-in code limits follow the e-mail address, not the network address', async () => {
    const app = await mk(['127.0.0.1']);
    const office = '203.0.113.60';
    const start = (email: string) => app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': office }, payload: { email } });
    try {
      for (let i = 0; i < 5; i++) expect((await start('bir@kafe.com.tr')).statusCode).toBe(200);
      expect((await start('bir@kafe.com.tr')).statusCode).toBe(429);
      // A colleague on the same network can still get a code.
      expect((await start('iki@kafe.com.tr')).statusCode).toBe(200);
      // And the same address from a different network is still limited.
      expect((await app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.99' }, payload: { email: 'bir@kafe.com.tr' } })).statusCode).toBe(429);
    } finally { await app.close(); }
  });
});
