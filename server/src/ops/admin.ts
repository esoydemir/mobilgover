import { userInfo } from 'node:os';
import pg from 'pg';
import '../db/pool';
import { appendAudit } from '../services/audit';

/*
 * Platform role administration from the server's shell — the only way to give
 * the first rule author, reviewer, domain specialist and platform admin their
 * roles in a pilot (demo data never runs there). Every change is written to
 * the platform audit chain with the OS user and a reason.
 *   npm run admin:list
 *   npm run admin:grant  -- <e-posta> <rol | alan:<alan>> "<gerekçe>"
 *   npm run admin:revoke -- <e-posta> <rol | alan:<alan>> "<gerekçe>"
 * Roles: rule_author, rule_reviewer, platform_admin, marketplace_reviewer.
 * Areas: food_safety, occupational_safety, gas_safety, fire_safety, environment, consumer, good_practice.
 */
export const ROLES = ['rule_author', 'rule_reviewer', 'platform_admin', 'marketplace_reviewer'] as const;
export const AREAS = ['food_safety', 'occupational_safety', 'gas_safety', 'fire_safety', 'environment', 'consumer', 'good_practice'] as const;

type Q = pg.Client;

export async function listAdmins(c: Q) {
  return (await c.query(
    `SELECT u.email, array_remove(array_agg(DISTINCT p.role), NULL) AS roles, array_remove(array_agg(DISTINCT a.area), NULL) AS areas,
            (m.confirmed_at IS NOT NULL) AS mfa
       FROM users u LEFT JOIN platform_roles p ON p.user_id = u.id LEFT JOIN reviewer_areas a ON a.user_id = u.id LEFT JOIN mfa_totp m ON m.user_id = u.id
      WHERE p.user_id IS NOT NULL OR a.user_id IS NOT NULL
      GROUP BY u.email, m.confirmed_at ORDER BY u.email`)).rows;
}

export async function changeRole(c: Q, action: 'grant' | 'revoke', rawEmail: string, what: string, reason: string, operator = userInfo().username) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Geçerli bir e-posta adresi ver.');
  if (reason.trim().length < 5) throw new Error('Gerekçe yaz (en az 5 karakter).');
  const area = what.startsWith('alan:') ? what.slice(5) : null;
  if (area ? !(AREAS as readonly string[]).includes(area) : !(ROLES as readonly string[]).includes(what)) throw new Error(`Bilinmeyen rol/alan: ${what}`);
  await c.query('BEGIN');
  try {
    // The person signs in with this address later; the account exists from now on, without a password.
    await c.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [email.split('@')[0], email]);
    const userId = (await c.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string;
    const table = area ? 'reviewer_areas' : 'platform_roles';
    const col = area ? 'area' : 'role';
    const value = area ?? what;
    const r = action === 'grant'
      ? await c.query(`INSERT INTO ${table} (user_id, ${col}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, value])
      : await c.query(`DELETE FROM ${table} WHERE user_id = $1 AND ${col} = $2`, [userId, value]);
    if (r.rowCount) {
      await appendAudit(c as unknown as pg.PoolClient, { companyId: null, actorId: null, eventType: `platform.${area ? 'area' : 'role'}_${action === 'grant' ? 'granted' : 'revoked'}`,
        entityType: 'user', entityId: userId, payload: { [col]: value, reason: reason.trim(), operator } });
    }
    await c.query('COMMIT');
    return { changed: (r.rowCount ?? 0) > 0, userId };
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}

if (process.argv[1]?.endsWith('admin.ts')) {
  const [cmd, email, what, reason] = process.argv.slice(2);
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL tanımlı değil');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    if (cmd === 'list') {
      for (const a of await listAdmins(c)) console.log(`${a.email} · roller: ${a.roles.join(', ') || '—'} · alanlar: ${a.areas.join(', ') || '—'} · ek doğrulama: ${a.mfa ? 'kurulu' : 'KURULMADI'}`);
    } else if (cmd === 'grant' || cmd === 'revoke') {
      const r = await changeRole(c, cmd, email ?? '', what ?? '', reason ?? '');
      console.log(r.changed ? 'değişti; platform denetim zincirine yazıldı' : 'zaten bu durumda; değişiklik yok');
    } else {
      console.error('Kullanım: list | grant <e-posta> <rol|alan:x> "<gerekçe>" | revoke <e-posta> <rol|alan:x> "<gerekçe>"');
      process.exitCode = 2;
    }
  } finally { await c.end(); }
}
