import { createHash, randomBytes } from 'node:crypto';
import type { Db, Tx } from '../db/pool';
import type { Principal } from '../domain/permissions';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Issues a bearer token; only its hash is stored. */
export async function createSession(tx: Tx, userId: string, ttlHours = 12): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), userId, ttlHours]);
  return token;
}

/** Resolves a bearer token to the user's roles, memberships and live grants. */
export async function loadPrincipal(db: Db, token: string): Promise<Principal | null> {
  return db.system(async tx => {
    const s = await tx.query(
      `SELECT s.user_id, s.mfa_satisfied, u.email, u.display_name, (m.confirmed_at IS NOT NULL) AS mfa_enabled
         FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN mfa_totp m ON m.user_id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]);
    const row = s.rows[0];
    if (!row) return null;
    const userId: string = row.user_id;
    // One connection runs one query at a time; keep these sequential.
    const roles = await tx.query(`SELECT role FROM platform_roles WHERE user_id = $1`, [userId]);
    const members = await tx.query(`SELECT company_id, site_id, role FROM memberships WHERE user_id = $1`, [userId]);
    const grants = await tx.query(`SELECT company_id, kind, scopes FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`, [userId]);
    return {
      userId, email: row.email, displayName: row.display_name, mfaSatisfied: row.mfa_satisfied, mfaEnabled: !!row.mfa_enabled,
      platformRoles: roles.rows.map(r => r.role),
      memberships: members.rows.map(m => ({ companyId: m.company_id, siteId: m.site_id, role: m.role })),
      grants: grants.rows.map(g => ({ companyId: g.company_id, kind: g.kind, scopes: g.scopes })),
    };
  });
}
