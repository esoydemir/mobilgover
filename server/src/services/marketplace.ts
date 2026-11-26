import { randomInt } from 'node:crypto';
import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { ALLOWED_MIME } from '../storage/local';
import { appendAudit } from './audit';
import { notify, notifyUser, siteManagers } from './notifications';

/*
 * Professional network and service marketplace.
 *  - Opening a profile is open to anyone; it grants nothing by itself.
 *  - Offering services needs an approved authorization per category.
 *  - Identity, business registration and credentials are separate checks.
 *  - Check-in ≠ proof of work; report, business acceptance and technical
 *    verification are separate steps. Payments are out of scope here.
 * Provider-side calls run in system mode, so every query below filters by
 * the provider's own profile or approved categories explicitly.
 */

const isReviewer = (p: Principal) => p.platformRoles.includes('marketplace_reviewer');
const today = () => new Date().toISOString().slice(0, 10);
/** A request is visible to provider $1 when it is open-market, sent to them alone, or they are one of its chosen providers. */
const VISIBLE_TO_PROVIDER = `((r.invited_profile_id IS NULL AND NOT EXISTS (SELECT 1 FROM service_request_invites i0 WHERE i0.request_id = r.id))
  OR r.invited_profile_id = $1 OR EXISTS (SELECT 1 FROM service_request_invites i1 WHERE i1.request_id = r.id AND i1.profile_id = $1))`;

/**
 * SQL condition for an approval that can take new work today ($n = today's date):
 * approved, not past its end date, and every document it rests on still verified and in date.
 */
const LIVE_AUTH = (alias: string, n: number) => `${alias}.status = 'approved' AND ${alias}.valid_until >= $${n}::date
  AND NOT EXISTS (SELECT 1 FROM professional_verifications bv WHERE bv.id = ANY(${alias}.basis_verification_ids)
                   AND (bv.status <> 'verified' OR bv.valid_until < $${n}::date))`;

/**
 * SQL condition for a quote the business could accept right now: still submitted, in date, from an active provider with a live
 * approval for the request's category. Same checks as acceptQuote.
 */
export const ACCEPTABLE_QUOTE = (q: string, category: string, n: number) => `${q}.status = 'submitted' AND ${q}.valid_until >= now()
  AND EXISTS (SELECT 1 FROM service_authorizations a JOIN professional_profiles ap ON ap.id = a.profile_id
               WHERE a.profile_id = ${q}.provider_profile_id AND a.category_code = ${category} AND ap.status = 'active' AND ${LIVE_AUTH('a', n)})`;

async function ownProfile(tx: Tx, p: Principal) {
  const r = (await tx.query(`SELECT * FROM professional_profiles WHERE user_id = $1`, [p.userId])).rows[0];
  if (!r) throw notFound('Mesleki profil');
  if (r.status !== 'active') throw forbidden('Profil askıya alınmış.');
  return r;
}

// ── Provider: profile, verifications, authorizations ──

export async function upsertProfile(tx: Tx, p: Principal, b: { kind: 'individual' | 'company'; displayName: string; headline: string; city: string; district?: string | null; bio: string }) {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO professional_profiles (user_id, kind, display_name, headline, city, district, bio) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET kind = EXCLUDED.kind, display_name = EXCLUDED.display_name, headline = EXCLUDED.headline,
       city = EXCLUDED.city, district = EXCLUDED.district, bio = EXCLUDED.bio RETURNING id`,
    [p.userId, b.kind, b.displayName, b.headline, b.city, b.district ?? null, b.bio]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'pro.profile_saved', entityType: 'professional_profile', entityId: r.rows[0]!.id, payload: { city: b.city } });
  return { id: r.rows[0]!.id };
}

/** What a business (or the provider) sees: each check listed separately, with what was not checked. */
export async function profileView(tx: Tx, profileId: string) {
  const pr = (await tx.query(`SELECT id, kind, display_name, headline, city, district, bio, status, created_at FROM professional_profiles WHERE id = $1`, [profileId])).rows[0];
  if (!pr) throw notFound('Mesleki profil');
  const ver = (await tx.query(
    `SELECT id, kind, credential_type, issuer, scope_note, valid_until, status, check_method, checked_at, submitted_at
       FROM professional_verifications WHERE profile_id = $1 ORDER BY submitted_at`, [profileId])).rows
    .map(v => ({ ...v, expired: v.valid_until !== null && v.valid_until < today() }));
  const auth = (await tx.query(
    `SELECT a.category_code, c.name, a.status, a.decided_at, a.valid_until, c.is_example, (a.status = 'approved' AND NOT (${LIVE_AUTH('a', 2)})) AS expired
       FROM service_authorizations a JOIN service_categories c ON c.code = a.category_code
      WHERE a.profile_id = $1 ORDER BY c.name`, [profileId, today()])).rows;
  const identity = ver.find(v => v.kind === 'identity' && v.status === 'verified');
  // Only jobs that were delivered and accepted, reviewed, and that the business allowed to show.
  // The business is never named; the month and the category are enough.
  const history = (await tx.query(
    `SELECT to_char(j.accepted_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') AS month, c.name AS category_name, r.city,
            sr.quality, sr.timeliness, sr.communication, sr.comment
       FROM service_reviews sr JOIN service_jobs j ON j.id = sr.job_id JOIN service_requests r ON r.id = j.request_id
       JOIN service_categories c ON c.code = r.category_code
      WHERE sr.provider_profile_id = $1 AND sr.show_on_profile AND j.status = 'accepted' ORDER BY j.accepted_at DESC LIMIT 50`, [profileId])).rows;
  // Distribution over the same reviewed, accepted, profile-visible jobs: overall score per job (mean of the three criteria, rounded) → count.
  const distribution = [1, 2, 3, 4, 5].map(star => ({ stars: star, count: history.filter(h => Math.round((h.quality + h.timeliness + h.communication) / 3) === star).length }));
  const avg = (k: 'quality' | 'timeliness' | 'communication') => history.length ? Math.round(history.reduce((a, h) => a + h[k], 0) / history.length * 10) / 10 : null;
  return {
    profile: pr,
    serviceHistory: {
      items: history,
      summary: { count: history.length, distribution, responseTime: null, quality: avg('quality'), timeliness: avg('timeliness'), communication: avg('communication') },
      note: 'Yalnızca teslim edilip işletmece kabul edilmiş ve işletmenin profilde gösterilmesine izin verdiği işler; işletme adı gösterilmez. Yanıt süresi henüz ölçülmüyor; örnek sayısı azsa dağılım yanıltıcı olabilir.',
    },
    identity: identity ? { status: 'verified', checkedAt: identity.checked_at, method: identity.check_method } : { status: 'not_verified' },
    credentials: ver.filter(v => v.kind === 'credential'),
    businessRegistration: ver.filter(v => v.kind === 'business_registration'),
    authorizedCategories: auth.filter(a => a.status === 'approved' && !a.expired),
    otherCategoryRequests: auth.filter(a => a.status !== 'approved' || a.expired),
    notChecked: [
      ...(identity ? [] : ['Kimlik']),
      'Oda / meslek birliği kaydı (bu aşamada kontrol edilmiyor)',
      'Mesleki sorumluluk sigortası (bu aşamada kontrol edilmiyor)',
    ],
    disclaimer: 'Kimlik doğrulaması mesleki yetkinlik onayı değildir. Hizmet verme onayı yalnızca listelenen kategoriler için geçerlidir.',
  };
}

export async function submitVerification(tx: Tx, p: Principal, b: { kind: 'identity' | 'business_registration' | 'credential'; credentialType?: string | null; issuer: string; documentRef: string; scopeNote?: string | null; validUntil?: string | null }) {
  const pr = await ownProfile(tx, p);
  if (b.kind === 'credential' && !b.credentialType) throw invalid('Mesleki belge için belge türü gerekli.');
  if (b.kind !== 'credential' && b.credentialType) throw invalid('Belge türü yalnızca mesleki belgede kullanılır.');
  const r = await tx.query<{ id: string }>(
    `INSERT INTO professional_verifications (profile_id, kind, credential_type, issuer, document_ref, scope_note, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [pr.id, b.kind, b.credentialType ?? null, b.issuer, b.documentRef, b.scopeNote ?? null, b.validUntil ?? null]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'pro.verification_submitted', entityType: 'professional_verification', entityId: r.rows[0]!.id, payload: { kind: b.kind, credentialType: b.credentialType ?? null } });
  return { id: r.rows[0]!.id, status: 'pending' };
}

export async function requestAuthorization(tx: Tx, p: Principal, categoryCode: string) {
  const pr = await ownProfile(tx, p);
  const cat = (await tx.query(`SELECT code FROM service_categories WHERE code = $1`, [categoryCode])).rows[0];
  if (!cat) throw notFound('Hizmet kategorisi');
  const r = await tx.query<{ id: string }>(
    `INSERT INTO service_authorizations (profile_id, category_code) VALUES ($1,$2)
     ON CONFLICT (profile_id, category_code) DO UPDATE SET status = 'pending', decided_by = NULL, decided_at = NULL, reason = NULL, requested_at = now()
       WHERE service_authorizations.status IN ('rejected') RETURNING id`, [pr.id, categoryCode]);
  if (!r.rowCount) throw conflict('ALREADY_REQUESTED', 'Bu kategori için başvuru zaten var.');
  return { id: r.rows[0]!.id, status: 'pending' };
}

// ── Marketplace review (platform) ──

export async function decideVerification(tx: Tx, p: Principal, id: string, b: { decision: 'verified' | 'rejected'; checkMethod: string; notes: string }) {
  if (!isReviewer(p)) throw forbidden();
  const v = (await tx.query(`SELECT v.*, pp.user_id FROM professional_verifications v JOIN professional_profiles pp ON pp.id = v.profile_id WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
  if (!v) throw notFound('Doğrulama');
  if (v.status !== 'pending') throw conflict('INVALID_STATE', 'Bu doğrulama zaten sonuçlanmış.');
  if (v.user_id === p.userId) throw forbidden('Kendi belgeni doğrulayamazsın.');
  if (b.checkMethod.trim().length < 5) throw invalid('Nasıl kontrol edildiğini yaz (ör. "e-Devlet belge sorgusu").');
  await tx.query(`UPDATE professional_verifications SET status = $2, check_method = $3, notes = $4, checked_by = $5, checked_at = now() WHERE id = $1`,
    [id, b.decision, b.checkMethod, b.notes, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'pro.verification_decided', entityType: 'professional_verification', entityId: id, payload: { decision: b.decision, kind: v.kind } });
}

/**
 * Category approval requires a verified identity and every credential the
 * category lists, verified and in date. The basis is recorded.
 */
export async function decideAuthorization(tx: Tx, p: Principal, id: string, b: { decision: 'approved' | 'rejected' | 'suspended'; reason: string; validUntil?: string | null }) {
  if (!isReviewer(p)) throw forbidden();
  const a = (await tx.query(
    `SELECT a.*, pp.user_id, c.required_credentials FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id
       JOIN service_categories c ON c.code = a.category_code WHERE a.id = $1 FOR UPDATE OF a`, [id])).rows[0];
  if (!a) throw notFound('Başvuru');
  if (a.user_id === p.userId) throw forbidden('Kendi başvurunu onaylayamazsın.');
  if (b.reason.trim().length < 5) throw invalid('Karar gerekçesi yaz.');
  let basis: string[] = [];
  if (b.decision === 'approved') {
    const ver = (await tx.query(`SELECT id, kind, credential_type, valid_until FROM professional_verifications WHERE profile_id = $1 AND status = 'verified' AND (valid_until IS NULL OR valid_until >= $2)`,
      [a.profile_id, today()])).rows;
    const identity = ver.find(v => v.kind === 'identity');
    const missing = (a.required_credentials as string[]).filter(c => !ver.some(v => v.kind === 'credential' && v.credential_type === c));
    if (!identity) missing.unshift('identity');
    if (missing.length) throw new AppError(422, 'CREDENTIALS_MISSING', `Onay için doğrulanmış ve süresi geçmemiş belge gerekli: ${missing.join(', ')}`, { missing });
    const basisRows = [identity!, ...ver.filter(v => v.kind === 'credential' && a.required_credentials.includes(v.credential_type))];
    basis = basisRows.map(v => v.id);
    // The approval ends no later than the first basis document does.
    if (!b.validUntil || b.validUntil <= today()) throw invalid('Onayın bitiş tarihini (bugünden sonra) yaz.');
    const cap = basisRows.map(v => v.valid_until).filter(Boolean).map(d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d))).sort()[0];
    if (cap && b.validUntil > cap) throw new AppError(422, 'VALIDITY_EXCEEDS_CREDENTIAL', `Onay, dayandığı belgenin bitişinden (${cap}) sonra bitemez.`, { cap });
  }
  const validUntil = b.decision === 'approved' ? b.validUntil! : null;
  await tx.query(`UPDATE service_authorizations SET status = $2, reason = $3, decided_by = $4, decided_at = now(), basis_verification_ids = $5, valid_until = $6 WHERE id = $1`,
    [id, b.decision, b.reason, p.userId, basis, validUntil]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'pro.authorization_decided', entityType: 'service_authorization', entityId: id, payload: { decision: b.decision, category: a.category_code, basis, validUntil } });
}

export async function reviewQueue(tx: Tx, p: Principal) {
  if (!isReviewer(p)) throw forbidden();
  const verifications = (await tx.query(
    `SELECT v.*, pp.display_name FROM professional_verifications v JOIN professional_profiles pp ON pp.id = v.profile_id WHERE v.status = 'pending' ORDER BY v.submitted_at`)).rows;
  const authorizations = (await tx.query(
    `SELECT a.*, pp.display_name, c.name AS category_name, c.required_credentials FROM service_authorizations a
       JOIN professional_profiles pp ON pp.id = a.profile_id JOIN service_categories c ON c.code = a.category_code WHERE a.status = 'pending' ORDER BY a.requested_at`)).rows;
  // Context a reviewer needs next to the decision: the same expert's other submissions (each submission is its own record; there is no document version number) and,
  // for a category request, the state of the expert's documents it can rest on.
  const docs = (await tx.query(`SELECT id, profile_id, kind, credential_type, issuer, document_ref, valid_until, status, submitted_at, checked_at FROM professional_verifications
     WHERE profile_id = ANY($1::uuid[]) ORDER BY submitted_at DESC`, [[...new Set([...verifications, ...authorizations].map((r: any) => r.profile_id))]])).rows;
  const of = (r: any) => docs.filter((d: any) => d.profile_id === r.profile_id);
  return { verifications: verifications.map((v: any) => ({ ...v, profile_documents: of(v).filter((d: any) => d.id !== v.id) })),
    authorizations: authorizations.map((a: any) => ({ ...a, profile_documents: of(a) })) };
}

// ── Business: requests, quotes, jobs ──

/** Providers authorized for a category. No paid ranking exists; order is by verified credentials, then name. */
/**
 * Providers who can take this category today. Filters: free text (name, headline, bio), city / district, minimum number of verified
 * credentials, and "has reviewed jobs". Each row carries the review summary of accepted, reviewed jobs the business allowed on the profile.
 * Language, availability and remote/on-site are not stored for providers yet, so they are not offered as filters.
 */
export async function providersFor(tx: Tx, categoryCode: string, f: { q?: string; city?: string; district?: string; minCredentials?: number; reviewedOnly?: boolean } = {}) {
  const rows = (await tx.query(
    `SELECT pp.id, pp.display_name, pp.headline, pp.city, pp.district, a.valid_until AS auth_valid_until,
            (SELECT count(*)::int FROM professional_verifications v WHERE v.profile_id = pp.id AND v.status = 'verified' AND v.kind = 'credential') AS verified_credentials,
            (SELECT count(*)::int FROM service_reviews sr JOIN service_jobs j ON j.id = sr.job_id WHERE sr.provider_profile_id = pp.id AND sr.show_on_profile AND j.status = 'accepted') AS reviewed_jobs,
            (SELECT round(avg((sr.quality + sr.timeliness + sr.communication) / 3.0), 1)::float FROM service_reviews sr JOIN service_jobs j ON j.id = sr.job_id
              WHERE sr.provider_profile_id = pp.id AND sr.show_on_profile AND j.status = 'accepted') AS rating
       FROM professional_profiles pp JOIN service_authorizations a ON a.profile_id = pp.id
      WHERE a.category_code = $1 AND ${LIVE_AUTH('a', 2)} AND pp.status = 'active'
        AND ($3::text IS NULL OR lower(pp.city) = lower($3)) AND ($4::text IS NULL OR lower(coalesce(pp.district, '')) = lower($4))
        AND ($5::text IS NULL OR pp.display_name ILIKE '%' || $5 || '%' OR pp.headline ILIKE '%' || $5 || '%' OR pp.bio ILIKE '%' || $5 || '%')
      ORDER BY verified_credentials DESC, pp.display_name`,
    [categoryCode, today(), f.city?.trim() || null, f.district?.trim() || null, f.q?.trim().replace(/[%_\\]/g, '') || null])).rows;
  return rows.filter(r => r.verified_credentials >= (f.minCredentials ?? 0) && (!f.reviewedOnly || r.reviewed_jobs > 0))
    .map(r => ({ ...r, sponsored: false }));
}

/** A request opened from a case or a check belongs to that record's branch; it is never filed under another one. */
async function assertSourceSite(tx: Tx, companyId: string, siteId: string, ncrId?: string | null, taskId?: string | null) {
  for (const [id, table, label] of [[ncrId, 'nonconformities', 'Uygunsuzluk'], [taskId, 'tasks', 'Görev']] as const) {
    if (!id) continue;
    const row = (await tx.query<{ site_id: string }>(`SELECT site_id FROM ${table} WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
    if (!row) throw notFound(label);
    if (row.site_id !== siteId) throw new AppError(422, 'SOURCE_OTHER_SITE', 'Bu talebin kaynak kaydı başka bir şubeye ait; talep o şube için açılmalı.');
  }
}

export async function createRequest(tx: Tx, p: Principal, companyId: string, b: { siteId: string; categoryCode: string; title: string; description: string; ncrId?: string | null; taskId?: string | null; city: string; shareNcrSummary?: boolean;
  invitedProfileId?: string | null; invitedProfileIds?: string[] }) {
  if (!can(p, 'service.request', { companyId, siteId: b.siteId }).ok) throw forbidden();
  if (!(await tx.query(`SELECT 1 FROM service_categories WHERE code = $1`, [b.categoryCode])).rowCount) throw notFound('Hizmet kategorisi');
  await assertSourceSite(tx, companyId, b.siteId, b.ncrId, b.taskId);
  if (b.shareNcrSummary && !b.ncrId) throw invalid('Paylaşmak için bir uygunsuzluk seç.');
  // From a network profile: the request goes to that provider only, and only within a category they hold
  // a live approval for. A network profile alone is not an approval.
  // Several chosen providers (2–5): the request goes only to them and their quotes are compared like for like.
  const selected = [...new Set(b.invitedProfileIds ?? [])];
  if (selected.length && b.invitedProfileId) throw invalid('Tek uzman ile birden çok uzman birlikte seçilemez.');
  if (selected.length === 1) { b = { ...b, invitedProfileId: selected[0], invitedProfileIds: [] }; selected.length = 0; }
  if (selected.length > 5) throw invalid('En fazla 5 uzmana gönderilebilir.');
  for (const id of [...selected, ...(b.invitedProfileId ? [b.invitedProfileId] : [])]) {
    const ok = (await tx.query(`SELECT 1 FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id
       WHERE a.profile_id = $1 AND a.category_code = $2 AND pp.status = 'active' AND ${LIVE_AUTH('a', 3)}`, [id, b.categoryCode, today()])).rowCount;
    if (!ok) throw new AppError(422, 'PROVIDER_NOT_APPROVED_FOR_CATEGORY', 'Seçilen uzmanlardan birinin bu kategoride geçerli hizmet onayı yok; talep ona gönderilemez.');
  }
  const r = await tx.query<{ id: string }>(
    `INSERT INTO service_requests (company_id, site_id, category_code, title, description, ncr_id, city, created_by, share_ncr_summary, invited_profile_id, task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [companyId, b.siteId, b.categoryCode, b.title, b.description, b.ncrId ?? null, b.city, p.userId, !!b.shareNcrSummary, b.invitedProfileId ?? null, b.taskId ?? null]);
  for (const id of selected) await tx.query(`INSERT INTO service_request_invites (request_id, company_id, profile_id) VALUES ($1,$2,$3)`, [r.rows[0]!.id, companyId, id]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'service.requested', entityType: 'service_request', entityId: r.rows[0]!.id,
    payload: { category: b.categoryCode, ncrId: b.ncrId ?? null, sharedWithProviders: sharedFields(!!b.shareNcrSummary), ...(selected.length ? { selectedProviders: selected.length } : {}) } });
  // Providers approved for this category hear about it (no business name: it is revealed only on award).
  const pros = (await tx.query<{ user_id: string }>(`SELECT DISTINCT pp.user_id FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id
     WHERE a.category_code = $1 AND pp.status = 'active' AND ${LIVE_AUTH('a', 2)} AND ($3::uuid IS NULL OR pp.id = $3)
       AND ($4::uuid[] IS NULL OR pp.id = ANY($4))`, [b.categoryCode, today(), b.invitedProfileId ?? null, selected.length ? selected : null])).rows;
  const cat = (await tx.query<{ name: string }>(`SELECT name FROM service_categories WHERE code = $1`, [b.categoryCode])).rows[0]!.name;
  for (const pr of pros) {
    if (pr.user_id === p.userId) continue;
    await notifyUser(tx, { companyId, siteId: null, userId: pr.user_id, kind: 'provider_new_request', entityType: 'pro_request', entityId: r.rows[0]!.id,
      dedupeKey: `provider_new_request:${r.rows[0]!.id}`, title: b.invitedProfileId ? 'Profilin üzerinden sana hizmet talebi geldi' : selected.length ? 'Seçilen uzmanlardan biri olarak sana hizmet talebi geldi' : 'Kategorinde yeni hizmet talebi', body: `${cat} · ${b.title} · ${b.city}` });
  }
  return { id: r.rows[0]!.id };
}

/** Exactly what a provider can see of a request; recorded with the request so the business has a record of what it shared. */
function sharedFields(shareNcr: boolean) {
  return ['title', 'description', 'city', 'category', ...(shareNcr ? ['ncr.title', 'ncr.risk_level', 'ncr.hazard_type'] : []), 'after_award:company_name', 'after_award:site_name'];
}

export async function listRequests(tx: Tx, p: Principal, companyId: string) {
  if (!can(p, 'service.request', { companyId, siteId: null }).ok && !p.memberships.some(m => m.companyId === companyId && m.role === 'site_manager')) throw forbidden();
  const rows = (await tx.query(
    `SELECT r.*, c.name AS category_name, (SELECT count(*)::int FROM quotes q WHERE q.request_id = r.id AND q.status = 'submitted') AS open_quotes,
     (SELECT count(*)::int FROM quotes q WHERE q.request_id = r.id AND ${ACCEPTABLE_QUOTE('q', 'r.category_code', 2)}) AS acceptable_quotes,
            j.id AS job_id, j.status AS job_status
       FROM service_requests r JOIN service_categories c ON c.code = r.category_code LEFT JOIN service_jobs j ON j.request_id = r.id
      WHERE r.company_id = $1 ORDER BY r.created_at DESC`, [companyId, today()])).rows;
  // Same rule as requestDetail: a site manager lists only their own site's requests (title, description and case link are site data).
  return rows.filter(r => can(p, 'service.request', { companyId, siteId: r.site_id }).ok);
}

export async function requestDetail(tx: Tx, p: Principal, companyId: string, id: string) {
  const r = (await tx.query(`SELECT r.*, c.name AS category_name, ip.display_name AS invited_name,
     (SELECT s.name FROM sites s WHERE s.id = r.site_id) AS site_name,
     (SELECT e.name FROM nonconformities n JOIN equipment e ON e.id = n.equipment_id WHERE n.id = r.ncr_id) AS equipment_name FROM service_requests r JOIN service_categories c ON c.code = r.category_code
     LEFT JOIN professional_profiles ip ON ip.id = r.invited_profile_id WHERE r.id = $1 AND r.company_id = $2`, [id, companyId])).rows[0];
  if (!r || !can(p, 'service.request', { companyId, siteId: r.site_id }).ok) throw notFound('Hizmet talebi');
  // Each provider's approval for this category, as it is NOW (it may have run out or been suspended since quoting).
  const quotes = (await tx.query(
    `SELECT q.*, pp.display_name, pp.status AS profile_status, (q.price_net * (1 + q.vat_rate / 100))::numeric(12,2) AS price_gross, (q.valid_until < now()) AS expired,
            EXISTS (SELECT 1 FROM service_authorizations a WHERE a.profile_id = q.provider_profile_id AND a.category_code = $2 AND ${LIVE_AUTH('a', 3)}) AS authorization_live,
            (SELECT a.status FROM service_authorizations a WHERE a.profile_id = q.provider_profile_id AND a.category_code = $2 ORDER BY a.decided_at DESC NULLS LAST LIMIT 1) AS authorization_status
       FROM quotes q JOIN professional_profiles pp ON pp.id = q.provider_profile_id WHERE q.request_id = $1 ORDER BY q.created_at`, [id, r.category_code, today()])).rows
    .map(q => { const st = providerStatus(q); return { ...q, providerStatus: st, acceptable: q.status === 'submitted' && !q.expired && st.live }; });
  const job = (await tx.query(`SELECT * FROM service_jobs WHERE request_id = $1`, [id])).rows[0] ?? null;
  const reports = job ? (await tx.query(`SELECT sr.version, sr.document_version_id, sr.report, sr.submitted_at, sr.decision, sr.decision_note, sr.decided_at, u.display_name AS decided_by_name
     FROM service_job_reports sr LEFT JOIN users u ON u.id = sr.decided_by WHERE sr.job_id = $1 ORDER BY sr.version`, [job.id])).rows : [];
  const jobProvider = job ? quotes.find(q => q.provider_profile_id === job.provider_profile_id) ?? null : null;
  const review = job ? (await tx.query(`SELECT id, quality, timeliness, communication, comment, show_on_profile, created_at FROM service_reviews WHERE job_id = $1`, [job.id])).rows[0] ?? null : null;
  const history = (await tx.query(`SELECT e.event_type, e.payload, e.occurred_at, u.display_name AS actor_name FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.company_id = $1 AND ((e.entity_type = 'service_request' AND e.entity_id = $2) OR (e.entity_type = 'service_job' AND e.entity_id = $3)
        OR (e.entity_type = 'quote' AND e.entity_id = ANY($4))) ORDER BY e.seq`, [companyId, id, job?.id ?? id, quotes.map(q => q.id)])).rows;
  const invited = (await tx.query<{ profile_id: string; display_name: string }>(`SELECT i.profile_id, pp.display_name FROM service_request_invites i JOIN professional_profiles pp ON pp.id = i.profile_id
     WHERE i.request_id = $1 ORDER BY pp.display_name`, [id])).rows;
  const mode = r.invited_profile_id ? 'direct' : invited.length ? 'selected' : 'open';
  return {
    request: r, quotes, job, review, reports, history, reportDocuments: await requestReportDocs(tx, companyId, id),
    mode, invitedProviders: invited.map(i => ({ profileId: i.profile_id, name: i.display_name })), modeNote: mode === 'direct'
      ? `Doğrudan ${r.invited_name ?? 'tek uzmana'} gönderildi; yalnız o teklif verebilir, karşılaştırma yapılmaz.`
      : mode === 'selected' ? `Seçtiğin ${invited.length} uzmana gönderildi (${invited.map(i => i.display_name).join(', ')}); yalnız onlar teklif verebilir, gelen teklifler aynı sırayla karşılaştırılır.`
      : 'Kategoride onayı olan uzmanlar teklif verebilir; gelen teklifler aynı sırayla karşılaştırılır.',
    // Same order for every quote: scope, exclusions, price, duration, deliverable.
    comparison: mode !== 'direct' && quotes.length > 1 ? COMPARE_ROWS : null,
    jobProviderStatus: jobProvider ? jobProvider.providerStatus : null,
    canReview: !!job && job.status === 'accepted' && !review,
    canCancel: (r.status === 'open') || (!!job && ['scheduled', 'checked_in', 'report_submitted', 'revision_requested'].includes(job.status)),
  };
}

export const COMPARE_ROWS = [
  { key: 'scope', label: 'Kapsam' }, { key: 'exclusions', label: 'Hariç tutulanlar' }, { key: 'price', label: 'Ücret (KDV dahil)' },
  { key: 'duration_text', label: 'Süre' }, { key: 'deliverable', label: 'Teslim edilecek çıktı' }, { key: 'warranty_text', label: 'Garanti' }, { key: 'valid_until', label: 'Teklif geçerliliği' },
];

/** What the business should know about the provider now; nothing is hidden behind a quote that was valid earlier. */
function providerStatus(q: { authorization_live: boolean; authorization_status: string | null; profile_status: string }) {
  if (q.profile_status !== 'active') return { live: false, label: 'Uzman profili askıya alındı', note: 'Bu uzmanla yeni iş başlatılamaz. Devam eden iş varsa durumunu sen değerlendir; gerekirse iptal edebilirsin.' };
  if (q.authorization_live) return { live: true, label: 'Kategori onayı geçerli', note: null };
  return { live: false, label: q.authorization_status === 'suspended' ? 'Kategori onayı askıya alındı' : 'Kategori onayı artık geçerli değil',
    note: 'Bu teklif kabul edilemez. Devam eden iş varsa raporunu dikkatle incele; gerekirse işi gerekçeyle iptal edebilirsin.' };
}

/** Business cancels an open request, or a job before it is accepted, with a reason. Kept in the history. */
export async function cancelService(tx: Tx, p: Principal, companyId: string, requestId: string, reason: string) {
  const r = (await tx.query(`SELECT * FROM service_requests WHERE id = $1 AND company_id = $2 FOR UPDATE`, [requestId, companyId])).rows[0];
  if (!r || !can(p, 'service.request', { companyId, siteId: r.site_id }).ok) throw notFound('Hizmet talebi');
  if (reason.trim().length < 10) throw invalid('İptal gerekçesini yaz (en az bir cümle).');
  const j = (await tx.query(`SELECT * FROM service_jobs WHERE request_id = $1 FOR UPDATE`, [requestId])).rows[0];
  if (j) {
    if (!['scheduled', 'checked_in', 'report_submitted', 'revision_requested'].includes(j.status)) throw conflict('INVALID_STATE', 'Kabul edilmiş ya da kapanmış iş iptal edilemez.');
    await tx.query(`UPDATE service_jobs SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`, [j.id, p.userId, reason.trim()]);
    const proUser = (await tx.query<{ user_id: string }>(`SELECT user_id FROM professional_profiles WHERE id = $1`, [j.provider_profile_id])).rows[0]!.user_id;
    await notifyUser(tx, { companyId, siteId: null, userId: proUser, kind: 'job_cancelled', entityType: 'pro_job', entityId: j.id,
      dedupeKey: `job_cancelled:${j.id}`, title: 'İş işletme tarafından iptal edildi', body: reason.trim() });
  } else if (r.status !== 'open') throw conflict('INVALID_STATE', 'Bu talep iptal edilebilir durumda değil.');
  await tx.query(`UPDATE service_requests SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`, [requestId, p.userId, reason.trim()]);
  await tx.query(`UPDATE quotes SET status = 'rejected' WHERE request_id = $1 AND status = 'submitted'`, [requestId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: j ? 'service.job_cancelled' : 'service.request_cancelled', entityType: j ? 'service_job' : 'service_request',
    entityId: j?.id ?? requestId, payload: { reason: reason.trim(), requestId } });
  return { status: 'cancelled' };
}

/**
 * Exactly what a provider would see of this request, before it is sent. Private photos, staff
 * details and business documents are never part of a request in this version.
 */
export async function requestPreview(tx: Tx, p: Principal, companyId: string, b: { siteId: string; categoryCode: string; title: string; description: string; city: string;
  ncrId?: string | null; taskId?: string | null; shareNcrSummary?: boolean; invitedProfileId?: string | null; invitedProfileIds?: string[] }) {
  if (!can(p, 'service.request', { companyId, siteId: b.siteId }).ok) throw forbidden();
  const cat = (await tx.query(`SELECT name FROM service_categories WHERE code = $1`, [b.categoryCode])).rows[0];
  await assertSourceSite(tx, companyId, b.siteId, b.ncrId, b.taskId);
  const ncr = b.ncrId && b.shareNcrSummary ? (await tx.query(`SELECT title, risk_level, hazard_type FROM nonconformities WHERE id = $1 AND company_id = $2`, [b.ncrId, companyId])).rows[0] : null;
  const invited = b.invitedProfileId ? (await tx.query(`SELECT display_name FROM professional_profiles WHERE id = $1`, [b.invitedProfileId])).rows[0] : null;
  return {
    audience: invited ? `Yalnız ${invited.display_name}` : `"${cat?.name ?? b.categoryCode}" kategorisinde geçerli onayı olan uzmanlar`,
    shown: [
      { label: 'Başlık', value: b.title }, { label: 'Açıklama', value: b.description }, { label: 'Şehir', value: b.city }, { label: 'Kategori', value: cat?.name ?? b.categoryCode },
      ...(ncr ? [{ label: 'Uygunsuzluk başlığı', value: ncr.title }, { label: 'Risk', value: ncr.risk_level }, { label: 'Tür', value: ncr.hazard_type }] : []),
    ],
    afterAward: ['İşletme adı', 'Şube adı ve adresi (yalnız teklifi kabul edilen uzmana)'],
    never: ['Uygunsuzluğun açıklaması, notları ve fotoğrafları', 'Çalışan adları ve iletişim bilgileri', 'İşletme belgeleri', 'Görevler, ölçümler ve diğer kayıtlar'],
  };
}

export async function acceptQuote(tx: Tx, p: Principal, companyId: string, quoteId: string) {
  const q = (await tx.query(`SELECT q.*, r.site_id, r.status AS request_status FROM quotes q JOIN service_requests r ON r.id = q.request_id WHERE q.id = $1 AND q.company_id = $2 FOR UPDATE OF q`, [quoteId, companyId])).rows[0];
  if (!q || !can(p, 'service.request', { companyId, siteId: q.site_id }).ok) throw notFound('Teklif');
  if (q.request_status !== 'open' || q.status !== 'submitted') throw conflict('INVALID_STATE', 'Bu teklif kabul edilebilir durumda değil.');
  if (new Date(q.valid_until) < new Date()) throw conflict('QUOTE_EXPIRED', 'Teklifin geçerlilik süresi dolmuş.');
  // The provider must still hold a live approval for this category when the job is created.
  const live = await tx.query(`SELECT 1 FROM service_authorizations a JOIN service_requests r ON r.category_code = a.category_code
                                 JOIN professional_profiles pp ON pp.id = a.profile_id
                                WHERE r.id = $1 AND a.profile_id = $2 AND pp.status = 'active' AND ${LIVE_AUTH('a', 3)}`, [q.request_id, q.provider_profile_id, today()]);
  if (!live.rowCount) throw conflict('PROVIDER_NOT_AUTHORIZED', 'Uzmanın bu kategorideki hizmet onayı artık geçerli değil; bu teklif kabul edilemez.');
  await tx.query(`UPDATE quotes SET status = 'accepted' WHERE id = $1`, [quoteId]);
  await tx.query(`UPDATE quotes SET status = 'rejected' WHERE request_id = $1 AND id <> $2 AND status = 'submitted'`, [q.request_id, quoteId]);
  await tx.query(`UPDATE service_requests SET status = 'awarded' WHERE id = $1`, [q.request_id]);
  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const job = (await tx.query<{ id: string }>(
    `INSERT INTO service_jobs (request_id, quote_id, company_id, provider_profile_id, checkin_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [q.request_id, quoteId, companyId, q.provider_profile_id, code])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'service.quote_accepted', entityType: 'service_job', entityId: job.id, payload: { quoteId, priceNet: q.price_net, payment: 'not_in_scope' } });
  const req = (await tx.query<{ title: string }>(`SELECT title FROM service_requests WHERE id = $1`, [q.request_id])).rows[0]!;
  const winner = (await tx.query<{ user_id: string }>(`SELECT user_id FROM professional_profiles WHERE id = $1`, [q.provider_profile_id])).rows[0]!.user_id;
  await notifyUser(tx, { companyId, siteId: null, userId: winner, kind: 'quote_accepted', entityType: 'pro_job', entityId: job.id,
    dedupeKey: `quote_accepted:${quoteId}`, title: 'Teklifin kabul edildi', body: `${req.title} · işletme ve şube bilgisi iş ekranında. Ödeme uygulama dışında.` });
  const losers = (await tx.query<{ id: string; user_id: string }>(`SELECT q.id, pp.user_id FROM quotes q JOIN professional_profiles pp ON pp.id = q.provider_profile_id
     WHERE q.request_id = $1 AND q.id <> $2 AND q.status = 'rejected'`, [q.request_id, quoteId])).rows;
  for (const l of losers) {
    await notifyUser(tx, { companyId, siteId: null, userId: l.user_id, kind: 'quote_not_selected', entityType: 'pro_request', entityId: q.request_id,
      dedupeKey: `quote_not_selected:${l.id}`, title: 'Teklifin seçilmedi', body: `${req.title} · işletme başka bir teklifi kabul etti.` });
  }
  return { jobId: job.id, checkinCode: code, payment: 'Ödeme bu aşamada uygulama dışında yapılır; GoverHub ödeme almaz.' };
}

/**
 * Business accepts the delivered report, or asks for a revision with a reason (the provider then
 * sends a new report version). Check-in alone is never enough. Every version and decision is kept.
 */
export async function acceptJob(tx: Tx, p: Principal, companyId: string, jobId: string, b: { accept: boolean; note: string }) {
  const j = (await tx.query(`SELECT j.*, r.site_id, r.ncr_id FROM service_jobs j JOIN service_requests r ON r.id = j.request_id WHERE j.id = $1 AND j.company_id = $2 FOR UPDATE OF j`, [jobId, companyId])).rows[0];
  if (!j || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Hizmet işi');
  if (j.status !== 'report_submitted') throw conflict('REPORT_MISSING', 'Teslim kabulü için önce uzmanın (yeni) hizmet raporu gelmeli.');
  if (b.note.trim().length < (b.accept ? 5 : 10)) throw invalid(b.accept ? 'Kabul için kısa bir not yaz.' : 'Revizyon için neyin eksik olduğunu yaz (en az bir cümle).');
  const status = b.accept ? 'accepted' : 'revision_requested';
  await tx.query(`UPDATE service_jobs SET status = $2, accepted_by = $3, accepted_at = now(), business_note = $4 WHERE id = $1`, [jobId, status, p.userId, b.note.trim()]);
  await tx.query(`UPDATE service_job_reports SET decision = $2, decision_note = $3, decided_by = $4, decided_at = now()
     WHERE job_id = $1 AND version = (SELECT max(version) FROM service_job_reports WHERE job_id = $1)`, [jobId, status, b.note.trim(), p.userId]);
  if (b.accept) await tx.query(`UPDATE service_requests SET status = 'completed' WHERE id = $1`, [j.request_id]);
  // A revision request means this file version was not accepted: it stays in the history as rejected. Accepting the delivery leaves the file's own review untouched.
  else await tx.query(`UPDATE document_versions SET review_status = 'rejected', reviewed_by = $2, reviewed_at = clock_timestamp(), review_notes = $3
     WHERE review_status = 'unreviewed' AND id = (SELECT document_version_id FROM service_job_reports WHERE job_id = $1 ORDER BY version DESC LIMIT 1)`, [jobId, p.userId, b.note.trim()]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.accept ? 'service.accepted' : 'service.revision_requested', entityType: 'service_job', entityId: jobId,
    payload: { ncrId: j.ncr_id, note: b.note.trim() } });
  const proUser = (await tx.query<{ user_id: string }>(`SELECT user_id FROM professional_profiles WHERE id = $1`, [j.provider_profile_id])).rows[0]!.user_id;
  const v = (await tx.query<{ n: number }>(`SELECT max(version)::int AS n FROM service_job_reports WHERE job_id = $1`, [jobId])).rows[0]!.n;
  await notifyUser(tx, { companyId, siteId: null, userId: proUser, kind: b.accept ? 'job_accepted' : 'job_revision_requested', entityType: 'pro_job', entityId: jobId,
    dedupeKey: `job_result:${jobId}:${v}`, title: b.accept ? 'Teslimin kabul edildi' : 'İşletme raporunda revizyon istedi', body: b.note.trim() });
  return { status, linkedNonconformity: j.ncr_id,
    reminder: j.ncr_id ? 'Uygunsuzluk kendiliğinden kapanmaz; teknik etkinlik kontrolü ve doğrulama ayrıca yapılır.' : null };
}

// ── Provider: open requests, quotes, jobs ──

/** Open requests in the provider's approved categories. The business name is hidden until a quote is accepted. */
export async function providerInbox(tx: Tx, p: Principal) {
  const pr = await ownProfile(tx, p);
  const requests = (await tx.query(
    `SELECT r.id, r.category_code, c.name AS category_name, r.title, r.description, r.city, r.created_at,
            CASE WHEN r.share_ncr_summary THEN json_build_object('title', n.title, 'riskLevel', n.risk_level, 'hazardType', n.hazard_type) END AS shared_ncr,
            (SELECT q.status FROM quotes q WHERE q.request_id = r.id AND q.provider_profile_id = $1 ORDER BY q.created_at DESC LIMIT 1) AS my_quote_status
       FROM service_requests r JOIN service_categories c ON c.code = r.category_code
       JOIN service_authorizations a ON a.category_code = r.category_code AND a.profile_id = $1 AND ${LIVE_AUTH('a', 2)}
       LEFT JOIN nonconformities n ON n.id = r.ncr_id AND n.company_id = r.company_id
      WHERE r.status = 'open' AND ${VISIBLE_TO_PROVIDER} ORDER BY r.created_at DESC`, [pr.id, today()])).rows;
  const authorizations = (await tx.query(
    `SELECT a.category_code, c.name, a.status, a.valid_until, (a.status = 'approved' AND NOT (${LIVE_AUTH('a', 2)})) AS expired
       FROM service_authorizations a JOIN service_categories c ON c.code = a.category_code WHERE a.profile_id = $1 ORDER BY c.name`, [pr.id, today()])).rows;
  const jobs = (await tx.query(
    `SELECT j.id, j.status, j.checked_in_at, j.report_submitted_at, j.accepted_at, j.business_note, j.cancel_reason, r.title, r.city, co.name AS company_name, s.name AS site_name
       FROM service_jobs j JOIN service_requests r ON r.id = j.request_id JOIN companies co ON co.id = j.company_id JOIN sites s ON s.id = r.site_id
      WHERE j.provider_profile_id = $1 ORDER BY j.created_at DESC`, [pr.id])).rows;
  return { requests, jobs, authorizations };
}

export async function submitQuote(tx: Tx, p: Principal, requestId: string, b: { scope: string; exclusions: string; priceNet: number; vatRate: number; materials: string; durationText: string; warrantyText: string; validUntil: string; deliverable: string }) {
  const pr = await ownProfile(tx, p);
  const r = (await tx.query(
    `SELECT r.*, NOT (${LIVE_AUTH('a', 3)}) AS auth_expired FROM service_requests r
       JOIN service_authorizations a ON a.category_code = r.category_code AND a.profile_id = $2 AND a.status = 'approved'
      WHERE r.id = $1`, [requestId, pr.id, today()])).rows[0];
  // Unauthorized categories, and requests sent to another provider, look like missing requests.
  if (r && r.invited_profile_id && r.invited_profile_id !== pr.id) throw notFound('Hizmet talebi');
  if (r && !r.invited_profile_id) {
    const inv = (await tx.query<{ profile_id: string }>(`SELECT profile_id FROM service_request_invites WHERE request_id = $1`, [requestId])).rows;
    if (inv.length && !inv.some(i => i.profile_id === pr.id)) throw notFound('Hizmet talebi');
  }
  if (!r) throw notFound('Hizmet talebi');
  if (r.auth_expired) throw new AppError(403, 'AUTHORIZATION_EXPIRED', 'Bu kategorideki hizmet onayının süresi doldu; yeni iş alamazsın. Güncel belgeyle yeniden onay iste.');
  if (r.status !== 'open') throw conflict('INVALID_STATE', 'Talep teklif almaya kapalı.');
  if (new Date(b.validUntil) <= new Date()) throw invalid('Geçerlilik tarihi gelecekte olmalı.');
  const q = await tx.query<{ id: string }>(
    `INSERT INTO quotes (request_id, company_id, provider_profile_id, scope, exclusions, price_net, vat_rate, materials, duration_text, warranty_text, valid_until, deliverable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [requestId, r.company_id, pr.id, b.scope, b.exclusions, b.priceNet, b.vatRate, b.materials, b.durationText, b.warrantyText, b.validUntil, b.deliverable]);
  await appendAudit(tx, { companyId: r.company_id, actorId: p.userId, eventType: 'service.quote_submitted', entityType: 'quote', entityId: q.rows[0]!.id, payload: { priceNet: b.priceNet, vatRate: b.vatRate } });
  await notify(tx, { companyId: r.company_id, siteId: r.site_id, userIds: await businessSide(tx, r.company_id, r.site_id, r.created_by),
    kind: 'quote_received', entityType: 'service_request', entityId: requestId, dedupeKey: `quote_received:${q.rows[0]!.id}`,
    title: 'Yeni teklif geldi', body: `${r.title} · ${pr.display_name}. Teklif kabul edilmedikçe iş başlamaz.` });
  return { id: q.rows[0]!.id };
}

async function ownJob(tx: Tx, p: Principal, jobId: string) {
  const pr = await ownProfile(tx, p);
  const j = (await tx.query(`SELECT * FROM service_jobs WHERE id = $1 AND provider_profile_id = $2 FOR UPDATE`, [jobId, pr.id])).rows[0];
  if (!j) throw notFound('Hizmet işi');
  return j;
}

/** Check-in with the code the business shows on site. It records presence only. */
export async function checkIn(tx: Tx, p: Principal, jobId: string, code: string) {
  const j = await ownJob(tx, p, jobId);
  if (j.status !== 'scheduled') throw conflict('INVALID_STATE', 'Giriş zaten yapılmış.');
  if (j.checkin_code !== code.trim()) throw new AppError(422, 'CHECKIN_CODE_INVALID', 'Giriş kodu işletmedeki kodla eşleşmiyor.');
  await tx.query(`UPDATE service_jobs SET status = 'checked_in', checked_in_at = now() WHERE id = $1`, [jobId]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.checked_in', entityType: 'service_job', entityId: jobId, payload: { note: 'Yalnızca yerinde bulunma kaydı; işin yapıldığını kanıtlamaz.' } });
}

export type ReportFile = { mime: string; sha256: string; sizeBytes: number };

/**
 * The provider's report. With a file, the report is also a vault document of the business (type "maintenance_report",
 * site of the request, equipment of the task when there is one): version N of ONE document per job, waiting for review
 * ("İnceleme bekliyor"). The business accepting the delivery does not review the file; those are separate steps.
 * Sending the same report again (same text, same file hash) returns the existing one and creates nothing.
 */
export async function submitReport(tx: Tx, p: Principal, jobId: string, report: string, file?: ReportFile | null) {
  const j = await ownJob(tx, p, jobId);
  const last = (await tx.query(`SELECT version, report, file_sha256, document_version_id FROM service_job_reports WHERE job_id = $1 ORDER BY version DESC LIMIT 1`, [jobId])).rows[0];
  const same = !!last && last.report === report && (last.file_sha256 ?? null) === (file?.sha256 ?? null);
  if (same && (j.status === 'report_submitted' || j.status === 'accepted')) {
    const ev = last.document_version_id ? (await tx.query(`SELECT e.id, v.document_id FROM document_versions v LEFT JOIN evidence e ON e.document_version_id = v.id WHERE v.id = $1 ORDER BY e.created_at DESC LIMIT 1`, [last.document_version_id])).rows[0] : null;
    return { ok: true, duplicate: true, version: last.version as number, evidenceId: (ev?.id ?? null) as string | null, documentId: (ev?.document_id ?? null) as string | null };
  }
  if (j.status !== 'checked_in' && j.status !== 'revision_requested') throw conflict('INVALID_STATE', j.status === 'scheduled' ? 'Rapor için önce işletmede giriş yapılmalı.' : 'Bu iş için şu an rapor beklenmiyor.');
  if (report.trim().length < 20) throw invalid('Raporda ne yapıldığını, ölçümleri ve kullanılan parçaları yaz.');
  if (same) throw invalid('Revizyonda rapor metni ya da dosya değişmeli; aynı rapor yeniden gönderilemez.');
  if (file) {
    if (!ALLOWED_MIME.includes(file.mime)) throw invalid(`Dosya türü kabul edilmiyor: ${file.mime}`);
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw invalid('sha256 64 karakterlik onaltılık özet olmalı.');
  }
  const r = (await tx.query(`SELECT id, site_id, title, created_by, task_id FROM service_requests WHERE id = $1`, [j.request_id])).rows[0];
  const version = ((last?.version as number | undefined) ?? 0) + 1;
  let docVersionId: string | null = null, documentId: string | null = null, evidenceId: string | null = null;
  if (file) {
    let d = (await tx.query(`SELECT id FROM documents WHERE service_job_id = $1 FOR UPDATE`, [jobId])).rows[0];
    if (!d) {
      const eq = r.task_id ? (await tx.query(`SELECT equipment_id FROM tasks WHERE id = $1`, [r.task_id])).rows[0]?.equipment_id ?? null : null;
      const prov = (await tx.query(`SELECT display_name FROM professional_profiles WHERE id = $1`, [j.provider_profile_id])).rows[0];
      d = (await tx.query(
        `INSERT INTO documents (company_id, site_id, equipment_id, doc_type, title, issuer, created_by, service_job_id) VALUES ($1,$2,$3,'maintenance_report',$4,$5,$6,$7) RETURNING id`,
        [j.company_id, r.site_id, eq, `Servis raporu · ${r.title}`, prov?.display_name ?? null, p.userId, jobId])).rows[0];
      await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'document.created', entityType: 'document', entityId: d.id,
        payload: { docType: 'maintenance_report', source: 'service_report', serviceJobId: jobId, siteId: r.site_id } });
    }
    documentId = d.id;
    const next = (await tx.query<{ n: number }>(`SELECT COALESCE(max(version), 0) + 1 AS n FROM document_versions WHERE document_id = $1`, [documentId])).rows[0]!.n;
    docVersionId = (await tx.query<{ id: string }>(`INSERT INTO document_versions (company_id, document_id, version, notes, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [j.company_id, documentId, next, `Uzman servis raporu, sürüm ${version}`, p.userId])).rows[0]!.id;
    evidenceId = (await tx.query<{ id: string }>(
      `INSERT INTO evidence (company_id, document_version_id, kind, status, mime, declared_sha256, size_bytes, created_by) VALUES ($1,$2,'document','pending_upload',$3,$4,$5,$6) RETURNING id`,
      [j.company_id, docVersionId, file.mime, file.sha256, file.sizeBytes, p.userId])).rows[0]!.id;
    await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'document.version_added', entityType: 'document', entityId: d.id as string,
      payload: { versionId: docVersionId, version: next, evidenceId, sha256: file.sha256, source: 'service_report', reportVersion: version } });
    // A newer revision: open tasks that relied on an earlier version of this report must be re-evaluated (reviewed and chosen again).
    // Closed tasks keep the version they were closed on (completion_basis).
    const stale = (await tx.query<{ id: string; task_id: string; version_number: number }>(
      `UPDATE task_report_evidence l SET status = 'stale', status_changed_at = clock_timestamp(),
              status_reason = $2
        FROM tasks t WHERE l.document_id = $1 AND l.status = 'active' AND l.completion_basis = false AND t.id = l.task_id AND t.status = 'open'
        RETURNING l.id, l.task_id, l.version_number`,
      [documentId, `Yeni rapor sürümü (${next}) geldi; seçilen sürüm artık güncel değil. Yeni sürüm incelenip yeniden seçilmeli.`])).rows;
    for (const l of stale) {
      await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'task.report_evidence_stale', entityType: 'task', entityId: l.task_id,
        payload: { linkId: l.id, documentId, previousVersion: l.version_number, newVersion: next } });
    }
  }
  await tx.query(`UPDATE service_jobs SET status = 'report_submitted', report = $2, report_submitted_at = now() WHERE id = $1`, [jobId, report]);
  await tx.query(`INSERT INTO service_job_reports (company_id, job_id, version, report, submitted_by, document_version_id, file_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [j.company_id, jobId, version, report, p.userId, docVersionId, file?.sha256 ?? null]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.report_submitted', entityType: 'service_job', entityId: jobId, payload: { length: report.length, version, documentId, withFile: !!file } });
  await notify(tx, { companyId: j.company_id, siteId: r.site_id, userIds: await businessSide(tx, j.company_id, r.site_id, r.created_by),
    kind: 'service_report_delivered', entityType: 'service_request', entityId: r.id, dedupeKey: `service_report_delivered:${jobId}:${version}`,
    title: version > 1 ? 'Revize hizmet raporu geldi: kabulün bekleniyor' : 'Hizmet raporu teslim edildi: kabulün bekleniyor',
    body: `${r.title} · raporu oku, kabul et ya da gerekçeyle revizyon iste.${file ? ' Rapor dosyası belge kasasında incelemeni bekliyor; teslimi kabul etmek dosyayı doğrulamaz.' : ''} Kabul, bağlı uygunsuzluğu ya da görevi kapatmaz.` });
  return { ok: true, duplicate: false, version, evidenceId, documentId };
}

/** The provider's file upload for a report they registered (hash and type are checked as for every evidence file). */
export async function reportEvidenceCompany(tx: Tx, p: Principal, jobId: string, evidenceId: string) {
  const j = await ownJob(tx, p, jobId);
  const ok = (await tx.query(`SELECT 1 FROM evidence e JOIN document_versions v ON v.id = e.document_version_id JOIN service_job_reports sr ON sr.document_version_id = v.id
     WHERE e.id = $1 AND sr.job_id = $2 AND e.created_by = $3`, [evidenceId, jobId, p.userId])).rowCount;
  if (!ok) throw notFound('Rapor dosyası');
  return j.company_id as string;
}

/**
 * Reports of the services linked to a task, with the vault document each one became. A task whose latest report
 * version is not verified yet stays open (`blocked`): accepting the delivery is not the same as checking the evidence.
 */
export async function taskServiceReports(tx: Tx, companyId: string, taskId: string) {
  const rows = (await tx.query(
    `SELECT sr.id AS request_id, sr.title AS request_title, sr.created_at AS request_created_at, n.id AS case_id, n.title AS case_title, n.detected_at AS case_detected_at, n.status AS case_status,
            (sr.task_id = $2 OR n.task_id = $2) AS direct, NOT EXISTS (SELECT 1 FROM nonconformities n2 WHERE n.id IS NOT NULL AND n2.company_id = n.company_id AND n2.site_id = n.site_id AND n2.equipment_id = n.equipment_id AND n2.id <> n.id
                        AND n2.detected_at >= now() - interval '90 days') AS sole, lk.id AS link_id, lk.ncr_id AS link_ncr_id, lk.title AS link_case_title, lk.basis AS link_basis, lk.linked_at, lk.linked_by_name,
            eq.name AS equipment_name, j.id AS job_id, j.status AS job_status, pp.display_name AS provider_name,
            d.id AS document_id, d.title AS document_title, d.site_id, s.name AS site_name, v.id AS version_id, v.version, v.review_status, v.review_notes, v.reviewed_at,
            v.uploaded_at, rb.display_name AS reviewed_by_name, e.status AS file_status, jr.version AS report_version,
            (v.version = (SELECT max(x.version) FROM document_versions x WHERE x.document_id = d.id)) AS is_latest
       FROM service_requests sr LEFT JOIN nonconformities n ON n.id = sr.ncr_id LEFT JOIN equipment eq ON eq.id = n.equipment_id
       JOIN service_jobs j ON j.request_id = sr.id JOIN professional_profiles pp ON pp.id = j.provider_profile_id
       LEFT JOIN LATERAL (SELECT scl.id, scl.ncr_id, tn.title, scl.basis, scl.linked_at, lu.display_name AS linked_by_name FROM service_case_links scl
                            JOIN nonconformities tn ON tn.id = scl.ncr_id JOIN tasks tk2 ON tk2.id = $2 JOIN users lu ON lu.id = scl.linked_by
                           WHERE scl.job_id = j.id AND tn.equipment_id = tk2.equipment_id AND tn.site_id = tk2.site_id ORDER BY scl.linked_at DESC LIMIT 1) lk ON true
       JOIN documents d ON d.service_job_id = j.id JOIN sites s ON s.id = d.site_id
       JOIN document_versions v ON v.document_id = d.id LEFT JOIN users rb ON rb.id = v.reviewed_by
       LEFT JOIN service_job_reports jr ON jr.document_version_id = v.id
       LEFT JOIN LATERAL (SELECT x.status FROM evidence x WHERE x.document_version_id = v.id ORDER BY x.created_at DESC LIMIT 1) e ON true
      WHERE sr.company_id = $1 AND sr.status <> 'cancelled' AND j.status <> 'cancelled'
        AND (sr.task_id = $2 OR n.task_id = $2
             -- A follow-up task of the same case: same branch, same equipment, case detected within 90 days, task still open.
             OR (n.id IS NOT NULL AND n.equipment_id IS NOT NULL AND n.site_id = sr.site_id AND n.detected_at >= now() - interval '90 days'
                 AND EXISTS (SELECT 1 FROM tasks tk WHERE tk.id = $2 AND tk.company_id = sr.company_id AND tk.site_id = n.site_id
                                AND tk.equipment_id = n.equipment_id AND tk.status = 'open' AND tk.id IS DISTINCT FROM n.task_id)))
      ORDER BY sr.created_at DESC, v.version DESC`, [companyId, taskId])).rows;
  const byJob = new Map<string, any>();
  for (const r of rows) {
    const g = byJob.get(r.job_id) ?? { requestId: r.request_id, requestTitle: r.request_title, requestCreatedAt: r.request_created_at, jobId: r.job_id,
      // direct: the request was opened from this task or the task is the case's own task. equipment: only the same branch and equipment (another case's service).
      relation: (r.direct ? 'direct' : r.sole ? 'sole' : r.link_id ? 'linked' : 'equipment') as 'direct' | 'sole' | 'linked' | 'equipment', equipmentName: r.equipment_name as string | null,
      linkId: r.link_id as string | null, linkedCaseId: r.link_ncr_id as string | null, linkedCaseTitle: r.link_case_title as string | null, linkBasis: r.link_basis as string | null, linkedAt: r.linked_at, linkedBy: r.linked_by_name as string | null, caseId: r.case_id as string | null, caseTitle: r.case_title as string | null, caseDetectedAt: r.case_detected_at, caseStatus: r.case_status as string | null, jobStatus: r.job_status, providerName: r.provider_name, documentId: r.document_id,
      documentTitle: r.document_title, siteId: r.site_id, siteName: r.site_name, versions: [] as any[] };
    g.versions.push({ versionId: r.version_id, version: r.version, reportVersion: r.report_version, reviewStatus: r.review_status, reviewNotes: r.review_notes, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by_name,
      uploadedAt: r.uploaded_at, fileStatus: r.file_status, isLatest: r.is_latest });
    byJob.set(r.job_id, g);
  }
  const reports = [...byJob.values()].map(g => ({ ...g, latest: g.versions.find((v: any) => v.isLatest) ?? g.versions[0] }));
  // Only a report that belongs to this task or its case can hold it open; another case's unreviewed report is not this task's evidence.
  const unverified = reports.filter(g => g.relation === 'direct' && g.latest.reviewStatus !== 'verified');
  return { reports, blocked: unverified.length > 0,
    reason: unverified.length ? `Servis raporu (${unverified[0].requestTitle}) ${unverified[0].latest.reviewStatus === 'rejected' ? 'kabul edilmedi, yeni sürüm bekleniyor' : 'incelenip doğrulanmadı'}; teslimin kabulü görevi kapatmaz.` : null };
}

/** On the business side: whoever opened the request and the people who manage that site. */
async function businessSide(tx: Tx, companyId: string, siteId: string, requestedBy: string) {
  return [requestedBy, ...(await siteManagers(tx, companyId, siteId))];
}

/**
 * Review of a job that actually happened: the provider delivered a report and the business
 * accepted it. One review per job. Whether it may appear on the provider's profile (without the
 * business name) is the business's choice; by default it does not.
 */
export async function reviewJob(tx: Tx, p: Principal, companyId: string, jobId: string,
  b: { quality: number; timeliness: number; communication: number; comment: string | null; showOnProfile: boolean }) {
  const j = (await tx.query(`SELECT j.*, r.site_id FROM service_jobs j JOIN service_requests r ON r.id = j.request_id WHERE j.id = $1 AND j.company_id = $2 FOR UPDATE OF j`,
    [jobId, companyId])).rows[0];
  if (!j || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Hizmet işi');
  if (j.status !== 'accepted') throw new AppError(422, 'JOB_NOT_ACCEPTED', 'Değerlendirme yalnızca raporu teslim edilmiş ve işletmece kabul edilmiş iş için yapılır.');
  if ((await tx.query(`SELECT 1 FROM service_reviews WHERE job_id = $1`, [jobId])).rowCount) throw conflict('ALREADY_REVIEWED', 'Bu iş zaten değerlendirildi.');
  const comment = b.comment?.trim() || null;
  if (comment && comment.length > 1000) throw invalid('Yorum en fazla 1000 karakter olabilir.');
  const r = (await tx.query<{ id: string }>(
    `INSERT INTO service_reviews (company_id, job_id, provider_profile_id, quality, timeliness, communication, comment, show_on_profile, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [companyId, jobId, j.provider_profile_id, b.quality, b.timeliness, b.communication, comment, b.showOnProfile, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'service.reviewed', entityType: 'service_job', entityId: jobId,
    payload: { reviewId: r.id, quality: b.quality, timeliness: b.timeliness, communication: b.communication, showOnProfile: b.showOnProfile } });
  return { id: r.id };
}

/** The report files of one request as vault documents (for the request screen): where they live and their review state. */
async function requestReportDocs(tx: Tx, companyId: string, requestId: string) {
  return (await tx.query(
    `SELECT d.id AS document_id, d.title, s.name AS site_name, v.id AS version_id, v.version, v.review_status, v.review_notes, v.uploaded_at, jr.version AS report_version,
            (v.version = (SELECT max(x.version) FROM document_versions x WHERE x.document_id = d.id)) AS is_latest, sr.task_id, tt.title AS task_title
       FROM service_requests sr JOIN service_jobs j ON j.request_id = sr.id JOIN documents d ON d.service_job_id = j.id JOIN sites s ON s.id = d.site_id
       JOIN document_versions v ON v.document_id = d.id LEFT JOIN service_job_reports jr ON jr.document_version_id = v.id
       LEFT JOIN tasks tk ON tk.id = sr.task_id LEFT JOIN task_templates tt ON tt.id = tk.template_id
      WHERE sr.id = $1 AND sr.company_id = $2 ORDER BY v.version DESC`, [requestId, companyId])).rows;
}
