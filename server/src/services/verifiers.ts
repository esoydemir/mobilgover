import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { actionContributors, roundPerformers, selfVerifyAllowed, type RiskLevel } from '../domain/ncrflow';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify } from './notifications';

/**
 * Outside verifier: a business (e.g. with a single manager) invites a person it trusts to check
 * claimed results and closures. The grant is limited: reading cases and verifying, nothing else;
 * optionally one site; always time-limited; revocable. The verifier still cannot verify work they
 * took part in or a service they delivered for that case.
 */
export const VERIFIER_SCOPE = 'ncr_verify';
const DAYS = [7, 30, 90] as const;

export async function inviteVerifier(tx: Tx, p: Principal, companyId: string, b: { email: string; siteId: string | null; days: number; note: string; documents?: boolean }) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden('Dış doğrulayıcıyı işletme sahibi ya da merkez yöneticisi davet eder.');
  if (!DAYS.includes(b.days as 7)) throw invalid('Süre 7, 30 ya da 90 gün olmalı.');
  if (b.note.trim().length < 5) throw invalid('Neden davet ettiğini kısaca yaz (ör. tek yöneticiliyiz, bağımsız doğrulama için).');
  const email = b.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid('Geçerli bir e-posta adresi gir.');
  if (b.siteId && !(await tx.query(`SELECT 1 FROM sites WHERE id = $1 AND company_id = $2`, [b.siteId, companyId])).rowCount) throw invalid('Şube bu işletmeye ait değil.');
  await tx.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [email.split('@')[0], email]);
  const userId = (await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
  if (userId === p.userId) throw invalid('Kendini dış doğrulayıcı olarak davet edemezsin.');
  // A member of this business is not an outside verifier.
  if ((await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status IN ('active','invited')`, [userId, companyId])).rowCount) {
    throw conflict('ALREADY_MEMBER', 'Bu kişi işletmenin üyesi; dış doğrulayıcı olarak davet edilemez.');
  }
  if ((await tx.query(`SELECT 1 FROM access_grants WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL AND expires_at > now() AND $3 = ANY(scopes)`,
    [userId, companyId, VERIFIER_SCOPE])).rowCount) throw conflict('ALREADY_INVITED', 'Bu kişinin geçerli bir doğrulayıcı izni zaten var.');
  const g = (await tx.query<{ id: string; expires_at: string }>(
    `INSERT INTO access_grants (company_id, user_id, kind, scopes, granted_by, reason, expires_at, site_id)
     VALUES ($1,$2,'expert',$3,$4,$5, now() + make_interval(days => $6), $7) RETURNING id, expires_at`,
    [companyId, userId, b.documents ? [VERIFIER_SCOPE, 'documents_review'] : [VERIFIER_SCOPE], p.userId, b.note.trim(), b.days, b.siteId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'verifier.invited', entityType: 'access_grant', entityId: g.id,
    payload: { userId, email, siteId: b.siteId, days: b.days, scopes: b.documents ? [VERIFIER_SCOPE, 'documents_review'] : [VERIFIER_SCOPE], note: b.note.trim() } });
  const company = (await tx.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [companyId])).rows[0]!.name;
  await notify(tx, { companyId, siteId: b.siteId, userIds: [userId], kind: 'verifier_invited', entityType: 'access_grant', entityId: g.id,
    dedupeKey: `verifier_invited:${g.id}`, title: 'Dış doğrulayıcı olarak davet edildin',
    body: `${company} · ${b.days} gün · yalnızca uygunsuzlukları görme ve doğrulama${b.documents ? ', belge inceleme' : ''} yetkisi. Kendi katkın olan işi doğrulayamazsın.` });
  return { id: g.id, userId, expiresAt: g.expires_at };
}

export async function listVerifiers(tx: Tx, p: Principal, companyId: string) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  return (await tx.query(`SELECT g.id, g.user_id, u.email, u.display_name, g.site_id, g.scopes, s.name AS site_name, g.reason, g.expires_at, g.revoked_at, g.created_at,
       gu.display_name AS granted_by_name, (g.revoked_at IS NULL AND g.expires_at > now()) AS active
     FROM access_grants g JOIN users u ON u.id = g.user_id JOIN users gu ON gu.id = g.granted_by LEFT JOIN sites s ON s.id = g.site_id
    WHERE g.company_id = $1 AND $2 = ANY(g.scopes) ORDER BY g.created_at DESC`, [companyId, VERIFIER_SCOPE])).rows;
}

export async function revokeVerifier(tx: Tx, p: Principal, companyId: string, grantId: string) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  const g = (await tx.query(`SELECT * FROM access_grants WHERE id = $1 AND company_id = $2 AND $3 = ANY(scopes) FOR UPDATE`, [grantId, companyId, VERIFIER_SCOPE])).rows[0];
  if (!g) throw notFound('Doğrulayıcı izni');
  if (g.revoked_at) return { revoked: false };
  await tx.query(`UPDATE access_grants SET revoked_at = now() WHERE id = $1`, [grantId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'verifier.revoked', entityType: 'access_grant', entityId: grantId, payload: { userId: g.user_id } });
  return { revoked: true };
}

/**
 * What this person may verify now: claimed action results and cases awaiting closure in the sites
 * they cover. Items they took part in are listed with the reason they cannot verify them.
 */
export async function verificationQueue(tx: Tx, p: Principal, companyId: string) {
  const ncrs = (await tx.query(`SELECT * FROM nonconformities WHERE company_id = $1 AND status <> 'closed' ORDER BY detected_at DESC`, [companyId])).rows
    .filter(n => can(p, 'ncr.verify', { companyId, siteId: n.site_id }).ok || can(p, 'ncr.verify_close', { companyId, siteId: n.site_id }).ok);
  const out: { kind: 'action' | 'closure'; ncrId: string; title: string; riskLevel: string; actionId?: string; description?: string; legacy?: boolean;
    canVerify: boolean; selfOnly: boolean; blockedReason: string | null }[] = [];
  for (const n of ncrs) {
    const actions = (await tx.query(`SELECT a.*, COALESCE((SELECT array_agg(DISTINCT e.created_by) FROM evidence e WHERE e.action_id = a.id), '{}') AS evidence_by
       FROM ncr_actions a WHERE a.ncr_id = $1`, [n.id])).rows;
    const providers = (await tx.query<{ user_id: string }>(`SELECT DISTINCT pp.user_id FROM service_requests r JOIN service_jobs j ON j.request_id = r.id
       JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE r.ncr_id = $1`, [n.id])).rows.map(r => r.user_id);
    const isProvider = providers.includes(p.userId);
    for (const a of actions) {
      if (a.status !== 'done' || !(a.verification_status === 'declared' || a.verification_status === 'legacy')) continue;
      const mine = actionContributors({ kind: a.kind, iteration: a.iteration, status: a.status, ownerId: a.owner_id, performedBy: a.performed_by, doneBy: a.done_by, evidenceBy: a.evidence_by }).has(p.userId);
      const selfOk = mine && !isProvider && selfVerifyAllowed(n.risk_level as RiskLevel, a.kind);
      out.push({ kind: 'action', ncrId: n.id, title: n.title, riskLevel: n.risk_level, actionId: a.id, description: a.description, legacy: a.verification_status === 'legacy',
        canVerify: !mine && !isProvider, selfOnly: selfOk,
        blockedReason: isProvider ? 'Bu kayıt için hizmeti sen verdin.' : mine ? (selfOk ? 'Payın var; yalnızca etiketli öz doğrulama yapabilirsin.' : 'Payın var; bağımsız biri doğrulamalı.') : null });
    }
    if (n.status === 'awaiting_verification') {
      const input = { iteration: n.iteration, providerUsers: providers, actions: actions.map(a => ({ kind: a.kind, iteration: a.iteration, status: a.status, ownerId: a.owner_id,
        performedBy: a.performed_by, doneBy: a.done_by, evidenceBy: a.evidence_by, verification: a.verification_status })) };
      const mine = roundPerformers(input).has(p.userId);
      const selfOk = mine && !isProvider && !n.risk_rationale.independentVerification && selfVerifyAllowed(n.risk_level as RiskLevel, 'closure');
      out.push({ kind: 'closure', ncrId: n.id, title: n.title, riskLevel: n.risk_level, canVerify: !mine, selfOnly: selfOk,
        blockedReason: isProvider ? 'Bu kayıt için hizmeti sen verdin.' : mine ? (selfOk ? 'Payın var; yalnızca etiketli öz doğrulama yapabilirsin.' : 'Payın var; bağımsız biri doğrulamalı.') : null });
    }
  }
  return out;
}
