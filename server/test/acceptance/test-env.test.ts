import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * The separate test environment (deploy/test): DEMO_MODE=true with DEMO_LOGIN_DOMAIN set.
 * Only demo addresses can sign in or be invited there, so no real person's address is entered.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const anon = () => client(env, '');

beforeAll(async () => {
  env = await freshEnv({ demoLoginDomain: 'demo.goverhub.test' });
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('test environment: demo addresses only', () => {
  it('reports the demo domain so the sign-in screen can say so', async () => {
    expect((await anon().get('/env')).body).toMatchObject({ mode: 'demo', demoLoginDomain: 'demo.goverhub.test' });
  });

  it('refuses a sign-in code for a real-looking address and stores nothing', async () => {
    const r = await anon().post('/auth/email/start', { email: 'kisi@gercek-isletme.com.tr' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('@demo.goverhub.test');
    const n = await env.ownerDb.query(`SELECT (SELECT count(*) FROM dev_mail_outbox)::int + (SELECT count(*) FROM login_challenges)::int AS n`);
    expect(n.rows[0].n).toBe(0);
  });

  it('a look-alike domain is refused too', async () => {
    expect((await anon().post('/auth/email/start', { email: 'a@xdemo.goverhub.test.com' })).status).toBe(422);
    expect((await anon().post('/auth/email/start', { email: 'a@evil-demo.goverhub.test' })).status).toBe(422);
  });

  it('signs in with a demo address through the demo outbox', async () => {
    expect((await anon().post('/auth/email/start', { email: 'Yeni@Demo.Goverhub.Test' })).status).toBe(200);
    const m = await anon().get('/dev/outbox/latest?email=yeni@demo.goverhub.test');
    const code = /(\d{6})/.exec(m.body.body)![1];
    const v = await anon().post('/auth/email/verify', { email: 'yeni@demo.goverhub.test', code });
    expect(v.status).toBe(200);
    expect(v.body.token).toBeTruthy();
  });

  it('invitations are limited to demo addresses as well', async () => {
    const owner = client(env, demo.users.owner.token);
    const bad = await owner.post(`/companies/${demo.companyId}/members`, { email: 'calisan@gercek.com.tr', role: 'staff', siteId: demo.siteId });
    expect(bad.status).toBe(422);
    const ok = await owner.post(`/companies/${demo.companyId}/members`, { email: 'calisan@demo.goverhub.test', role: 'staff', siteId: demo.siteId });
    expect(ok.status).toBe(201);
  });
});
