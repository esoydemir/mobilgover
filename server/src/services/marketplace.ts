import { randomInt } from 'node:crypto';
import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';

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

/**
 * SQL condition for an approval that can take new work today ($n = today's date):
 * approved, not past its end date, and every document it rests on still verified and in date.
 */
const LIVE_AUTH = (alias: string, n: number) => `${alias}.status = 'approved' AND ${alias}.valid_until >= $${n}::date
  AND NOT EXISTS (SELECT 1 FROM professional_verifications bv WHERE bv.id = ANY(${alias}.basis_verification_ids)
                   AND (bv.status <> 'verified' OR bv.valid_until < $${n}::date))`;

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
  return {
    profile: pr,
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
  return { verifications, authorizations };
}

// ── Business: requests, quotes, jobs ──

/** Providers authorized for a category. No paid ranking exists; order is by verified credentials, then name. */
export async function providersFor(tx: Tx, categoryCode: string) {
  return (await tx.query(
    `SELECT pp.id, pp.display_name, pp.headline, pp.city, pp.district,
            (SELECT count(*)::int FROM professional_verifications v WHERE v.profile_id = pp.id AND v.status = 'verified' AND v.kind = 'credential') AS verified_credentials
       FROM professional_profiles pp JOIN service_authorizations a ON a.profile_id = pp.id
      WHERE a.category_code = $1 AND ${LIVE_AUTH('a', 2)} AND pp.status = 'active'
      ORDER BY verified_credentials DESC, pp.display_name`, [categoryCode, today()])).rows
    .map(r => ({ ...r, sponsored: false }));
}

export async function createRequest(tx: Tx, p: Principal, companyId: string, b: { siteId: string; categoryCode: string; title: string; description: string; ncrId?: string | null; city: string; shareNcrSummary?: boolean }) {
  if (!can(p, 'service.request', { companyId, siteId: b.siteId }).ok) throw forbidden();
  if (!(await tx.query(`SELECT 1 FROM service_categories WHERE code = $1`, [b.categoryCode])).rowCount) throw notFound('Hizmet kategorisi');
  if (b.ncrId && !(await tx.query(`SELECT 1 FROM nonconformities WHERE id = $1 AND company_id = $2`, [b.ncrId, companyId])).rowCount) throw notFound('Uygunsuzluk');
  if (b.shareNcrSummary && !b.ncrId) throw invalid('Paylaşmak için bir uygunsuzluk seç.');
  const r = await tx.query<{ id: string }>(
    `INSERT INTO service_requests (company_id, site_id, category_code, title, description, ncr_id, city, created_by, share_ncr_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [companyId, b.siteId, b.categoryCode, b.title, b.description, b.ncrId ?? null, b.city, p.userId, !!b.shareNcrSummary]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'service.requested', entityType: 'service_request', entityId: r.rows[0]!.id,
    payload: { category: b.categoryCode, ncrId: b.ncrId ?? null, sharedWithProviders: sharedFields(!!b.shareNcrSummary) } });
  return { id: r.rows[0]!.id };
}

/** Exactly what a provider can see of a request; recorded with the request so the business has a record of what it shared. */
function sharedFields(shareNcr: boolean) {
  return ['title', 'description', 'city', 'category', ...(shareNcr ? ['ncr.title', 'ncr.risk_level', 'ncr.hazard_type'] : []), 'after_award:company_name', 'after_award:site_name'];
}

export async function listRequests(tx: Tx, p: Principal, companyId: string) {
  if (!can(p, 'service.request', { companyId, siteId: null }).ok && !p.memberships.some(m => m.companyId === companyId && m.role === 'site_manager')) throw forbidden();
  return (await tx.query(
    `SELECT r.*, c.name AS category_name, (SELECT count(*)::int FROM quotes q WHERE q.request_id = r.id AND q.status = 'submitted') AS open_quotes,
            j.id AS job_id, j.status AS job_status
       FROM service_requests r JOIN service_categories c ON c.code = r.category_code LEFT JOIN service_jobs j ON j.request_id = r.id
      WHERE r.company_id = $1 ORDER BY r.created_at DESC`, [companyId])).rows;
}

export async function requestDetail(tx: Tx, p: Principal, companyId: string, id: string) {
  const r = (await tx.query(`SELECT r.*, c.name AS category_name FROM service_requests r JOIN service_categories c ON c.code = r.category_code WHERE r.id = $1 AND r.company_id = $2`, [id, companyId])).rows[0];
  if (!r || !can(p, 'service.request', { companyId, siteId: r.site_id }).ok) throw notFound('Hizmet talebi');
  const quotes = (await tx.query(
    `SELECT q.*, pp.display_name, (q.price_net * (1 + q.vat_rate / 100))::numeric(12,2) AS price_gross, (q.valid_until < now()) AS expired
       FROM quotes q JOIN professional_profiles pp ON pp.id = q.provider_profile_id WHERE q.request_id = $1 ORDER BY q.created_at`, [id])).rows;
  const job = (await tx.query(`SELECT * FROM service_jobs WHERE request_id = $1`, [id])).rows[0] ?? null;
  return { request: r, quotes, job };
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
  return { jobId: job.id, checkinCode: code, payment: 'Ödeme bu aşamada uygulama dışında yapılır; GoverHub ödeme almaz.' };
}

/** Business accepts delivery after reading the report. Check-in alone is never enough. */
export async function acceptJob(tx: Tx, p: Principal, companyId: string, jobId: string, b: { accept: boolean; note: string }) {
  const j = (await tx.query(`SELECT j.*, r.site_id, r.ncr_id FROM service_jobs j JOIN service_requests r ON r.id = j.request_id WHERE j.id = $1 AND j.company_id = $2 FOR UPDATE OF j`, [jobId, companyId])).rows[0];
  if (!j || !can(p, 'service.request', { companyId, siteId: j.site_id }).ok) throw notFound('Hizmet işi');
  if (j.status !== 'report_submitted') throw conflict('REPORT_MISSING', 'Teslim kabulü için önce uzmanın hizmet raporu gelmeli.');
  if (b.note.trim().length < 5) throw invalid('Kabul veya itiraz için kısa bir not yaz.');
  await tx.query(`UPDATE service_jobs SET status = $2, accepted_by = $3, accepted_at = now(), business_note = $4 WHERE id = $1`,
    [jobId, b.accept ? 'accepted' : 'disputed', p.userId, b.note]);
  if (b.accept) await tx.query(`UPDATE service_requests SET status = 'completed' WHERE id = $1`, [j.request_id]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.accept ? 'service.accepted' : 'service.disputed', entityType: 'service_job', entityId: jobId,
    payload: { ncrId: j.ncr_id, note: b.note } });
  return { status: b.accept ? 'accepted' : 'disputed', linkedNonconformity: j.ncr_id,
    reminder: j.ncr_id ? 'Uygunsuzluk kendiliğinden kapanmaz; düzeltme ve doğrulama adımlarını tamamla.' : null };
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
      WHERE r.status = 'open' ORDER BY r.created_at DESC`, [pr.id, today()])).rows;
  const authorizations = (await tx.query(
    `SELECT a.category_code, c.name, a.status, a.valid_until, (a.status = 'approved' AND NOT (${LIVE_AUTH('a', 2)})) AS expired
       FROM service_authorizations a JOIN service_categories c ON c.code = a.category_code WHERE a.profile_id = $1 ORDER BY c.name`, [pr.id, today()])).rows;
  const jobs = (await tx.query(
    `SELECT j.id, j.status, j.checked_in_at, j.report_submitted_at, j.accepted_at, j.business_note, r.title, r.city, co.name AS company_name, s.name AS site_name
       FROM service_jobs j JOIN service_requests r ON r.id = j.request_id JOIN companies co ON co.id = j.company_id JOIN sites s ON s.id = r.site_id
      WHERE j.provider_profile_id = $1 ORDER BY j.created_at DESC`, [pr.id])).rows;
  return { requests, jobs, authorizations };
}

export async function submitQuote(tx: Tx, p: Principal, requestId: string, b: { scope: string; exclusions: string; priceNet: number; vatRate: number; materials: string; durationText: string; warrantyText: string; validUntil: string }) {
  const pr = await ownProfile(tx, p);
  const r = (await tx.query(
    `SELECT r.*, NOT (${LIVE_AUTH('a', 3)}) AS auth_expired FROM service_requests r
       JOIN service_authorizations a ON a.category_code = r.category_code AND a.profile_id = $2 AND a.status = 'approved'
      WHERE r.id = $1`, [requestId, pr.id, today()])).rows[0];
  // Unauthorized categories look like missing requests.
  if (!r) throw notFound('Hizmet talebi');
  if (r.auth_expired) throw new AppError(403, 'AUTHORIZATION_EXPIRED', 'Bu kategorideki hizmet onayının süresi doldu; yeni iş alamazsın. Güncel belgeyle yeniden onay iste.');
  if (r.status !== 'open') throw conflict('INVALID_STATE', 'Talep teklif almaya kapalı.');
  if (new Date(b.validUntil) <= new Date()) throw invalid('Geçerlilik tarihi gelecekte olmalı.');
  const q = await tx.query<{ id: string }>(
    `INSERT INTO quotes (request_id, company_id, provider_profile_id, scope, exclusions, price_net, vat_rate, materials, duration_text, warranty_text, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [requestId, r.company_id, pr.id, b.scope, b.exclusions, b.priceNet, b.vatRate, b.materials, b.durationText, b.warrantyText, b.validUntil]);
  await appendAudit(tx, { companyId: r.company_id, actorId: p.userId, eventType: 'service.quote_submitted', entityType: 'quote', entityId: q.rows[0]!.id, payload: { priceNet: b.priceNet, vatRate: b.vatRate } });
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

export async function submitReport(tx: Tx, p: Principal, jobId: string, report: string) {
  const j = await ownJob(tx, p, jobId);
  if (j.status !== 'checked_in') throw conflict('INVALID_STATE', 'Rapor için önce işletmede giriş yapılmalı.');
  if (report.trim().length < 20) throw invalid('Raporda ne yapıldığını, ölçümleri ve kullanılan parçaları yaz.');
  await tx.query(`UPDATE service_jobs SET status = 'report_submitted', report = $2, report_submitted_at = now() WHERE id = $1`, [jobId, report]);
  await appendAudit(tx, { companyId: j.company_id, actorId: p.userId, eventType: 'service.report_submitted', entityType: 'service_job', entityId: jobId, payload: { length: report.length } });
}
