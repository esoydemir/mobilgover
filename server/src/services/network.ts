import type { Db, Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { contentMatchesMime, sha256Hex, type EvidenceStore } from '../storage/local';
import { suggestCategories } from '../domain/intent';
import { createHash } from 'node:crypto';
import { appendAudit } from './audit';

/**
 * Professional network, first version.
 *  - A network profile is the person's own statement. It is not a service approval: quotes still
 *    need an approved category (service_authorizations), checked by the server.
 *  - Declared experience, checked credentials and platform-verified service history are separate.
 *  - E-mail, phone and document files are not shown to network users unless the person opts in
 *    (files: never).
 *  - Posts and comments are user content, open to signed-in network users; drafts only to their
 *    author. Nothing marks a post as legislation or approved content.
 *  - Business records are never shared automatically. A case share needs an authorised person's
 *    permission, a preview of exactly the shared fields, and a personal/commercial data check.
 *  - Reports go to a moderation queue; decisions need a reason and are recorded.
 */
export const NETWORK_NOTE = 'Mesleki ağ profili kişinin kendi beyanıdır; hizmet verme onayı değildir. Teklif için kategori bazlı onay gerekir.';
export const POST_NOTE = 'Kullanıcı paylaşımı · doğrulanmış mevzuat ya da platform onaylı içerik değildir.';
export const RANKING_NOTE = 'Sıralama ölçütleri: aramayla eşleşme (ad, unvan, uzmanlık), seçili kategoride geçerli hizmet onayı, platformda doğrulanmış hizmet sayısı, bölge eşleşmesi. Takipçi sayısı yalnız eşitlikte kullanılır. Ücretli öne çıkarma yoktur.';

export const SPECIALTIES = ['soğutma', 'gıda güvenliği', 'hijyen', 'LPG / gaz', 'kalibrasyon', 'iş güvenliği', 'HACCP', 'temizlik', 'elektrik', 'eğitim'];

async function myProfile(tx: Tx, p: Principal, required = true) {
  const r = (await tx.query(`SELECT * FROM network_profiles WHERE user_id = $1`, [p.userId])).rows[0];
  if (!r && required) throw new AppError(409, 'NO_NETWORK_PROFILE', 'Mesleki ağı kullanmak için önce profilini oluştur.');
  if (r && r.status !== 'active' && required) throw forbidden(`Profilin askıya alındı: ${r.suspended_reason ?? ''}`);
  return r;
}

/** Users either side of a block (they do not see each other). */
async function blockedWith(tx: Tx, userId: string): Promise<Set<string>> {
  const r = await tx.query<{ u: string }>(`SELECT blocked_id AS u FROM network_blocks WHERE blocker_id = $1 UNION SELECT blocker_id FROM network_blocks WHERE blocked_id = $1`, [userId]);
  return new Set(r.rows.map(x => x.u));
}

// ── Profile ──

export type ProfileInput = { displayName: string; title: string; bio: string; city: string; district: string | null; specialties: string[]; categories: string[];
  phone: string | null; showEmail: boolean; showPhone: boolean };

export async function saveProfile(tx: Tx, p: Principal, b: ProfileInput) {
  if (b.displayName.trim().length < 2) throw invalid('Adını yaz.');
  if (b.city.trim().length < 2) throw invalid('Bölge (il) seç.');
  if (b.bio.length > 1500 || b.title.length > 120) throw invalid('Tanıtım ya da unvan çok uzun.');
  const cats = [...new Set(b.categories)].slice(0, 10);
  if (cats.length) {
    const known = (await tx.query(`SELECT code FROM service_categories WHERE code = ANY($1)`, [cats])).rows.length;
    if (known !== cats.length) throw invalid('Bilinmeyen hizmet kategorisi.');
  }
  const specs = [...new Set(b.specialties.map(s => s.trim()).filter(Boolean))].slice(0, 12);
  if (b.phone && !/^[+\d][\d\s-]{6,20}$/.test(b.phone.trim())) throw invalid('Telefon numarası geçersiz.');
  await tx.query(`INSERT INTO network_profiles (user_id, display_name, title, bio, city, district, specialties, categories, phone, show_email, show_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id) DO UPDATE SET display_name = $2, title = $3, bio = $4, city = $5, district = $6, specialties = $7, categories = $8, phone = $9,
       show_email = $10, show_phone = $11, updated_at = clock_timestamp()`,
    [p.userId, b.displayName.trim(), b.title.trim(), b.bio.trim(), b.city.trim(), b.district?.trim() || null, specs, cats, b.phone?.trim() || null, b.showEmail, b.showPhone]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'network.profile_saved', entityType: 'network_profile', entityId: p.userId,
    payload: { city: b.city.trim(), specialties: specs, categories: cats, showEmail: b.showEmail, showPhone: b.showPhone } });
  return { userId: p.userId };
}

export async function addExperience(tx: Tx, p: Principal, b: { roleTitle: string; organization: string; startYear: number; endYear: number | null; description: string }) {
  await myProfile(tx, p);
  if (b.roleTitle.trim().length < 2) throw invalid('Görev/unvan yaz.');
  const now = new Date().getFullYear();
  if (b.startYear > now || (b.endYear && (b.endYear < b.startYear || b.endYear > now))) throw invalid('Yıllar geçersiz.');
  if ((await tx.query(`SELECT count(*)::int AS n FROM network_experience WHERE user_id = $1`, [p.userId])).rows[0].n >= 20) throw invalid('En fazla 20 deneyim.');
  const r = (await tx.query<{ id: string }>(`INSERT INTO network_experience (user_id, role_title, organization, start_year, end_year, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.userId, b.roleTitle.trim(), b.organization.trim(), b.startYear, b.endYear, b.description.trim()])).rows[0]!;
  return { id: r.id };
}
export async function removeExperience(tx: Tx, p: Principal, id: string) {
  const r = await tx.query(`DELETE FROM network_experience WHERE id = $1 AND user_id = $2`, [id, p.userId]);
  if (!r.rowCount) throw notFound('Deneyim');
}

const PHOTO_MAX = 2 * 1024 * 1024;
export async function setPhoto(db: Db, store: EvidenceStore, p: Principal, mime: string, bytes: Buffer) {
  if (!['image/jpeg', 'image/png'].includes(mime)) throw invalid('Profil fotoğrafı JPEG ya da PNG olmalı.');
  if (bytes.length > PHOTO_MAX) throw invalid('Profil fotoğrafı en fazla 2 MB olabilir.');
  if (!contentMatchesMime(mime, bytes)) throw invalid('Dosya içeriği bildirilen türle uyuşmuyor.');
  const key = `network/${p.userId}/${sha256Hex(bytes)}`;
  try { await store.put(key, bytes); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await db.system(async tx => {
    await myProfile(tx, p);
    await tx.query(`UPDATE network_profiles SET photo_key = $2, photo_mime = $3, updated_at = clock_timestamp() WHERE user_id = $1`, [p.userId, key, mime]);
  });
  return { ok: true };
}
export async function getPhoto(db: Db, store: EvidenceStore, p: Principal, userId: string) {
  const row = await db.system(async tx => {
    await myProfile(tx, p);
    if ((await blockedWith(tx, p.userId)).has(userId)) throw notFound('Fotoğraf');
    return (await tx.query(`SELECT photo_key, photo_mime FROM network_profiles WHERE user_id = $1 AND status = 'active'`, [userId])).rows[0];
  });
  if (!row?.photo_key) throw notFound('Fotoğraf');
  const bytes = await store.get(row.photo_key);
  if (!bytes) throw notFound('Fotoğraf');
  return { mime: row.photo_mime as string, bytes };
}

const today = () => new Date().toISOString().slice(0, 10);
/** What the platform checked, kept apart from what the person declares. */
async function checkedInfo(tx: Tx, userId: string) {
  const pro = (await tx.query(`SELECT id, status FROM professional_profiles WHERE user_id = $1`, [userId])).rows[0];
  if (!pro) return { proProfileId: null, identityVerified: false, credentials: [], approvals: [], history: { count: 0, items: [] as any[] } };
  const ver = (await tx.query(`SELECT kind, credential_type, issuer, check_method, checked_at, valid_until, status FROM professional_verifications WHERE profile_id = $1 AND status = 'verified'`, [pro.id])).rows;
  const approvals = (await tx.query(`SELECT a.category_code, c.name, a.valid_until FROM service_authorizations a JOIN service_categories c ON c.code = a.category_code
     WHERE a.profile_id = $1 AND a.status = 'approved' AND a.valid_until >= $2::date
       AND NOT EXISTS (SELECT 1 FROM professional_verifications bv WHERE bv.id = ANY(a.basis_verification_ids) AND (bv.status <> 'verified' OR bv.valid_until < $2::date))
     ORDER BY c.name`, [pro.id, today()])).rows;
  const history = (await tx.query(`SELECT to_char(j.accepted_at AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM') AS month, c.name AS category_name, r.city, sr.quality, sr.timeliness, sr.communication
     FROM service_reviews sr JOIN service_jobs j ON j.id = sr.job_id JOIN service_requests r ON r.id = j.request_id JOIN service_categories c ON c.code = r.category_code
    WHERE sr.provider_profile_id = $1 AND sr.show_on_profile AND j.status = 'accepted' ORDER BY j.accepted_at DESC LIMIT 20`, [pro.id])).rows;
  return {
    proProfileId: pro.status === 'active' ? pro.id as string : null,
    identityVerified: ver.some(v => v.kind === 'identity'),
    // Which documents were checked and how; the files themselves are never shown on the network.
    credentials: ver.filter(v => v.kind !== 'identity').map(v => ({ kind: v.kind, type: v.credential_type, issuer: v.issuer, method: v.check_method, checkedAt: v.checked_at,
      validUntil: v.valid_until, expired: !!v.valid_until && v.valid_until < today() })),
    approvals, history: { count: history.length, items: history },
  };
}

export async function viewProfile(tx: Tx, p: Principal, userId: string) {
  const me = await myProfile(tx, p, userId !== p.userId);
  const own = userId === p.userId;
  if (!own && (await blockedWith(tx, p.userId)).has(userId)) throw notFound('Profil');
  const pr = (await tx.query(`SELECT n.*, u.email FROM network_profiles n JOIN users u ON u.id = n.user_id WHERE n.user_id = $1`, [userId])).rows[0];
  if (!pr || (pr.status !== 'active' && !own)) throw notFound('Profil');
  const exp = (await tx.query(`SELECT id, role_title, organization, start_year, end_year, description FROM network_experience WHERE user_id = $1 ORDER BY start_year DESC`, [userId])).rows;
  const counts = (await tx.query(`SELECT (SELECT count(*)::int FROM network_follows WHERE followee_id = $1) AS followers, (SELECT count(*)::int FROM network_follows WHERE follower_id = $1) AS following,
     (SELECT count(*)::int FROM network_posts WHERE author_id = $1 AND status = 'published' AND hidden_at IS NULL) AS posts`, [userId])).rows[0];
  const cats = pr.categories.length ? (await tx.query(`SELECT code, name FROM service_categories WHERE code = ANY($1)`, [pr.categories])).rows : [];
  const checked = await checkedInfo(tx, userId);
  return {
    userId, own, status: pr.status, note: NETWORK_NOTE, hasPhoto: !!pr.photo_key,
    declared: { displayName: pr.display_name, title: pr.title, bio: pr.bio, city: pr.city, district: pr.district, specialties: pr.specialties,
      categories: cats.map(c => ({ code: c.code, name: c.name, approved: checked.approvals.some((a: any) => a.category_code === c.code) })), experience: exp },
    checked: { identityVerified: checked.identityVerified, credentials: checked.credentials },
    approvals: checked.approvals,
    verifiedHistory: checked.history,
    contact: { email: own || pr.show_email ? pr.email : null, phone: own || pr.show_phone ? pr.phone : null, showEmail: pr.show_email, showPhone: pr.show_phone },
    counts, following: me && !own ? !!(await tx.query(`SELECT 1 FROM network_follows WHERE follower_id = $1 AND followee_id = $2`, [p.userId, userId])).rowCount : false,
    blockedByMe: me && !own ? !!(await tx.query(`SELECT 1 FROM network_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [p.userId, userId])).rowCount : false,
    proProfileId: checked.proProfileId,
    // A business user may start a request from here; only approved categories are offered.
    requestableCategories: checked.proProfileId ? checked.approvals.map((a: any) => ({ code: a.category_code, name: a.name })) : [],
  };
}

// ── Search ──

export async function search(tx: Tx, p: Principal, q: { text?: string; specialty?: string; category?: string; city?: string; approvedOnly?: boolean }) {
  await myProfile(tx, p);
  const names = Object.fromEntries((await tx.query(`SELECT code, name FROM service_categories`)).rows.map(r => [r.code, r.name]));
  // Plain words ("dolabım soğutmuyor") → a suggested category. Only a suggestion; shown with the words it rests on.
  const suggested = q.text ? suggestCategories(q.text, names) : [];
  const run = async (f: typeof q) => searchOnce(tx, p, f, suggested);
  const results = await run(q);
  // Nothing found: which filter could go, and how many would then show.
  const relaxations = [];
  if (!results.length) {
    const tries: [keyof typeof q, string][] = [['approvedOnly', '"Yalnız onaylılar"ı kaldır'], ['city', 'Bölge filtresini kaldır'], ['specialty', 'Uzmanlık filtresini kaldır'],
      ['category', 'Kategori filtresini kaldır'], ['text', 'Arama metnini kaldır']];
    for (const [k, label] of tries) {
      if (!q[k]) continue;
      const n = (await run({ ...q, [k]: undefined })).length;
      if (n) relaxations.push({ filter: k, label, count: n });
    }
  }
  const questions = q.text && suggested.length && !q.city ? ['Hangi ilde? (bölge seçersen yakındaki uzmanlar öne çıkar)'] : [];
  if (q.text && suggested.length > 1 && !q.category) questions.push('Hangi hizmet türü? Birden fazla tür eşleşti.');
  return { rankingNote: RANKING_NOTE, suggestedCategories: suggested, questions, relaxations, results: results.slice(0, 50) };
}

async function searchOnce(tx: Tx, p: Principal, q: { text?: string; specialty?: string; category?: string; city?: string; approvedOnly?: boolean },
  suggested: { code: string; name: string }[]) {
  const blocked = await blockedWith(tx, p.userId);
  const rows = (await tx.query(`SELECT n.user_id, n.display_name, n.title, n.city, n.district, n.specialties, n.categories, (n.photo_key IS NOT NULL) AS has_photo,
       pp.id AS pro_id, (SELECT count(*)::int FROM network_follows f WHERE f.followee_id = n.user_id) AS followers,
       (SELECT count(*)::int FROM network_experience x WHERE x.user_id = n.user_id) AS experience_count,
       EXISTS (SELECT 1 FROM professional_verifications v WHERE v.profile_id = pp.id AND v.kind = 'identity' AND v.status = 'verified') AS identity_verified,
       (SELECT count(*)::int FROM professional_verifications v WHERE v.profile_id = pp.id AND v.kind <> 'identity' AND v.status = 'verified' AND (v.valid_until IS NULL OR v.valid_until >= CURRENT_DATE)) AS checked_credentials
     FROM network_profiles n LEFT JOIN professional_profiles pp ON pp.user_id = n.user_id AND pp.status = 'active'
    WHERE n.status = 'active' AND n.user_id <> $1
      AND ($2::text IS NULL OR $2 = ANY(n.specialties))
      AND ($3::text IS NULL OR lower(n.city) = lower($3))`, [p.userId, q.specialty || null, q.city || null])).rows.filter(r => !blocked.has(r.user_id));
  const proIds = rows.map(r => r.pro_id).filter(Boolean);
  const approvals = proIds.length ? (await tx.query(`SELECT a.profile_id, a.category_code FROM service_authorizations a WHERE a.profile_id = ANY($1) AND a.status = 'approved' AND a.valid_until >= $2::date
       AND NOT EXISTS (SELECT 1 FROM professional_verifications bv WHERE bv.id = ANY(a.basis_verification_ids) AND (bv.status <> 'verified' OR bv.valid_until < $2::date))`, [proIds, today()])).rows : [];
  // Completed jobs the business allowed to show on the profile (no business names).
  const history = proIds.length ? (await tx.query(`SELECT sr.provider_profile_id AS id, count(*)::int AS n FROM service_reviews sr JOIN service_jobs j ON j.id = sr.job_id
       WHERE sr.provider_profile_id = ANY($1) AND sr.show_on_profile AND j.status = 'accepted' GROUP BY 1`, [proIds])).rows : [];
  const text = (q.text ?? '').trim().toLocaleLowerCase('tr');
  const intentCats = suggested.map(x => x.code);
  return rows.map(r => {
    const approved = approvals.filter(a => a.profile_id === r.pro_id).map(a => a.category_code as string);
    const verifiedJobs = history.find(h => h.id === r.pro_id)?.n ?? 0;
    const nameHit = !!text && [r.display_name, r.title, ...r.specialties].some((x: string) => x.toLocaleLowerCase('tr').includes(text));
    // The text matched a profile directly, or describes a problem that points to a category this person works in.
    const intentHit = !nameHit && intentCats.some(c => approved.includes(c) || r.categories.includes(c));
    const textHit = !text || nameHit || intentHit;
    const reasons: string[] = [];
    let score = 0;
    if (nameHit) { score += 40; reasons.push('aramayla eşleşiyor'); }
    if (intentHit) {
      const c = intentCats.find(x => approved.includes(x)) ?? intentCats.find(x => r.categories.includes(x))!;
      score += approved.includes(c) ? 35 : 10; reasons.push(`yazdığın sorun "${suggested.find(x => x.code === c)!.name}" ile eşleşti${approved.includes(c) ? ' (onaylı)' : ' (yalnız beyan)'}`);
    }
    if (q.category && approved.includes(q.category)) { score += 30; reasons.push('bu kategoride geçerli hizmet onayı'); }
    else if (q.category && r.categories.includes(q.category)) { score += 5; reasons.push('bu kategoride çalıştığını beyan ediyor (onay yok)'); }
    if (verifiedJobs) { score += Math.min(20, verifiedJobs * 5); reasons.push(`${verifiedJobs} doğrulanmış hizmet`); }
    if (q.city && r.city.toLocaleLowerCase('tr') === q.city.toLocaleLowerCase('tr')) { score += 5; reasons.push('bölge eşleşiyor'); }
    return { userId: r.user_id, displayName: r.display_name, title: r.title, city: r.city, district: r.district, specialties: r.specialties, hasPhoto: r.has_photo,
      approvedCategories: approved, declaredCategories: r.categories.filter((c: string) => !approved.includes(c)), verifiedJobs, followers: r.followers, score, reasons, textHit,
      identityVerified: !!r.identity_verified, checkedCredentials: r.checked_credentials ?? 0, declaredExperience: r.experience_count,
      categoryMatch: !q.category || r.categories.includes(q.category) || approved.includes(q.category) };
  }).filter(r => r.textHit && r.categoryMatch && (!q.approvedOnly || (q.category ? r.approvedCategories.includes(q.category) : intentCats.length ? intentCats.some(c => r.approvedCategories.includes(c)) : r.approvedCategories.length > 0)))
    .sort((a, b) => b.score - a.score || b.followers - a.followers || a.displayName.localeCompare(b.displayName, 'tr'))
    .map(({ textHit, categoryMatch, ...r }) => r);
}

// ── Follow / block ──

export async function follow(tx: Tx, p: Principal, userId: string, on: boolean) {
  await myProfile(tx, p);
  if (userId === p.userId) throw invalid('Kendini takip edemezsin.');
  if (on) {
    if ((await blockedWith(tx, p.userId)).has(userId)) throw notFound('Profil');
    if (!(await tx.query(`SELECT 1 FROM network_profiles WHERE user_id = $1 AND status = 'active'`, [userId])).rowCount) throw notFound('Profil');
    await tx.query(`INSERT INTO network_follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p.userId, userId]);
  } else await tx.query(`DELETE FROM network_follows WHERE follower_id = $1 AND followee_id = $2`, [p.userId, userId]);
  return { following: on };
}

export async function block(tx: Tx, p: Principal, userId: string, on: boolean) {
  await myProfile(tx, p);
  if (userId === p.userId) throw invalid('Kendini engelleyemezsin.');
  if (on) {
    if (!(await tx.query(`SELECT 1 FROM network_profiles WHERE user_id = $1`, [userId])).rowCount) throw notFound('Profil');
    await tx.query(`INSERT INTO network_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p.userId, userId]);
    await tx.query(`DELETE FROM network_follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`, [p.userId, userId]);
  } else await tx.query(`DELETE FROM network_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [p.userId, userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: on ? 'network.blocked' : 'network.unblocked', entityType: 'network_profile', entityId: userId, payload: {} });
  return { blocked: on };
}

// ── Posts and comments ──

const POST_SQL = `SELECT po.*, n.display_name AS author_name, n.title AS author_title, (n.photo_key IS NOT NULL) AS author_photo,
   (SELECT count(*)::int FROM network_comments c WHERE c.post_id = po.id AND c.deleted_at IS NULL AND c.hidden_at IS NULL) AS comment_count
 FROM network_posts po JOIN network_profiles n ON n.user_id = po.author_id`;

function postOut(r: any, viewer: string) {
  const mine = r.author_id === viewer;
  return { id: r.id, authorId: r.author_id, authorName: r.author_name, authorTitle: r.author_title, authorPhoto: r.author_photo, kind: r.kind, status: r.status,
    body: r.hidden_at && !mine ? null : r.body, caseSnapshot: r.hidden_at && !mine ? null : r.case_snapshot, createdAt: r.created_at, publishedAt: r.published_at, editedAt: r.edited_at,
    hidden: !!r.hidden_at, hiddenReason: mine ? r.hidden_reason : null, commentCount: r.comment_count, mine, label: POST_NOTE,
    reapprovalNeeded: mine && r.kind === 'case' ? !!r.case_reapproval_needed : false, withdrawn: r.status === 'withdrawn' ? { reason: r.withdraw_reason, at: r.withdrawn_at } : null };
}

export async function createPost(tx: Tx, p: Principal, b: { body: string; publish: boolean }) {
  await myProfile(tx, p);
  const body = b.body.trim();
  if (body.length < 3 || body.length > 5000) throw invalid('Paylaşım 3–5000 karakter olmalı.');
  const r = (await tx.query<{ id: string }>(`INSERT INTO network_posts (author_id, body, status, published_at) VALUES ($1,$2,$3,$4) RETURNING id`,
    [p.userId, body, b.publish ? 'published' : 'draft', b.publish ? new Date().toISOString() : null])).rows[0]!;
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: b.publish ? 'network.post_published' : 'network.post_drafted', entityType: 'network_post', entityId: r.id, payload: {} });
  return { id: r.id };
}

async function ownPost(tx: Tx, p: Principal, id: string) {
  const r = (await tx.query(`SELECT * FROM network_posts WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!r || r.status === 'deleted' || (r.author_id !== p.userId && (r.status === 'draft' || r.status === 'withdrawn'))) throw notFound('Paylaşım');
  if (r.status === 'withdrawn') throw conflict('WITHDRAWN', 'Bu vaka paylaşımı işletme tarafından geri çekildi; değiştirilemez.');
  if (r.author_id !== p.userId) throw forbidden('Yalnız kendi paylaşımını değiştirebilirsin.');
  return r;
}

export async function updatePost(tx: Tx, p: Principal, id: string, b: { body?: string; op?: 'publish' | 'delete' }) {
  await myProfile(tx, p);
  const r = await ownPost(tx, p, id);
  if (b.op === 'delete') {
    await tx.query(`UPDATE network_posts SET status = 'deleted', deleted_at = clock_timestamp() WHERE id = $1`, [id]);
  } else if (b.op === 'publish') {
    if (r.status !== 'draft') throw conflict('NOT_DRAFT', 'Yalnız taslak yayımlanır.');
    // A case share is published only with the content that was permitted.
    if (r.kind === 'case' && (r.case_reapproval_needed || r.case_content_hash !== caseHash(r.body, r.case_snapshot))) {
      throw conflict('CASE_REAPPROVAL_NEEDED', 'Vaka metni izin verilen sürümden farklı; yayımlamak için işletme sahibi ya da merkez yöneticisinin yeniden onayı gerekir.');
    }
    await tx.query(`UPDATE network_posts SET status = 'published', published_at = clock_timestamp() WHERE id = $1`, [id]);
  } else {
    const body = (b.body ?? '').trim();
    if (body.length < 3 || body.length > 5000) throw invalid('Paylaşım 3–5000 karakter olmalı.');
    if (r.hidden_at) throw conflict('HIDDEN', 'Moderasyonla gizlenen paylaşım düzenlenemez.');
    if (r.kind === 'case') {
      // An edited case summary goes through the same personal/commercial data check as the original share.
      const issues = await dataCheck(tx, r.case_company_id, [{ field: 'summary', text: body }]);
      if (issues.length) throw new AppError(422, 'CASE_SHARE_PRIVATE_DATA', 'Özette kişisel ya da ticari bilgi var.', { issues });
    }
    if (r.kind === 'case' && body !== r.body) {
      // The permission covered the previewed text only: a change takes the post off the network until it is permitted again.
      await tx.query(`UPDATE network_posts SET body = $2, edited_at = clock_timestamp(), status = 'draft', case_reapproval_needed = true WHERE id = $1`, [id, body]);
    } else {
      await tx.query(`UPDATE network_posts SET body = $2, edited_at = CASE WHEN status = 'published' THEN clock_timestamp() ELSE edited_at END WHERE id = $1`, [id, body]);
    }
  }
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: `network.post_${b.op ?? 'edited'}`, entityType: 'network_post', entityId: id, payload: {} });
}

/** Adds the persisted "helpful" count and the viewer's own helpful / saved marks to already-built post views. */
async function withReactions<T extends { id: string }>(tx: Tx, viewer: string, posts: T[]) {
  if (!posts.length) return posts.map(x => ({ ...x, helpfulCount: 0, helpfulByMe: false, savedByMe: false }));
  const rows = (await tx.query<{ post_id: string; kind: string; n: number; mine: boolean }>(
    `SELECT post_id, kind, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM network_post_reactions WHERE post_id = ANY($1) GROUP BY post_id, kind`, [posts.map(x => x.id), viewer])).rows;
  return posts.map(x => ({ ...x,
    helpfulCount: rows.find(r => r.post_id === x.id && r.kind === 'helpful')?.n ?? 0,
    helpfulByMe: !!rows.find(r => r.post_id === x.id && r.kind === 'helpful')?.mine,
    savedByMe: !!rows.find(r => r.post_id === x.id && r.kind === 'saved')?.mine }));
}

/** "Helpful" and "saved" on a post you can see. Idempotent both ways; "saved" is private to the person, "helpful" is counted. */
export async function react(tx: Tx, p: Principal, postId: string, kind: 'helpful' | 'saved', on: boolean) {
  await myProfile(tx, p);
  const blocked = await blockedWith(tx, p.userId);
  const r = (await tx.query(`SELECT id, author_id, status, hidden_at FROM network_posts WHERE id = $1`, [postId])).rows[0];
  if (!r || r.status !== 'published' || r.hidden_at || blocked.has(r.author_id)) throw notFound('Paylaşım');
  if (kind === 'helpful' && r.author_id === p.userId) throw invalid('Kendi paylaşımını faydalı bulamazsın.');
  if (on) await tx.query(`INSERT INTO network_post_reactions (post_id, user_id, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [postId, p.userId, kind]);
  else await tx.query(`DELETE FROM network_post_reactions WHERE post_id = $1 AND user_id = $2 AND kind = $3`, [postId, p.userId, kind]);
  const [v] = await withReactions(tx, p.userId, [{ id: postId }]);
  return { helpfulCount: v!.helpfulCount, helpfulByMe: v!.helpfulByMe, savedByMe: v!.savedByMe };
}

export async function feed(tx: Tx, p: Principal, q: { scope: 'all' | 'following' | 'mine' | 'saved'; authorId?: string }) {
  await myProfile(tx, p);
  const blocked = [...(await blockedWith(tx, p.userId))];
  const rows = (await tx.query(`${POST_SQL}
     WHERE po.status NOT IN ('deleted','withdrawn') AND n.status = 'active'
       AND (po.status = 'published' OR po.author_id = $1)
       AND (po.hidden_at IS NULL OR po.author_id = $1)
       AND NOT (po.author_id = ANY($2::uuid[]))
       AND ($3 <> 'following' OR po.author_id IN (SELECT followee_id FROM network_follows WHERE follower_id = $1))
       AND ($3 <> 'mine' OR po.author_id = $1)
       AND ($3 <> 'saved' OR po.id IN (SELECT post_id FROM network_post_reactions WHERE user_id = $1 AND kind = 'saved'))
       AND ($4::uuid IS NULL OR po.author_id = $4)
       AND ($3 = 'mine' OR po.status = 'published' OR $4::uuid = $1)
     ORDER BY COALESCE(po.published_at, po.created_at) DESC LIMIT 100`, [p.userId, blocked, q.scope, q.authorId ?? null])).rows;
  return { label: POST_NOTE, posts: await withReactions(tx, p.userId, rows.map(r => postOut(r, p.userId))) };
}

export async function getPost(tx: Tx, p: Principal, id: string) {
  await myProfile(tx, p);
  const r = (await tx.query(`${POST_SQL} WHERE po.id = $1`, [id])).rows[0];
  const blocked = await blockedWith(tx, p.userId);
  if (!r || r.status === 'deleted' || ((r.status === 'draft' || r.status === 'withdrawn') && r.author_id !== p.userId) || blocked.has(r.author_id) || (r.hidden_at && r.author_id !== p.userId)) throw notFound('Paylaşım');
  const comments = (await tx.query(`SELECT c.*, n.display_name AS author_name FROM network_comments c JOIN network_profiles n ON n.user_id = c.author_id
     WHERE c.post_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`, [id])).rows
    .filter(c => !blocked.has(c.author_id) && (!c.hidden_at || c.author_id === p.userId))
    .map(c => ({ id: c.id, authorId: c.author_id, authorName: c.author_name, body: c.body, createdAt: c.created_at, editedAt: c.edited_at, mine: c.author_id === p.userId,
      hidden: !!c.hidden_at, hiddenReason: c.author_id === p.userId ? c.hidden_reason : null }));
  const [withR] = await withReactions(tx, p.userId, [postOut(r, p.userId)]);
  return { ...withR!, comments };
}

export async function comment(tx: Tx, p: Principal, postId: string, body: string) {
  await myProfile(tx, p);
  await getPost(tx, p, postId);
  const post = (await tx.query(`SELECT status, author_id FROM network_posts WHERE id = $1`, [postId])).rows[0];
  if (post.status !== 'published') throw conflict('NOT_PUBLISHED', 'Taslağa yorum yapılmaz.');
  const t = body.trim();
  if (t.length < 2 || t.length > 2000) throw invalid('Yorum 2–2000 karakter olmalı.');
  const r = (await tx.query<{ id: string }>(`INSERT INTO network_comments (post_id, author_id, body) VALUES ($1,$2,$3) RETURNING id`, [postId, p.userId, t])).rows[0]!;
  return { id: r.id };
}

export async function updateComment(tx: Tx, p: Principal, id: string, b: { body?: string; op?: 'delete' }) {
  await myProfile(tx, p);
  const c = (await tx.query(`SELECT * FROM network_comments WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!c || c.deleted_at) throw notFound('Yorum');
  if (c.author_id !== p.userId) throw forbidden('Yalnız kendi yorumunu değiştirebilirsin.');
  if (b.op === 'delete') await tx.query(`UPDATE network_comments SET deleted_at = clock_timestamp() WHERE id = $1`, [id]);
  else {
    const t = (b.body ?? '').trim();
    if (t.length < 2 || t.length > 2000) throw invalid('Yorum 2–2000 karakter olmalı.');
    await tx.query(`UPDATE network_comments SET body = $2, edited_at = clock_timestamp() WHERE id = $1`, [id, t]);
  }
}

// ── Reports and moderation ──

export async function report(tx: Tx, p: Principal, b: { targetType: 'post' | 'comment' | 'profile'; targetId: string; reason: string; details: string }) {
  await myProfile(tx, p);
  const table = b.targetType === 'post' ? 'network_posts' : b.targetType === 'comment' ? 'network_comments' : 'network_profiles';
  const col = b.targetType === 'profile' ? 'user_id' : 'id';
  if (!(await tx.query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [b.targetId])).rowCount) throw notFound('İçerik');
  try {
    const r = (await tx.query<{ id: string }>(`INSERT INTO network_reports (reporter_id, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [p.userId, b.targetType, b.targetId, b.reason, b.details.trim().slice(0, 1000)])).rows[0]!;
    return { id: r.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('ALREADY_REPORTED', 'Bu içeriği zaten şikâyet ettin; moderasyon inceliyor.');
    throw e;
  }
}

const isModerator = (p: Principal) => p.platformRoles.includes('network_moderator');

export async function moderationQueue(tx: Tx, p: Principal, status: 'open' | 'closed') {
  if (!isModerator(p)) throw forbidden('Moderasyon yetkin yok.');
  const rows = (await tx.query(`SELECT r.*, ru.display_name AS reporter_name, hu.display_name AS handled_by_name FROM network_reports r JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN users hu ON hu.id = r.handled_by WHERE ($1 = 'open') = (r.status = 'open') ORDER BY r.created_at DESC LIMIT 200`, [status])).rows;
  const out = [];
  for (const r of rows) {
    let target: any = null;
    if (r.target_type === 'post') target = (await tx.query(`SELECT po.body, po.kind, po.hidden_at, po.status, n.display_name AS author_name, po.author_id FROM network_posts po JOIN network_profiles n ON n.user_id = po.author_id WHERE po.id = $1`, [r.target_id])).rows[0];
    else if (r.target_type === 'comment') target = (await tx.query(`SELECT c.body, c.hidden_at, n.display_name AS author_name, c.author_id FROM network_comments c JOIN network_profiles n ON n.user_id = c.author_id WHERE c.id = $1`, [r.target_id])).rows[0];
    else target = (await tx.query(`SELECT display_name AS author_name, title AS body, status, user_id AS author_id FROM network_profiles WHERE user_id = $1`, [r.target_id])).rows[0];
    const others = (await tx.query(`SELECT count(*)::int AS n FROM network_reports WHERE target_type = $1 AND target_id = $2`, [r.target_type, r.target_id])).rows[0].n;
    out.push({ ...r, target, reportsOnTarget: others });
  }
  return out;
}

export async function decide(tx: Tx, p: Principal, reportId: string, b: { decision: 'hide' | 'dismiss' | 'suspend_profile'; notes: string }) {
  if (!isModerator(p)) throw forbidden('Moderasyon yetkin yok.');
  if (b.notes.trim().length < 10) throw invalid('Kararın gerekçesini yaz (en az bir cümle).');
  const r = (await tx.query(`SELECT * FROM network_reports WHERE id = $1 FOR UPDATE`, [reportId])).rows[0];
  if (!r) throw notFound('Şikâyet');
  if (r.status !== 'open') throw conflict('ALREADY_HANDLED', 'Bu şikâyet zaten karara bağlandı.');
  if (r.reporter_id === p.userId) throw forbidden('Kendi şikâyetini karara bağlayamazsın.');
  const notes = b.notes.trim();
  if (b.decision === 'hide') {
    if (r.target_type === 'profile') throw invalid('Profil gizlenmez; gerekirse askıya alınır.');
    const table = r.target_type === 'post' ? 'network_posts' : 'network_comments';
    await tx.query(`UPDATE ${table} SET hidden_at = clock_timestamp(), hidden_reason = $2 WHERE id = $1`, [r.target_id, notes]);
  } else if (b.decision === 'suspend_profile') {
    const author = r.target_type === 'profile' ? r.target_id
      : (await tx.query(`SELECT author_id FROM ${r.target_type === 'post' ? 'network_posts' : 'network_comments'} WHERE id = $1`, [r.target_id])).rows[0].author_id;
    await tx.query(`UPDATE network_profiles SET status = 'suspended', suspended_reason = $2 WHERE user_id = $1`, [author, notes]);
  }
  // Every open report on the same target is closed by the same decision.
  await tx.query(`UPDATE network_reports SET status = $3, decision = $4, decision_notes = $5, handled_by = $6, handled_at = clock_timestamp()
     WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, [r.target_type, r.target_id, b.decision === 'dismiss' ? 'dismissed' : 'actioned', b.decision, notes, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'network.moderation_decision', entityType: `network_${r.target_type}`, entityId: r.target_id,
    payload: { reportId, decision: b.decision, notes, reason: r.reason } });
  return { status: b.decision === 'dismiss' ? 'dismissed' : 'actioned' };
}

// ── Case share (from a business, with permission, preview and data check) ──

export const CASE_FIELDS = ['hazard', 'risk', 'causes', 'actions', 'outcome'] as const;
const HAZ: Record<string, string> = { cold_chain_temperature: 'Sıcaklık / soğuk zincir', personal_hygiene: 'Kişisel hijyen', gas_leak: 'Gaz / LPG',
  equipment_failure: 'Ekipman arızası', cleaning: 'Temizlik', other: 'Diğer' };
const RISK: Record<string, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' };
const CAUSE: Record<string, string> = { knowledge: 'Bilgi eksikliği', equipment: 'Ekipman eksikliği', resource: 'Kaynak eksikliği', process: 'Süreç eksikliği' };
const KIND: Record<string, string> = { correction: 'Düzeltme', corrective_action: 'Düzeltici faaliyet', follow_up: 'Takip' };

/** Finds what must not leave the business: contact data, IDs, names of the business, sites and people. */
async function dataCheck(tx: Tx, companyId: string, texts: { field: string; text: string }[]) {
  const company = (await tx.query(`SELECT name FROM companies WHERE id = $1`, [companyId])).rows[0];
  const sites = (await tx.query(`SELECT name FROM sites WHERE company_id = $1`, [companyId])).rows.map(r => r.name as string);
  const people = (await tx.query(`SELECT DISTINCT u.display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1`, [companyId])).rows
    .flatMap(r => (r.display_name as string).split(/[\s()]+/).filter(w => w.length >= 3 && !['şube', 'işletme', 'sahibi', 'yöneticisi', 'personel', 'merkez'].includes(w.toLocaleLowerCase('tr'))));
  const equipment = (await tx.query(`SELECT name, serial FROM equipment WHERE company_id = $1`, [companyId])).rows.flatMap(r => [r.serial].filter(Boolean) as string[]);
  const terms: [string, string][] = [
    ...(company ? company.name.replace(/\(DEMO\)/i, '').trim().split(/\s+/).filter((w: string) => w.length >= 4).map((w: string) => ['işletme adı', w] as [string, string]) : []),
    ...sites.map(s => ['şube adı', s] as [string, string]), ...people.map(n => ['kişi adı', n] as [string, string]), ...equipment.map(e => ['ekipman seri no', e] as [string, string]),
  ];
  const issues: { field: string; type: string }[] = [];
  const patterns: [string, RegExp][] = [['e-posta', /[^\s@]+@[^\s@]+\.[^\s@]+/], ['telefon', /(\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/],
    ['T.C. kimlik no', /\b[1-9]\d{10}\b/], ['IBAN', /\bTR\d{2}[\s\d]{20,}/i], ['adres', /\b(mahallesi|mah\.|caddesi|cad\.|sokak|sk\.|no:)\b/i], ['fiyat / ticari tutar', /(₺|\bTL\b|\btl\b)\s?\d|\d[\d.,]*\s?(₺|TL)/]];
  for (const t of texts) {
    const low = t.text.toLocaleLowerCase('tr');
    for (const [type, re] of patterns) if (re.test(t.text)) issues.push({ field: t.field, type });
    for (const [type, term] of terms) if (term && low.includes(term.toLocaleLowerCase('tr'))) issues.push({ field: t.field, type });
  }
  return [...new Map(issues.map(i => [`${i.field}:${i.type}`, i])).values()];
}

async function buildCase(tx: Tx, companyId: string, ncrId: string, fields: string[], summary: string) {
  const n = (await tx.query(`SELECT * FROM nonconformities WHERE id = $1 AND company_id = $2`, [ncrId, companyId])).rows[0];
  if (!n) throw notFound('Uygunsuzluk');
  const snap: Record<string, unknown> = { summary: summary.trim() };
  if (fields.includes('hazard')) snap.hazard = HAZ[n.hazard_type] ?? 'Diğer';
  if (fields.includes('risk')) snap.risk = RISK[n.risk_level] ?? n.risk_level;
  if (fields.includes('causes')) {
    const c = (await tx.query(`SELECT stage, categories FROM ncr_cause_assessments WHERE ncr_id = $1 ORDER BY done_at`, [ncrId])).rows;
    const last = (stage: string) => [...c].reverse().find(x => x.stage === stage)?.categories as string[] | undefined;
    snap.causes = { initial: (last('initial') ?? []).map(x => CAUSE[x] ?? x), verified: (last('verified') ?? []).map(x => CAUSE[x] ?? x) };
  }
  if (fields.includes('actions')) {
    // Kinds and counts only; free-text descriptions stay in the business.
    const a = (await tx.query(`SELECT kind, count(*)::int AS n FROM ncr_actions WHERE ncr_id = $1 AND status <> 'cancelled' GROUP BY kind`, [ncrId])).rows;
    snap.actions = a.map(x => `${KIND[x.kind] ?? x.kind}: ${x.n}`);
  }
  if (fields.includes('outcome')) snap.outcome = n.status === 'closed' ? 'Kapandı (etkinliği doğrulandı)' : 'Açık';
  const issues = await dataCheck(tx, companyId, [{ field: 'summary', text: summary }]);
  // Never: business name, site, people, dates, photos, evidence, documents, customer data.
  return { snapshot: snap, issues, excluded: ['işletme ve şube adı', 'kişi adları', 'tarihler', 'fotoğraf ve kanıt dosyaları', 'belgeler', 'aksiyon açıklamaları', 'müşteri bilgileri'] };
}

export async function previewCase(tx: Tx, p: Principal, companyId: string, ncrId: string, b: { fields: string[]; summary: string }) {
  const n = (await tx.query(`SELECT site_id FROM nonconformities WHERE id = $1 AND company_id = $2`, [ncrId, companyId])).rows[0];
  if (!n || !can(p, 'ncr.manage', { companyId, siteId: n.site_id, recordId: ncrId }).ok) throw notFound('Uygunsuzluk');
  const built = await buildCase(tx, companyId, ncrId, b.fields, b.summary);
  return { ...built, canPermit: can(p, 'members.manage', { companyId }).ok,
    permissionNote: 'Vaka paylaşımı için işletme sahibi ya da merkez yöneticisinin açık izni gerekir. Paylaşım kullanıcı içeriği olarak görünür.' };
}

/** Creates a DRAFT case post in the sharer's network profile; publishing is a separate step. */
export async function shareCase(tx: Tx, p: Principal, companyId: string, ncrId: string, b: { fields: string[]; summary: string; permit: boolean }) {
  const n = (await tx.query(`SELECT site_id FROM nonconformities WHERE id = $1 AND company_id = $2`, [ncrId, companyId])).rows[0];
  if (!n || !can(p, 'ncr.manage', { companyId, siteId: n.site_id, recordId: ncrId }).ok) throw notFound('Uygunsuzluk');
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden('Vaka paylaşımına işletme sahibi ya da merkez yöneticisi izin verir.');
  if (!b.permit) throw invalid('Paylaşım iznini açıkça onayla.');
  if (b.summary.trim().length < 20) throw invalid('Ne öğrendiğinizi en az bir cümleyle yaz.');
  const prof = (await tx.query(`SELECT status FROM network_profiles WHERE user_id = $1`, [p.userId])).rows[0];
  if (!prof) throw new AppError(409, 'NO_NETWORK_PROFILE', 'Paylaşmak için önce mesleki ağ profilini oluştur.');
  const built = await buildCase(tx, companyId, ncrId, b.fields, b.summary);
  if (built.issues.length) throw new AppError(422, 'CASE_SHARE_PRIVATE_DATA', 'Özette kişisel ya da ticari bilgi var; önizlemedeki uyarıları düzelt.', { issues: built.issues });
  const r = (await tx.query<{ id: string }>(`INSERT INTO network_posts (author_id, kind, status, body, case_snapshot, case_company_id, case_ncr_id, case_permitted_by, case_permitted_at, case_content_hash)
     VALUES ($1,'case','draft',$2,$3,$4,$5,$1, clock_timestamp(), $6) RETURNING id`, [p.userId, b.summary.trim(), JSON.stringify(built.snapshot), companyId, ncrId,
       caseHash(b.summary.trim(), built.snapshot)])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.case_shared', entityType: 'nonconformity', entityId: ncrId,
    payload: { postId: r.id, fields: b.fields, status: 'draft' } });
  return { postId: r.id, snapshot: built.snapshot };
}

export async function moderatorFlag(p: Principal) { return { moderator: isModerator(p) }; }

/** The permitted content: summary + shared fields. */
export function caseHash(body: string, snapshot: unknown) {
  // Stable key order: the snapshot comes back from jsonb with its keys reordered.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canon({ body, snapshot }))).digest('hex');
}

/** Case posts of one business, for its authorised people (permission and withdrawal). */
export async function businessCasePosts(tx: Tx, p: Principal, companyId: string) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden();
  return (await tx.query(`SELECT po.id, po.status, po.body, po.case_ncr_id, po.case_reapproval_needed, po.published_at, po.withdrawn_at, po.withdraw_reason, po.hidden_at,
       n.display_name AS author_name, nc.title AS ncr_title FROM network_posts po JOIN network_profiles n ON n.user_id = po.author_id
       LEFT JOIN nonconformities nc ON nc.id = po.case_ncr_id WHERE po.kind = 'case' AND po.case_company_id = $1 AND po.status <> 'deleted' ORDER BY po.created_at DESC`, [companyId])).rows;
}

/** An authorised person permits the CURRENT text again (after the data check). */
export async function reapproveCase(tx: Tx, p: Principal, companyId: string, postId: string, b: { permit: boolean }) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden('Vaka paylaşımına işletme sahibi ya da merkez yöneticisi izin verir.');
  const r = (await tx.query(`SELECT * FROM network_posts WHERE id = $1 AND kind = 'case' AND case_company_id = $2 FOR UPDATE`, [postId, companyId])).rows[0];
  if (!r || r.status === 'deleted') throw notFound('Vaka paylaşımı');
  if (r.status === 'withdrawn') throw conflict('WITHDRAWN', 'Geri çekilen paylaşım yeniden onaylanmaz; gerekirse yeni paylaşım hazırla.');
  if (!b.permit) throw invalid('İzni açıkça onayla.');
  const issues = await dataCheck(tx, companyId, [{ field: 'summary', text: r.body }]);
  if (issues.length) throw new AppError(422, 'CASE_SHARE_PRIVATE_DATA', 'Metinde kişisel ya da ticari bilgi var; yazar düzeltmeli.', { issues });
  await tx.query(`UPDATE network_posts SET case_reapproval_needed = false, case_content_hash = $2, case_permitted_by = $3, case_permitted_at = clock_timestamp() WHERE id = $1`,
    [postId, caseHash(r.body, r.case_snapshot), p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.case_share_reapproved', entityType: 'nonconformity', entityId: r.case_ncr_id, payload: { postId } });
  return { ok: true };
}

/** Withdraw: the post (and its comments) is closed to the network at once. Kept for the record. */
export async function withdrawCase(tx: Tx, p: Principal, companyId: string, postId: string, reason: string) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden('Vaka paylaşımını işletme sahibi ya da merkez yöneticisi geri çeker.');
  const r = (await tx.query(`SELECT * FROM network_posts WHERE id = $1 AND kind = 'case' AND case_company_id = $2 FOR UPDATE`, [postId, companyId])).rows[0];
  if (!r || r.status === 'deleted') throw notFound('Vaka paylaşımı');
  if (r.status === 'withdrawn') throw conflict('ALREADY_WITHDRAWN', 'Bu paylaşım zaten geri çekildi.');
  if (reason.trim().length < 10) throw invalid('Geri çekme gerekçesini yaz.');
  await tx.query(`UPDATE network_posts SET status = 'withdrawn', withdrawn_by = $2, withdrawn_at = clock_timestamp(), withdraw_reason = $3 WHERE id = $1`, [postId, p.userId, reason.trim()]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.case_share_withdrawn', entityType: 'nonconformity', entityId: r.case_ncr_id, payload: { postId, reason: reason.trim() } });
  return { status: 'withdrawn' };
}

/** The reporter follows their reports; the decision and its reason are shown. */
export async function myReports(tx: Tx, p: Principal) {
  await myProfile(tx, p, false);
  return (await tx.query(`SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.decision, r.decision_notes, r.created_at, r.handled_at,
       a.status AS appeal_status FROM network_reports r LEFT JOIN network_appeals a ON a.report_id = r.id WHERE r.reporter_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [p.userId])).rows
    .map(r => ({ ...r, statusLabel: r.status === 'open' ? 'İnceleniyor' : r.status === 'dismissed' ? 'Reddedildi (içerik kaldı)' : r.decision === 'hide' ? 'İçerik gizlendi' : 'Profil askıya alındı' }));
}

/** Decisions on the user's own content, which they may appeal once. */
export async function decisionsOnMe(tx: Tx, p: Principal) {
  return (await tx.query(`SELECT r.id, r.target_type, r.target_id, r.decision, r.decision_notes, r.handled_at, a.status AS appeal_status, a.decision_notes AS appeal_notes
     FROM network_reports r LEFT JOIN network_posts po ON r.target_type = 'post' AND po.id = r.target_id
       LEFT JOIN network_comments c ON r.target_type = 'comment' AND c.id = r.target_id LEFT JOIN network_appeals a ON a.report_id = r.id
    WHERE r.status = 'actioned' AND (po.author_id = $1 OR c.author_id = $1 OR (r.target_type = 'profile' AND r.target_id = $1))
    ORDER BY r.handled_at DESC`, [p.userId])).rows;
}

export async function appeal(tx: Tx, p: Principal, reportId: string, reason: string) {
  const mine = (await decisionsOnMe(tx, p)).find(d => d.id === reportId);
  if (!mine) throw notFound('Karar');
  if (mine.appeal_status) throw conflict('ALREADY_APPEALED', 'Bu karara zaten itiraz ettin.');
  if (reason.trim().length < 10) throw invalid('İtiraz gerekçeni yaz (en az bir cümle).');
  const r = (await tx.query<{ id: string }>(`INSERT INTO network_appeals (report_id, appellant_id, reason) VALUES ($1,$2,$3) RETURNING id`, [reportId, p.userId, reason.trim()])).rows[0]!;
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'network.appeal_filed', entityType: 'network_report', entityId: reportId, payload: { appealId: r.id } });
  return { id: r.id };
}

/** Appeals waiting for a moderator who did NOT make the first decision. */
export async function appealQueue(tx: Tx, p: Principal) {
  if (!isModerator(p)) throw forbidden('Moderasyon yetkin yok.');
  return (await tx.query(`SELECT a.id, a.reason, a.status, a.created_at, r.id AS report_id, r.target_type, r.target_id, r.decision, r.decision_notes, r.handled_by,
       hu.display_name AS first_moderator, (r.handled_by = $1) AS mine_first
     FROM network_appeals a JOIN network_reports r ON r.id = a.report_id LEFT JOIN users hu ON hu.id = r.handled_by WHERE a.status = 'open' ORDER BY a.created_at`, [p.userId])).rows;
}

export async function decideAppeal(tx: Tx, p: Principal, appealId: string, b: { decision: 'upheld' | 'overturned'; notes: string }) {
  if (!isModerator(p)) throw forbidden('Moderasyon yetkin yok.');
  const a = (await tx.query(`SELECT a.*, r.handled_by, r.target_type, r.target_id, r.decision AS first_decision FROM network_appeals a JOIN network_reports r ON r.id = a.report_id
     WHERE a.id = $1 FOR UPDATE OF a`, [appealId])).rows[0];
  if (!a) throw notFound('İtiraz');
  if (a.status !== 'open') throw conflict('ALREADY_HANDLED', 'Bu itiraz karara bağlandı.');
  if (a.handled_by === p.userId) throw forbidden('İlk kararı sen verdin; itirazı başka bir moderatör incelemeli.');
  if (a.appellant_id === p.userId) throw forbidden('Kendi itirazını karara bağlayamazsın.');
  if (b.notes.trim().length < 10) throw invalid('Kararın gerekçesini yaz.');
  if (b.decision === 'overturned') {
    if (a.first_decision === 'hide') await tx.query(`UPDATE ${a.target_type === 'post' ? 'network_posts' : 'network_comments'} SET hidden_at = NULL, hidden_reason = NULL WHERE id = $1`, [a.target_id]);
    if (a.first_decision === 'suspend_profile') {
      const author = a.target_type === 'profile' ? a.target_id
        : (await tx.query(`SELECT author_id FROM ${a.target_type === 'post' ? 'network_posts' : 'network_comments'} WHERE id = $1`, [a.target_id])).rows[0].author_id;
      await tx.query(`UPDATE network_profiles SET status = 'active', suspended_reason = NULL WHERE user_id = $1`, [author]);
    }
  }
  await tx.query(`UPDATE network_appeals SET status = $2, decision_notes = $3, handled_by = $4, handled_at = clock_timestamp() WHERE id = $1`, [appealId, b.decision, b.notes.trim(), p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'network.appeal_decided', entityType: 'network_report', entityId: a.report_id,
    payload: { appealId, decision: b.decision, notes: b.notes.trim() } });
  return { status: b.decision };
}
