import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../../src/domain/totp';
import { seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** Real HTTP + real PostgreSQL. The mail transport is the dev outbox (no mail leaves the server). */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
const anon = () => client(env, '');
const lastCode = async (email: string) => {
  const r = await env.ownerDb.query(`SELECT body FROM dev_mail_outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 1`, [email]);
  return /(\d{6})/.exec(r.rows[0].body)![1]!;
};

beforeAll(async () => {
  env = await freshEnv({ mfaRequiredForPlatform: true });
  platform = await seedPlatform(env.db);
});
afterAll(async () => { await env?.close(); });

describe('e-mail sign-in', () => {
  it('signs in with a one-time code and creates the account on first use', async () => {
    expect((await anon().post('/auth/email/start', { email: 'Ayse@Ornek.com.tr' })).status).toBe(200);
    const code = await lastCode('ayse@ornek.com.tr');
    const stored = (await env.ownerDb.query(`SELECT code_hash FROM login_challenges ORDER BY created_at DESC LIMIT 1`)).rows[0].code_hash;
    expect(stored).not.toContain(code);
    const r = await anon().post('/auth/email/verify', { email: 'ayse@ornek.com.tr', code });
    expect(r.body).toMatchObject({ mfaRequired: false });
    const me = await client(env, r.body.token).get('/me');
    expect(me.body.email).toBe('ayse@ornek.com.tr');
    // A code works once.
    expect((await anon().post('/auth/email/verify', { email: 'ayse@ornek.com.tr', code })).status).toBe(401);
  });

  it('locks a code after five wrong attempts and limits code requests', async () => {
    await anon().post('/auth/email/start', { email: 'deneme@ornek.com.tr' });
    const code = await lastCode('deneme@ornek.com.tr');
    for (let i = 0; i < 5; i++) expect((await anon().post('/auth/email/verify', { email: 'deneme@ornek.com.tr', code: '000000' === code ? '111111' : '000000' })).status).toBe(401);
    expect((await anon().post('/auth/email/verify', { email: 'deneme@ornek.com.tr', code })).status).toBe(429);
    for (let i = 0; i < 4; i++) await anon().post('/auth/email/start', { email: 'deneme@ornek.com.tr' });
    expect((await anon().post('/auth/email/start', { email: 'deneme@ornek.com.tr' })).status).toBe(429);
  });

  it('a new user creates a business, becomes its owner, and sees obligations awaiting answers', async () => {
    await anon().post('/auth/email/start', { email: 'sahip@kafe.com.tr' });
    const t = (await anon().post('/auth/email/verify', { email: 'sahip@kafe.com.tr', code: await lastCode('sahip@kafe.com.tr') })).body.token;
    const c = await client(env, t).post('/companies', { name: 'Moda Kafe', siteName: 'Moda' });
    expect(c.status).toBe(201);
    expect(c.body.isDemo).toBe(true); // this test environment runs in demo mode
    // Roles are loaded per request, so the new membership applies to the same token.
    const list = (await client(env, t).get('/companies')).body;
    expect(list[0]).toMatchObject({ name: 'Moda Kafe', roles: [{ role: 'owner', siteId: null }] });
    const obl = (await client(env, t).get(`/companies/${c.body.companyId}/obligations`)).body;
    expect(obl.length).toBeGreaterThan(0);
    expect(obl.every((o: any) => o.decision === 'needs_info')).toBe(true);
  });

  it('the environment endpoint tells the app whether it is demo or pilot', async () => {
    expect((await anon().get('/env')).body).toMatchObject({ mode: 'demo', mailTransport: 'dev_outbox', platformMfaRequired: true }); // same policy that platformGate enforces: the screen warns only when the server would refuse
  });
});

describe('second factor for administrators', () => {
  it('platform actions need a second factor; enrolling and signing in with it works', async () => {
    const admin = client(env, platform.admin.token);
    expect((await admin.get('/admin/retention-policies')).body.error.code).toBe('MFA_REQUIRED');
    const setup = (await admin.post('/auth/mfa/totp/setup')).body;
    expect(setup.otpauthUri).toContain('otpauth://totp/GoverHub');
    const enc = (await env.ownerDb.query(`SELECT secret_enc FROM mfa_totp`)).rows[0].secret_enc;
    expect(enc).not.toContain(setup.secret);
    expect((await admin.post('/auth/mfa/totp/confirm', { code: '000000' === totpAt(setup.secret, Date.now() / 1000) ? '111111' : '000000' })).status).toBe(401);
    expect((await admin.post('/auth/mfa/totp/confirm', { code: totpAt(setup.secret, Date.now() / 1000) })).status).toBe(200);
    expect((await admin.get('/admin/retention-policies')).status).toBe(200);

    // Next sign-in asks for the authenticator code after the e-mail code.
    const email = (await env.ownerDb.query(`UPDATE users SET email = 'admin@goverhub.test' WHERE id = $1 RETURNING email`, [platform.admin.id])).rows[0].email;
    await anon().post('/auth/email/start', { email });
    const step1 = (await anon().post('/auth/email/verify', { email, code: await lastCode(email) })).body;
    expect(step1).toMatchObject({ mfaRequired: true });
    expect(step1.token).toBeUndefined();
    const step2 = await anon().post('/auth/mfa/verify', { ticket: step1.ticket, code: totpAt(setup.secret, Date.now() / 1000) });
    expect(step2.status).toBe(200);
    expect((await client(env, step2.body.token).get('/me')).body.mfaSatisfied).toBe(true);
  });
});

describe('retention matrix', () => {
  it('starts empty, needs a legal basis and a second person, and never deletes anything', async () => {
    const admin = client(env, platform.admin.token);
    const list = (await admin.get('/admin/retention-policies')).body;
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.every((r: any) => r.status === 'unset' && r.period_months === null && r.automaticDeletion === false)).toBe(true);
    expect((await admin.post('/admin/retention-policies/measurements/propose', { periodMonths: 24, legalBasis: 'kısa' })).status).toBe(422);
    expect((await admin.post('/admin/retention-policies/measurements/propose', { periodMonths: 24, legalBasis: 'ÖRNEK gerekçe — hukuk görüşü bekleniyor' })).status).toBe(200);
    expect((await admin.post('/admin/retention-policies/measurements/approve')).status).toBe(403); // proposer cannot approve
  });
});
