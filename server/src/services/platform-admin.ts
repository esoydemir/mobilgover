import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import type { Principal, PlatformRole } from '../domain/permissions';
import { appendAudit } from './audit';

/*
 * Platform administration on the existing platform-role structure.
 *  - Overview: counts only; names of role holders are shown to the platform administrator alone.
 *  - Audit: the platform chain and every company chain, read-only, with who / when / what / why.
 *  - Role changes: platform administrator only, a reason is mandatory, never on oneself, never the last administrator.
 */

export const PLATFORM_ROLES: PlatformRole[] = ['rule_author', 'rule_reviewer', 'platform_admin', 'marketplace_reviewer', 'network_moderator'];
export const ROLE_TR: Record<PlatformRole, string> = { rule_author: 'Kural yazarı', rule_reviewer: 'Kural inceleyici', platform_admin: 'Platform yöneticisi',
  marketplace_reviewer: 'Pazar yeri inceleyicisi', network_moderator: 'Ağ moderatörü' };

const isAdmin = (p: Principal) => p.platformRoles.includes('platform_admin');
const anyPlatform = (p: Principal) => p.platformRoles.length > 0;

export async function overview(tx: Tx, p: Principal) {
  if (!anyPlatform(p)) throw forbidden();
  const one = async (sql: string) => Number((await tx.query(sql)).rows[0]?.n ?? 0);
  const ruleRows = (await tx.query(`SELECT status, count(*)::int AS n FROM rule_versions GROUP BY status`)).rows;
  const holders = (await tx.query(`SELECT pr.role, count(*)::int AS n FROM platform_roles pr GROUP BY pr.role`)).rows;
  return {
    companies: { real: await one(`SELECT count(*) AS n FROM companies WHERE NOT is_demo`), demo: await one(`SELECT count(*) AS n FROM companies WHERE is_demo`) },
    users: await one(`SELECT count(*) AS n FROM users`),
    ruleVersions: Object.fromEntries(ruleRows.map(r => [r.status, r.n])),
    marketplaceQueue: {
      verifications: await one(`SELECT count(*) AS n FROM professional_verifications WHERE status = 'pending'`),
      authorizations: await one(`SELECT count(*) AS n FROM service_authorizations WHERE status = 'pending'`),
    },
    openNetworkReports: await one(`SELECT count(*) AS n FROM network_reports WHERE status = 'open'`),
    roleHolders: holders.map(h => ({ role: h.role as PlatformRole, label: ROLE_TR[h.role as PlatformRole] ?? h.role, count: h.n })),
    yourRoles: p.platformRoles,
    exampleRulesNote: 'Örnek kurallar doğrulanmış mevzuat değildir; yayınlama yalnız demo ortamında serbesttir.',
  };
}

export type AuditFilter = { companyId?: string | null; scope?: 'platform' | 'all'; eventType?: string; actorId?: string; entityId?: string; before?: number; limit?: number };

/** Who did what, when and why, across the platform chain and company chains. Read-only; platform administrator. */
export async function listAudit(tx: Tx, p: Principal, f: AuditFilter) {
  if (!isAdmin(p)) throw forbidden('Denetim kaydını yalnız platform yöneticisi okuyabilir.');
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const args: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (f.companyId) add('a.company_id = ?', f.companyId);
  else if (f.scope === 'platform') where.push('a.company_id IS NULL');
  if (f.eventType) add('a.event_type LIKE ?', `${f.eventType.replace(/[%_\\]/g, m => `\\${m}`)}%`);
  if (f.actorId) add('a.actor_id = ?', f.actorId);
  if (f.entityId) add('a.entity_id = ?', f.entityId);
  if (f.before) add('a.id < ?', f.before);
  args.push(limit + 1);
  const rows = (await tx.query(
    `SELECT a.id, a.company_id, c.name AS company_name, a.seq, a.occurred_at, a.actor_id, u.display_name AS actor_name, a.event_type, a.entity_type, a.entity_id, a.payload
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN companies c ON c.id = a.company_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT $${args.length}`, args)).rows;
  const page = rows.slice(0, limit).map(r => ({
    id: Number(r.id), companyId: r.company_id as string | null, companyName: r.company_name as string | null, scope: r.company_id ? 'company' : 'platform',
    occurredAt: r.occurred_at, actorId: r.actor_id as string | null, actorName: (r.actor_name as string | null) ?? 'sistem',
    eventType: r.event_type as string, entityType: r.entity_type as string, entityId: r.entity_id as string,
    // The reason is whatever the actor wrote; absent means it was not recorded, which the screen says plainly.
    reason: (r.payload?.reason ?? r.payload?.notes ?? r.payload?.checkMethod ?? null) as string | null, payload: r.payload,
  }));
  return { items: page, next: rows.length > limit ? page[page.length - 1]!.id : null };
}

export async function listPlatformUsers(tx: Tx, p: Principal, q?: string) {
  if (!isAdmin(p)) throw forbidden();
  const like = q && q.trim() ? `%${q.trim().replace(/[%_\\]/g, m => `\\${m}`)}%` : null;
  const rows = (await tx.query(
    `SELECT u.id, u.display_name, u.email, COALESCE(array_agg(pr.role ORDER BY pr.role) FILTER (WHERE pr.role IS NOT NULL), '{}') AS roles
       FROM users u LEFT JOIN platform_roles pr ON pr.user_id = u.id
      WHERE ($1::text IS NULL OR u.display_name ILIKE $1 OR u.email ILIKE $1)
      GROUP BY u.id ORDER BY (count(pr.role) > 0) DESC, u.display_name LIMIT 30`, [like])).rows;
  return rows.map(r => ({ id: r.id as string, displayName: r.display_name as string, email: r.email as string | null, roles: r.roles as PlatformRole[] }));
}

const reasonOk = (r: string) => {
  if (r.trim().length < 10) throw invalid('Gerekçeyi en az 10 karakterle yaz: kim, neden bu yetkiyi alıyor ya da kaybediyor.');
};

export async function setPlatformRole(tx: Tx, p: Principal, b: { userId: string; role: PlatformRole; grant: boolean; reason: string }) {
  if (!isAdmin(p)) throw forbidden('Platform rollerini yalnız platform yöneticisi değiştirebilir.');
  if (!PLATFORM_ROLES.includes(b.role)) throw invalid('Bilinmeyen platform rolü.');
  reasonOk(b.reason);
  if (b.userId === p.userId) throw forbidden('Kendi platform rollerini değiştiremezsin; başka bir platform yöneticisi yapmalı.');
  const u = (await tx.query(`SELECT id, display_name FROM users WHERE id = $1`, [b.userId])).rows[0];
  if (!u) throw notFound('Kullanıcı');
  const has = (await tx.query(`SELECT 1 FROM platform_roles WHERE user_id = $1 AND role = $2`, [b.userId, b.role])).rowCount! > 0;
  if (b.grant) {
    if (has) return { changed: false };
    await tx.query(`INSERT INTO platform_roles (user_id, role) VALUES ($1,$2)`, [b.userId, b.role]);
  } else {
    if (!has) return { changed: false };
    if (b.role === 'platform_admin') {
      const n = Number((await tx.query(`SELECT count(*) AS n FROM platform_roles WHERE role = 'platform_admin'`)).rows[0].n);
      if (n <= 1) throw conflict('LAST_PLATFORM_ADMIN', 'Son platform yöneticisinin rolü kaldırılamaz.');
    }
    await tx.query(`DELETE FROM platform_roles WHERE user_id = $1 AND role = $2`, [b.userId, b.role]);
  }
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: b.grant ? 'platform.role_granted' : 'platform.role_revoked', entityType: 'user', entityId: b.userId,
    payload: { role: b.role, userName: u.display_name, reason: b.reason.trim() } });
  return { changed: true };
}

export const REVIEW_AREAS = ['food_safety', 'occupational_safety', 'gas_safety', 'fire_safety', 'environment', 'consumer', 'good_practice'] as const;

/**
 * Review-AREA authority: a separate act from assigning a file and from granting a platform role.
 * Platform administrator only; the person must ALREADY hold the reviewer role (no silent role escalation); never on oneself; reason mandatory.
 * The audit record names who gave it, which area, the scope (the file it was needed for, if any), when and why.
 */
export async function setReviewerArea(tx: Tx, p: Principal, b: { userId: string; area: string; grant: boolean; reason: string; changeId?: string | null }) {
  if (!isAdmin(p)) throw forbidden('Alan yetkisini yalnız platform yöneticisi verir.');
  if (!(REVIEW_AREAS as readonly string[]).includes(b.area)) throw invalid('Bilinmeyen inceleme alanı.');
  reasonOk(b.reason);
  if (b.userId === p.userId) throw forbidden('Kendi alan yetkini değiştiremezsin; başka bir platform yöneticisi yapmalı.');
  const u = (await tx.query(`SELECT id, display_name FROM users WHERE id = $1`, [b.userId])).rows[0];
  if (!u) throw notFound('Kullanıcı');
  if (b.grant) {
    const reviewer = (await tx.query(`SELECT 1 FROM platform_roles WHERE user_id = $1 AND role = 'rule_reviewer'`, [b.userId])).rowCount! > 0;
    if (!reviewer) throw conflict('REVIEWER_ROLE_REQUIRED', 'Bu kişi kural inceleyici değil. Alan yetkisi rol vermez; önce rol ayrıca (gerekçeyle) verilmelidir.');
  }
  let scope: string | null = null;
  if (b.changeId) scope = ((await tx.query(`SELECT doc_ref || ' · ' || doc_title AS t FROM legislation_changes WHERE id = $1`, [b.changeId])).rows[0]?.t as string | undefined) ?? null;
  const exists = (await tx.query(`SELECT 1 FROM reviewer_areas WHERE user_id = $1 AND area = $2`, [b.userId, b.area])).rowCount! > 0;
  if (b.grant ? exists : !exists) return { changed: false };
  if (b.grant) await tx.query(`INSERT INTO reviewer_areas (user_id, area) VALUES ($1,$2)`, [b.userId, b.area]);
  else await tx.query(`DELETE FROM reviewer_areas WHERE user_id = $1 AND area = $2`, [b.userId, b.area]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: b.grant ? 'platform.area_granted' : 'platform.area_revoked', entityType: 'user', entityId: b.userId,
    payload: { area: b.area, userName: u.display_name, reason: b.reason.trim(), scope, changeId: b.changeId ?? null } });
  return { changed: true };
}
