import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Real HTTP + real PostgreSQL. Invitations, role ceilings, suspension, session
 * revocation and cross-company isolation of member management.
 */
let env: Env;
const anon = () => client(env, '');
const lastCode = async (email: string) => {
  const r = await env.ownerDb.query(`SELECT body FROM dev_mail_outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 1`, [email]);
  return /(\d{6})/.exec(r.rows[0].body)![1]!;
};
async function signIn(email: string) {
  await anon().post('/auth/email/start', { email });
  const r = await anon().post('/auth/email/verify', { email, code: await lastCode(email) });
  expect(r.status).toBe(200);
  return r.body.token as string;
}
const idem = () => ({ 'idempotency-key': `k-${Math.random().toString(36).slice(2)}-${Date.now()}` });

let owner: string, companyId: string, siteId: string;
let otherOwner: string, otherCompanyId: string;

beforeAll(async () => {
  env = await freshEnv();
  owner = await signIn('sahip@moda.com.tr');
  const c = (await client(env, owner).post('/companies', { name: 'Moda Kafe', siteName: 'Moda' })).body;
  companyId = c.companyId; siteId = c.siteId;
  otherOwner = await signIn('sahip@baska.com.tr');
  otherCompanyId = (await client(env, otherOwner).post('/companies', { name: 'Başka Lokanta', siteName: 'Merkez' })).body.companyId;
});
afterAll(async () => { await env?.close(); });

describe('invitations', () => {
  it('an invited person has no access until they sign in and accept', async () => {
    const inv = await client(env, owner).post(`/companies/${companyId}/members`, { email: 'mudur@moda.com.tr', role: 'site_manager', siteId });
    expect(inv.status).toBe(201);
    expect(inv.body.status).toBe('invited');

    const mgr = await signIn('mudur@moda.com.tr');
    expect((await client(env, mgr).get(`/companies/${companyId}/tasks`)).status).toBe(404);
    expect((await client(env, mgr).get('/companies')).body).toEqual([]);

    const list = (await client(env, mgr).get('/me/invitations')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ company_name: 'Moda Kafe', role: 'site_manager', invited_by_email: 'sahip@moda.com.tr' });

    // Someone else cannot accept it.
    expect((await client(env, otherOwner).post(`/me/invitations/${inv.body.membershipId}/accept`)).status).toBe(404);

    expect((await client(env, mgr).post(`/me/invitations/${list[0].id}/accept`)).body).toMatchObject({ status: 'active' });
    expect((await client(env, mgr).get(`/companies/${companyId}/tasks`)).status).toBe(200);
    const events = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE company_id = $1 AND event_type LIKE 'member.%' ORDER BY seq`, [companyId])).rows.map(r => r.event_type);
    expect(events).toEqual(['member.invited', 'member.invite_accepted']);
  });

  it('an expired invitation cannot be accepted', async () => {
    const inv = (await client(env, owner).post(`/companies/${companyId}/members`, { email: 'gec@moda.com.tr', role: 'staff', siteId })).body;
    await env.ownerDb.query(`UPDATE memberships SET invite_expires_at = now() - interval '1 minute' WHERE id = $1`, [inv.membershipId]);
    const t = await signIn('gec@moda.com.tr');
    expect((await client(env, t).get('/me/invitations')).body).toEqual([]);
    const r = await client(env, t).post(`/me/invitations/${inv.membershipId}/accept`);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('INVITE_EXPIRED');
    const members = (await client(env, owner).get(`/companies/${companyId}/members`)).body;
    expect(members.find((m: any) => m.email === 'gec@moda.com.tr')).toMatchObject({ status: 'invited', invite_expired: true });
  });
});

describe('role ceilings', () => {
  let hq: string;
  beforeAll(async () => {
    const inv = (await client(env, owner).post(`/companies/${companyId}/members`, { email: 'genel@moda.com.tr', role: 'hq_manager', siteId: null })).body;
    hq = await signIn('genel@moda.com.tr');
    await client(env, hq).post(`/me/invitations/${inv.membershipId}/accept`);
  });

  it('nobody can give the owner role, or a role equal to or above their own', async () => {
    expect((await client(env, owner).post(`/companies/${companyId}/members`, { email: 'x@moda.com.tr', role: 'owner', siteId: null })).status).toBe(422);
    expect((await client(env, hq).post(`/companies/${companyId}/members`, { email: 'y@moda.com.tr', role: 'hq_manager', siteId: null })).status).toBe(403);
    expect((await client(env, hq).post(`/companies/${companyId}/members`, { email: 'personel@moda.com.tr', role: 'staff', siteId })).status).toBe(201);
  });

  it('a site manager cannot manage people at all', async () => {
    const mgr = await signIn('mudur@moda.com.tr');
    expect((await client(env, mgr).post(`/companies/${companyId}/members`, { email: 'z@moda.com.tr', role: 'staff', siteId })).status).toBe(403);
    expect((await client(env, mgr).get(`/companies/${companyId}/members`)).status).toBe(403);
  });

  it('a manager cannot suspend an equal or higher role, nor themselves', async () => {
    const members = (await client(env, owner).get(`/companies/${companyId}/members`)).body;
    const ownerM = members.find((m: any) => m.role === 'owner');
    const hqM = members.find((m: any) => m.role === 'hq_manager');
    expect((await client(env, hq).post(`/companies/${companyId}/members/${ownerM.membership_id}/suspend`, { reason: 'deneme amaçlı' }, idem())).status).toBe(403);
    expect((await client(env, hq).post(`/companies/${companyId}/members/${hqM.membership_id}/suspend`, { reason: 'deneme amaçlı' }, idem())).status).toBe(403);
    expect((await client(env, owner).post(`/companies/${companyId}/members/${ownerM.membership_id}/suspend`, { reason: 'deneme amaçlı' }, idem())).status).toBe(403);
  });
});

describe('suspension', () => {
  it('ends access on the next request, rejects queued writes, and can be undone', async () => {
    const mgr = await signIn('mudur@moda.com.tr');
    const members = (await client(env, owner).get(`/companies/${companyId}/members`)).body;
    const m = members.find((x: any) => x.email === 'mudur@moda.com.tr');
    expect((await client(env, owner).post(`/companies/${companyId}/members/${m.membership_id}/suspend`, { reason: 'x' }, idem())).status).toBe(422);
    expect((await client(env, owner).post(`/companies/${companyId}/members/${m.membership_id}/suspend`, { reason: 'İşten ayrıldı' }, idem())).status).toBe(200);

    // Same token, no re-login: the company no longer exists for this user.
    expect((await client(env, mgr).get(`/companies/${companyId}/tasks`)).status).toBe(404);
    // A write queued on the phone before the suspension is refused when it finally arrives.
    const queued = await client(env, mgr).post(`/companies/${companyId}/nonconformities`, { siteId, title: 'Kuyruktaki kayıt', severity: 'low' }, idem());
    expect(queued.status).toBe(404);
    expect((await client(env, owner).get(`/companies/${companyId}/members`)).body.find((x: any) => x.email === 'mudur@moda.com.tr'))
      .toMatchObject({ status: 'suspended', suspend_reason: 'İşten ayrıldı' });

    expect((await client(env, owner).post(`/companies/${companyId}/members/${m.membership_id}/reactivate`, {}, idem())).status).toBe(200);
    expect((await client(env, mgr).get(`/companies/${companyId}/tasks`)).status).toBe(200);

    const events = (await env.ownerDb.query(`SELECT event_type, payload FROM audit_events WHERE company_id = $1 AND event_type IN ('member.suspend','member.reactivate') ORDER BY seq`, [companyId])).rows;
    expect(events.map(e => e.event_type)).toEqual(['member.suspend', 'member.reactivate']);
    expect(events[0].payload.reason).toBe('İşten ayrıldı');
  });

  it('a pending invitation can be cancelled', async () => {
    const inv = (await client(env, owner).post(`/companies/${companyId}/members`, { email: 'iptal@moda.com.tr', role: 'staff', siteId })).body;
    expect((await client(env, owner).post(`/companies/${companyId}/members/${inv.membershipId}/cancel_invite`, {}, idem())).status).toBe(200);
    const t = await signIn('iptal@moda.com.tr');
    expect((await client(env, t).post(`/me/invitations/${inv.membershipId}/accept`)).status).toBe(404);
  });
});

describe('cross-company isolation of member management', () => {
  it('another business cannot see, invite into, or suspend members of this one', async () => {
    const members = (await client(env, owner).get(`/companies/${companyId}/members`)).body;
    const staff = members.find((m: any) => m.role === 'staff' && m.status === 'invited');
    const o = client(env, otherOwner);
    expect((await o.get(`/companies/${companyId}/members`)).status).toBe(404);
    expect((await o.post(`/companies/${companyId}/members`, { email: 'sizinti@x.com', role: 'staff', siteId })).status).toBe(404);
    // Using its own company in the path with a foreign membership id does not reach it either.
    expect((await o.post(`/companies/${otherCompanyId}/members/${staff.membership_id}/cancel_invite`, {}, idem())).status).toBe(404);
    // A site of another company cannot be used when inviting.
    expect((await o.post(`/companies/${otherCompanyId}/members`, { email: 'yanlis@x.com', role: 'staff', siteId })).status).toBe(422);
  });
});

describe('sessions', () => {
  it('lists own sessions, revokes another device, and logout keeps a record', async () => {
    const phone = await signIn('cihaz@moda.com.tr');
    const tablet = await signIn('cihaz@moda.com.tr');
    const list = (await client(env, phone).get('/auth/sessions')).body;
    expect(list).toHaveLength(2);
    expect(list.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(phone);

    // Another user's session id is simply not found.
    const tabletId = list.find((s: any) => !s.current).id;
    expect((await client(env, otherOwner).post(`/auth/sessions/${tabletId}/revoke`)).status).toBe(404);
    expect((await client(env, tablet).get('/me')).status).toBe(200);

    expect((await client(env, phone).post('/auth/sessions/revoke-others')).body).toEqual({ revoked: 1 });
    expect((await client(env, tablet).get('/me')).status).toBe(401);
    expect((await client(env, phone).get('/me')).status).toBe(200);

    await client(env, phone).post('/auth/logout');
    expect((await client(env, phone).get('/me')).status).toBe(401);
    const rows = (await env.ownerDb.query(
      `SELECT revoke_reason FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'cihaz@moda.com.tr' ORDER BY s.created_at`)).rows;
    expect(rows.map(r => r.revoke_reason)).toEqual(['logout', 'other_sessions_revoked']);
  });
});
