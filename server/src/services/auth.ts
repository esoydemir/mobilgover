import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/pool';
import { AppError, invalid } from '../domain/errors';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../domain/totp';
import type { Mailer } from './mail';
import { appendAudit } from './audit';
import { hashToken } from './principal';

const CODE_TTL_MIN = 10;
const MAX_CODES_PER_15_MIN = 5;
const MAX_ATTEMPTS = 5;
const SESSION_HOURS = 12;

const normEmail = (e: string) => e.trim().toLowerCase();
const codeHash = (challengeId: string, code: string) => createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
const tooMany = () => new AppError(429, 'RATE_LIMITED', 'Çok fazla deneme. Birkaç dakika sonra yeni kod iste.');

/**
 * Step 1: e-mail a one-time code. The answer is the same whether or not the
 * address has an account, so addresses cannot be enumerated.
 */
export async function startEmailLogin(db: Db, mailer: Mailer, rawEmail: string) {
  const email = normEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw invalid('Geçerli bir e-posta adresi gir.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.system(async tx => {
    const recent = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM login_challenges WHERE email = $1 AND created_at > now() - interval '15 minutes'`, [email])).rows[0]!.n;
    if (recent >= MAX_CODES_PER_15_MIN) throw tooMany();
    const id = (await tx.query<{ id: string }>(`INSERT INTO login_challenges (email, code_hash, expires_at) VALUES ($1, '', now() + make_interval(mins => $2)) RETURNING id`, [email, CODE_TTL_MIN])).rows[0]!.id;
    await tx.query(`UPDATE login_challenges SET code_hash = $2 WHERE id = $1`, [id, codeHash(id, code)]);
  });
  await mailer.send(email, 'GoverHub giriş kodun', `Giriş kodun: ${code}\nKod ${CODE_TTL_MIN} dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok say.`);
  return { sent: true, expiresInMinutes: CODE_TTL_MIN };
}

async function issueSession(db: Db, userId: string, mfaSatisfied: boolean) {
  const token = randomBytes(32).toString('base64url');
  await db.system(tx => tx.query(`INSERT INTO sessions (token_hash, user_id, expires_at, mfa_satisfied) VALUES ($1,$2, now() + make_interval(hours => $3), $4)`,
    [hashToken(token), userId, SESSION_HOURS, mfaSatisfied]));
  return token;
}

export type LoginResult = { token: string; mfaRequired: false; userId: string } | { mfaRequired: true; ticket: string };

/** Step 2: check the code. Accounts are created on first verified sign-in. */
export async function verifyEmailLogin(db: Db, rawEmail: string, code: string): Promise<LoginResult> {
  const email = normEmail(rawEmail);
  const userId = await db.system(async tx => {
    const c = (await tx.query(`SELECT * FROM login_challenges WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [email])).rows[0];
    if (!c) throw new AppError(401, 'CODE_INVALID', 'Kod geçersiz veya süresi dolmuş. Yeni kod iste.');
    if (c.attempts >= MAX_ATTEMPTS) throw tooMany();
    await tx.query(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = $1`, [c.id]);
    const ok = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(codeHash(c.id, code)), Buffer.from(c.code_hash));
    if (!ok) return null;
    await tx.query(`UPDATE login_challenges SET consumed_at = now() WHERE id = $1`, [c.id]);
    const existing = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0];
    if (existing) {
      await tx.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [existing.id]);
      return existing.id;
    }
    return (await tx.query<{ id: string }>(`INSERT INTO users (display_name, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id`, [email.split('@')[0], email])).rows[0]!.id;
  });
  // A wrong code is committed as an attempt before we answer.
  if (!userId) throw new AppError(401, 'CODE_INVALID', 'Kod hatalı.');

  const hasTotp = await db.system(async tx => (await tx.query(`SELECT 1 FROM mfa_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL`, [userId])).rowCount);
  if (hasTotp) {
    const ticket = randomBytes(24).toString('base64url');
    await db.system(tx => tx.query(`INSERT INTO mfa_tickets (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '5 minutes')`, [hashToken(ticket), userId]));
    return { mfaRequired: true, ticket };
  }
  return { mfaRequired: false, token: await issueSession(db, userId, false), userId };
}

/** Step 3 (when enrolled): the authenticator code. */
export async function verifyMfaLogin(db: Db, key: string | null, ticket: string, code: string) {
  if (!key) throw new AppError(503, 'MFA_UNAVAILABLE', 'Ek doğrulama bu sunucuda yapılandırılmamış.');
  const userId = await db.system(async tx => {
    const t = (await tx.query(`SELECT * FROM mfa_tickets WHERE token_hash = $1 AND expires_at > now() FOR UPDATE`, [hashToken(ticket)])).rows[0];
    if (!t) throw new AppError(401, 'MFA_TICKET_INVALID', 'Doğrulama süresi doldu; yeniden giriş yap.');
    if (t.attempts >= MAX_ATTEMPTS) throw tooMany();
    await tx.query(`UPDATE mfa_tickets SET attempts = attempts + 1 WHERE token_hash = $1`, [t.token_hash]);
    const m = (await tx.query(`SELECT secret_enc FROM mfa_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL`, [t.user_id])).rows[0];
    if (!m || !verifyTotp(decryptSecret(m.secret_enc, key), code)) return null;
    await tx.query(`DELETE FROM mfa_tickets WHERE token_hash = $1`, [t.token_hash]);
    return t.user_id as string;
  });
  if (!userId) throw new AppError(401, 'MFA_CODE_INVALID', 'Doğrulama kodu hatalı.');
  return { token: await issueSession(db, userId, true), userId };
}

/** Starts (or restarts, until confirmed) authenticator enrollment for the signed-in user. */
export async function startTotpSetup(db: Db, key: string | null, userId: string) {
  if (!key) throw new AppError(503, 'MFA_UNAVAILABLE', 'Ek doğrulama bu sunucuda yapılandırılmamış (MFA_ENCRYPTION_KEY).');
  const secret = newTotpSecret();
  const email = await db.system(async tx => {
    const cur = (await tx.query(`SELECT confirmed_at FROM mfa_totp WHERE user_id = $1`, [userId])).rows[0];
    if (cur?.confirmed_at) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Ek doğrulama zaten açık.');
    await tx.query(`INSERT INTO mfa_totp (user_id, secret_enc) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, created_at = now()`,
      [userId, encryptSecret(secret, key)]);
    return (await tx.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0]?.email ?? userId;
  });
  return { secret, otpauthUri: otpauthUri(secret, email) };
}

export async function confirmTotpSetup(db: Db, key: string | null, userId: string, sessionToken: string, code: string) {
  if (!key) throw new AppError(503, 'MFA_UNAVAILABLE', 'Ek doğrulama bu sunucuda yapılandırılmamış.');
  await db.system(async tx => {
    const m = (await tx.query(`SELECT secret_enc, confirmed_at FROM mfa_totp WHERE user_id = $1 FOR UPDATE`, [userId])).rows[0];
    if (!m || m.confirmed_at) throw new AppError(409, 'MFA_NOT_PENDING', 'Bekleyen bir kurulum yok.');
    if (!verifyTotp(decryptSecret(m.secret_enc, key), code)) throw new AppError(401, 'MFA_CODE_INVALID', 'Doğrulama kodu hatalı.');
    await tx.query(`UPDATE mfa_totp SET confirmed_at = now() WHERE user_id = $1`, [userId]);
    await tx.query(`UPDATE sessions SET mfa_satisfied = true WHERE token_hash = $1`, [hashToken(sessionToken)]);
  });
  return { enabled: true };
}

/** Ends this session. The row is kept (revoked) so the session list stays truthful. */
export async function logout(db: Db, token: string) {
  await db.system(tx => tx.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(token)]));
}

/** The user's own sessions; tokens are never returned, only ids and times. */
export async function listSessions(db: Db, userId: string, currentId: string | undefined) {
  return db.system(async tx => (await tx.query(
    `SELECT id, created_at, last_used_at, expires_at, mfa_satisfied FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [userId])).rows
    .map(r => ({ ...r, current: r.id === currentId })));
}

/** A user can end any one of their own sessions (e.g. a lost phone). Someone else's session id is "not found". */
export async function revokeSession(db: Db, userId: string, sessionId: string) {
  return db.system(async tx => {
    const r = await tx.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'user_revoked'
                               WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [sessionId, userId]);
    if (!r.rowCount) throw new AppError(404, 'NOT_FOUND', 'Oturum bulunamadı.');
    await appendAudit(tx, { companyId: null, actorId: userId, eventType: 'session.revoked', entityType: 'session', entityId: sessionId, payload: {} });
    return { revoked: 1 };
  });
}

/** Signs out every other device of this user. */
export async function revokeOtherSessions(db: Db, userId: string, currentId: string | undefined) {
  return db.system(async tx => {
    const r = await tx.query(`UPDATE sessions SET revoked_at = now(), revoke_reason = 'other_sessions_revoked'
                               WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2::uuid`, [userId, currentId ?? null]);
    await appendAudit(tx, { companyId: null, actorId: userId, eventType: 'session.others_revoked', entityType: 'user', entityId: userId, payload: { count: r.rowCount } });
    return { revoked: r.rowCount };
  });
}
