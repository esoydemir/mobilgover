import type { Db, Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type CompanyRole, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify, siteManagers } from './notifications';
import { recomputeSite } from './obligations';

/**
 * A signed-in user creates a business and becomes its owner. Whether it is
 * demo data is decided by the deployment, never by the request.
 */
export async function createCompany(db: Db, p: Principal, input: { name: string; siteName: string; timezone: string }, isDemo: boolean) {
  if (!Intl.supportedValuesOf('timeZone').includes(input.timezone)) throw invalid('Geçersiz saat dilimi.');
  return db.system(async tx => {
    const companyId = (await tx.query<{ id: string }>(`INSERT INTO companies (name, is_demo) VALUES ($1, $2) RETURNING id`, [input.name, isDemo])).rows[0]!.id;
    const siteId = (await tx.query<{ id: string }>(`INSERT INTO sites (company_id, name, timezone) VALUES ($1,$2,$3) RETURNING id`, [companyId, input.siteName, input.timezone])).rows[0]!.id;
    await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role) VALUES ($1,$2,NULL,'owner')`, [p.userId, companyId]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'company.created', entityType: 'company', entityId: companyId, payload: { name: input.name, isDemo, siteId } });
    // Every published rule starts as "needs information" until the profile is answered.
    await recomputeSite(tx, companyId, siteId, p.userId);
    return { companyId, siteId, isDemo };
  });
}

export async function listMyCompanies(db: Db, p: Principal) {
  const ids = [...new Set([...p.memberships.map(m => m.companyId), ...p.grants.map(g => g.companyId)])];
  if (!ids.length) return [];
  return db.system(async tx => (await tx.query(
    `SELECT c.id, c.name, c.is_demo, json_agg(json_build_object('id', s.id, 'name', s.name, 'timezone', s.timezone) ORDER BY s.created_at) AS sites
       FROM companies c JOIN sites s ON s.company_id = c.id WHERE c.id = ANY($1) GROUP BY c.id ORDER BY c.created_at`, [ids])).rows
    .map(c => {
      // B-07: someone with only an outside grant (no membership) does not get the branch list. A grant limited to selected cases shows none;
      // a site-limited grant shows that site only.
      const member = p.memberships.some(m => m.companyId === c.id);
      const gs = p.grants.filter(g => g.companyId === c.id);
      const sites = member ? c.sites : (c.sites as { id: string }[]).filter(s => gs.some(g => !g.ncrIds && (!g.siteId || g.siteId === s.id)));
      return { ...c, sites };
    })
    .map(c => ({ ...c, roles: p.memberships.filter(m => m.companyId === c.id).map(m => ({ role: m.role, siteId: m.siteId })),
      grants: p.grants.filter(g => g.companyId === c.id).map(g => ({ kind: g.kind, scopes: g.scopes })) })));
}

const RANK: Record<CompanyRole, number> = { owner: 4, hq_manager: 3, site_manager: 2, staff: 1 };
const INVITE_DAYS = 7;

/** Highest company-wide rank the actor holds here; site-scoped roles do not manage people. */
function managerRank(p: Principal, companyId: string): number {
  const ranks = p.memberships.filter(m => m.companyId === companyId && !m.siteId).map(m => RANK[m.role]);
  return ranks.length ? Math.max(...ranks) : 0;
}

/**
 * Invites a person by e-mail. The membership stays "invited" (no access) until
 * that person signs in with this address and accepts it within 7 days.
 * An actor can only give a role below their own.
 */
export async function addMember(tx: Tx, p: Principal, companyId: string, input: { email: string; role: CompanyRole; siteId: string | null }) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  if (input.role === 'owner') throw forbidden('Sahiplik devri bu akışta yapılamaz.');
  if (RANK[input.role] >= managerRank(p, companyId)) throw forbidden('Kendi rolünle aynı ya da daha yüksek bir rol veremezsin.');
  if ((input.role === 'staff' || input.role === 'site_manager') && !input.siteId) throw invalid('Personel ve şube yöneticisi bir şubeye bağlanmalı.');
  const email = input.email.trim().toLowerCase();
  // users/memberships are not tenant tables; the company is checked above and below.
  if (input.siteId) {
    const ok = (await tx.query(`SELECT 1 FROM sites WHERE id = $1 AND company_id = $2`, [input.siteId, companyId])).rowCount;
    if (!ok) throw invalid('Şube bu işletmeye ait değil.');
  }
  await tx.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [email.split('@')[0], email]);
  const userId = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
  if (userId === p.userId) throw invalid('Kendini davet edemezsin.');
  const m = await tx.query<{ id: string; invite_expires_at: string }>(
    `INSERT INTO memberships (user_id, company_id, site_id, role, status, invited_by, invite_expires_at, activated_at)
     VALUES ($1,$2,$3,$4,'invited',$5, now() + make_interval(days => $6), NULL) RETURNING id, invite_expires_at`,
    [userId, companyId, input.siteId, input.role, p.userId, INVITE_DAYS]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'member.invited', entityType: 'membership', entityId: m.rows[0]!.id, payload: { userId, role: input.role, siteId: input.siteId } });
  return { userId, membershipId: m.rows[0]!.id, status: 'invited', inviteExpiresAt: m.rows[0]!.invite_expires_at };
}

/** Open invitations for the signed-in user (matched by their verified e-mail account). */
export async function listMyInvitations(db: Db, p: Principal) {
  return db.system(async tx => (await tx.query(
    `SELECT m.id, m.role, m.site_id, m.invite_expires_at, c.name AS company_name, s.name AS site_name, u.email AS invited_by_email
       FROM memberships m JOIN companies c ON c.id = m.company_id LEFT JOIN sites s ON s.id = m.site_id LEFT JOIN users u ON u.id = m.invited_by
      WHERE m.user_id = $1 AND m.status = 'invited' AND m.invite_expires_at > now() ORDER BY m.created_at`, [p.userId])).rows);
}

/** The invited person accepts. Only they can; an expired invitation must be sent again. */
export async function acceptInvitation(db: Db, p: Principal, membershipId: string) {
  return db.system(async tx => {
    const r = await tx.query<{ company_id: string; status: string; expired: boolean }>(
      `SELECT company_id, status, invite_expires_at <= now() AS expired FROM memberships WHERE id = $1 AND user_id = $2 FOR UPDATE`, [membershipId, p.userId]);
    const m = r.rows[0];
    if (!m || m.status !== 'invited') throw notFound('Davet');
    if (m.expired) throw new AppError(410, 'INVITE_EXPIRED', 'Davetin süresi dolmuş; işletmeden yeniden davet iste.');
    await tx.query(`UPDATE memberships SET status = 'active', activated_at = now() WHERE id = $1`, [membershipId]);
    await appendAudit(tx, { companyId: m.company_id, actorId: p.userId, eventType: 'member.invite_accepted', entityType: 'membership', entityId: membershipId, payload: {} });
    return { companyId: m.company_id, status: 'active' };
  });
}

/**
 * Suspends or reactivates a member. Nobody can act on themselves, on an owner,
 * or on someone of equal or higher rank. Access ends on the member's next request.
 */
export async function setMemberStatus(tx: Tx, p: Principal, companyId: string, membershipId: string, action: 'suspend' | 'reactivate' | 'cancel_invite', reason: string) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  const r = await tx.query<{ user_id: string; role: CompanyRole; status: string }>(
    `SELECT user_id, role, status FROM memberships WHERE id = $1 AND company_id = $2 FOR UPDATE`, [membershipId, companyId]);
  const m = r.rows[0];
  if (!m) throw notFound('Üyelik');
  if (m.user_id === p.userId) throw forbidden('Kendi üyeliğini değiştiremezsin.');
  if (RANK[m.role] >= managerRank(p, companyId)) throw forbidden('Kendi rolünle aynı ya da daha yüksek roldeki birini değiştiremezsin.');
  if (action === 'suspend') {
    if (m.status !== 'active') throw conflict('MEMBER_STATE', 'Yalnızca etkin üyelik pasifleştirilebilir.');
    if (reason.trim().length < 5) throw invalid('Gerekçe yaz.');
    await tx.query(`UPDATE memberships SET status = 'suspended', suspended_at = now(), suspended_by = $2, suspend_reason = $3 WHERE id = $1`, [membershipId, p.userId, reason.trim()]);
    // Their open work goes to the managers' reassignment list (it is computed from active memberships);
    // managers are told once per suspension.
    const open = (await tx.query<{ site_id: string; n: number }>(
      `SELECT site_id, count(*)::int AS n FROM (
         SELECT site_id FROM nonconformities WHERE company_id = $1 AND owner_id = $2 AND status <> 'closed'
         UNION ALL SELECT n.site_id FROM ncr_actions a JOIN nonconformities n ON n.id = a.ncr_id WHERE a.company_id = $1 AND a.owner_id = $2 AND a.status = 'open' AND n.status <> 'closed'
         UNION ALL SELECT site_id FROM tasks WHERE company_id = $1 AND assignee_id = $2 AND status = 'open' AND due_at >= now()) w GROUP BY site_id`,
      [companyId, m.user_id])).rows;
    const who = (await tx.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [m.user_id])).rows[0]?.display_name ?? 'Pasifleştirilen kişi';
    for (const o of open) {
      await notify(tx, { companyId, siteId: o.site_id, userIds: await siteManagers(tx, companyId, o.site_id), except: p.userId,
        kind: 'reassignment_needed', entityType: 'membership', entityId: membershipId, dedupeKey: `reassign:${membershipId}:${o.site_id}:${new Date().toISOString().slice(0, 16)}`,
        title: 'Yeniden atama bekleyen işler', body: `${who} pasifleştirildi; ${o.n} açık işi yeni sorumlu bekliyor.` });
    }
  } else if (action === 'reactivate') {
    if (m.status !== 'suspended') throw conflict('MEMBER_STATE', 'Üyelik pasif değil.');
    await tx.query(`UPDATE memberships SET status = 'active', activated_at = now(), suspended_at = NULL, suspended_by = NULL, suspend_reason = NULL WHERE id = $1`, [membershipId]);
  } else {
    if (m.status !== 'invited') throw conflict('MEMBER_STATE', 'Bekleyen bir davet yok.');
    await tx.query(`DELETE FROM memberships WHERE id = $1`, [membershipId]);
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: `member.${action}`, entityType: 'membership', entityId: membershipId, payload: { userId: m.user_id, role: m.role, reason: reason.trim() || null } });
  return { membershipId, status: action === 'suspend' ? 'suspended' : action === 'reactivate' ? 'active' : 'cancelled' };
}
