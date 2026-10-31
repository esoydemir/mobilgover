import type { Db, Tx } from '../db/pool';
import { forbidden, invalid } from '../domain/errors';
import { can, type CompanyRole, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
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
    .map(c => ({ ...c, roles: p.memberships.filter(m => m.companyId === c.id).map(m => ({ role: m.role, siteId: m.siteId })),
      grants: p.grants.filter(g => g.companyId === c.id).map(g => ({ kind: g.kind, scopes: g.scopes })) })));
}

/** Adds a person by e-mail. They sign in with that address; no password is ever set here. */
export async function addMember(tx: Tx, p: Principal, companyId: string, input: { email: string; role: CompanyRole; siteId: string | null }) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  if (input.role === 'owner') throw forbidden('Sahiplik devri bu akışta yapılamaz.');
  if ((input.role === 'staff' || input.role === 'site_manager') && !input.siteId) throw invalid('Personel ve şube yöneticisi bir şubeye bağlanmalı.');
  const email = input.email.trim().toLowerCase();
  // users/memberships are not tenant tables; the company is checked above and below.
  if (input.siteId) {
    const ok = (await tx.query(`SELECT 1 FROM sites WHERE id = $1 AND company_id = $2`, [input.siteId, companyId])).rowCount;
    if (!ok) throw invalid('Şube bu işletmeye ait değil.');
  }
  await tx.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [email.split('@')[0], email]);
  const userId = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
  await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role) VALUES ($1,$2,$3,$4)`, [userId, companyId, input.siteId, input.role]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'member.added', entityType: 'user', entityId: userId, payload: { role: input.role, siteId: input.siteId } });
  return { userId };
}
