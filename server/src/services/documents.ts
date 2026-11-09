import type { Db, Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { ALLOWED_MIME } from '../storage/local';
import { appendAudit } from './audit';
import { notify, siteManagers } from './notifications';

/**
 * Document vault: licences, registrations, calibration and maintenance reports, certificates,
 * insurance and contracts, kept per business, site or piece of equipment, with versions.
 *
 * An uploaded file is NOT a verified or valid document. A version counts only after a person
 * other than the uploader reviewed it and confirmed its dates; validity is then computed from
 * those dates. Nothing here checks a document with the issuing authority.
 */
export const DOC_TYPES = ['business_license', 'food_registration', 'calibration_certificate', 'maintenance_report',
  'training_certificate', 'health_certificate', 'insurance', 'contract', 'other'] as const;
export type DocType = typeof DOC_TYPES[number];

/** Reminder window before a verified document runs out (example policy). */
export const EXPIRY_WARNING_DAYS = 30;

/**
 * Kept apart on purpose:
 *  - unreviewed           uploaded, nobody checked it (an upload is never a valid document)
 *  - internally_reviewed  someone in the business compared it with the original ("kurum içi incelendi")
 *  - issuer_verified      someone recorded HOW it was confirmed with the issuing authority (method + reference)
 *  - rejected             the latest version was not accepted
 *  - expired              the reviewed version's end date has passed
 * Neither an upload nor an internal review is an official confirmation of validity.
 */
export type DocStatus = 'no_file' | 'file_pending' | 'unreviewed' | 'rejected' | 'internally_reviewed' | 'issuer_verified' | 'expired';

type VersionRow = { id: string; version: number; review_status: 'unreviewed' | 'verified' | 'rejected'; valid_from: string | null; valid_until: string | null;
  file_status: string | null; issuer_check_method?: string | null };

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => day(new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000));

/**
 * The document's state. Validity comes only from the newest VERIFIED version; a newer version
 * waiting for review is shown separately and does not make the document valid by itself.
 */
/** Who recorded a check with the issuer, how and with what reference. The app itself never queries an authority. */
export function issuerCheckOf(v: any) {
  return v?.issuer_check_method ? { recordedBy: v.issuer_checked_by_name as string | null, method: v.issuer_check_method as string, reference: v.issuer_check_ref as string,
    recordedAt: v.issuer_checked_at as string, queriedByApp: false } : null;
}

export function documentStatus(versions: VersionRow[], today: string): { status: DocStatus; current: VersionRow | null; pending: VersionRow | null;
  expiring: boolean; notYetValid: boolean } {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const current = sorted.find(v => v.review_status === 'verified') ?? null;
  const latest = sorted[0] ?? null;
  const pending = latest && latest !== current && latest.review_status === 'unreviewed' ? latest : null;
  const flags = { expiring: false, notYetValid: false };
  if (current) {
    if (current.valid_until && current.valid_until < today) return { status: 'expired', current, pending, ...flags };
    flags.expiring = !!current.valid_until && current.valid_until <= addDays(today, EXPIRY_WARNING_DAYS);
    flags.notYetValid = !!current.valid_from && current.valid_from > today;
    return { status: current.issuer_check_method ? 'issuer_verified' : 'internally_reviewed', current, pending, ...flags };
  }
  if (!latest) return { status: 'no_file', current, pending, ...flags };
  if (latest.file_status !== 'stored') return { status: 'file_pending', current, pending, ...flags };
  return { status: latest.review_status === 'rejected' ? 'rejected' : 'unreviewed', current, pending, ...flags };
}

/** Readable for this person: their scope covers the document's site, or a company-wide document shared with a site they cover. */
async function canReadDoc(tx: Tx, p: Principal, companyId: string, d: { id: string; site_id: string | null }) {
  if (can(p, 'document.read', { companyId, siteId: d.site_id }).ok) return true;
  if (d.site_id) return false;
  const shares = (await tx.query<{ site_id: string }>(`SELECT site_id FROM document_shares WHERE document_id = $1 AND revoked_at IS NULL`, [d.id])).rows;
  return shares.some(sh => can(p, 'document.read', { companyId, siteId: sh.site_id }).ok);
}
export { canReadDoc };

/** People who keep a document: owner/HQ for company-wide ones, plus the site manager for a site's. */
async function keepers(tx: Tx, companyId: string, siteId: string | null): Promise<string[]> {
  if (siteId) return siteManagers(tx, companyId, siteId);
  return (await tx.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM memberships WHERE company_id = $1 AND status = 'active'
     AND site_id IS NULL AND role IN ('owner','hq_manager')`, [companyId])).rows.map(r => r.user_id);
}

const VERSIONS_SQL = `SELECT v.id, v.document_id, v.version, v.valid_from::text AS valid_from, v.valid_until::text AS valid_until, v.notes, v.review_status,
     v.reviewed_by, v.reviewed_at, v.review_notes, v.uploaded_by, v.uploaded_at, uu.display_name AS uploaded_by_name, ru.display_name AS reviewed_by_name,
     v.issuer_check_method, v.issuer_check_ref, v.issuer_check_notes, v.issuer_checked_at, iu.display_name AS issuer_checked_by_name,
     e.id AS evidence_id, e.status AS file_status, e.mime, e.size_bytes, e.declared_sha256, e.rejection_reason AS file_rejection
   FROM document_versions v JOIN users uu ON uu.id = v.uploaded_by LEFT JOIN users ru ON ru.id = v.reviewed_by LEFT JOIN users iu ON iu.id = v.issuer_checked_by
   LEFT JOIN LATERAL (SELECT * FROM evidence x WHERE x.document_version_id = v.id ORDER BY x.created_at DESC LIMIT 1) e ON true`;

export type DocFilter = 'expiring' | 'expired' | 'pending_review' | 'rejected';
/** Vault filters: soon to run out, ran out, waiting for review (also a newer version on a valid document), rejected. */
export function matchesFilter(d: { status: DocStatus; expiring: boolean; pendingReview: boolean; latestRejected?: boolean }, f: DocFilter) {
  if (f === 'expiring') return d.expiring && d.status !== 'expired';
  if (f === 'expired') return d.status === 'expired';
  if (f === 'pending_review') return d.pendingReview;
  return d.status === 'rejected' || !!d.latestRejected;
}

export async function listDocuments(tx: Tx, p: Principal, companyId: string, f: { siteId?: string | null; equipmentId?: string | null; filter?: DocFilter | null } = {}) {
  const docs = (await tx.query(
    `SELECT d.*, s.name AS site_name, eq.name AS equipment_name FROM documents d LEFT JOIN sites s ON s.id = d.site_id LEFT JOIN equipment eq ON eq.id = d.equipment_id
      WHERE d.company_id = $1 AND d.archived_at IS NULL AND ($2::uuid IS NULL OR d.site_id = $2) AND ($3::uuid IS NULL OR d.equipment_id = $3)
      ORDER BY d.created_at`, [companyId, f.siteId ?? null, f.equipmentId ?? null])).rows;
  const readable = [];
  for (const d of docs) if (await canReadDoc(tx, p, companyId, d)) readable.push(d);
  const out = await listOut(tx, p, companyId, readable);
  return f.filter ? out.filter(d => matchesFilter(d, f.filter!)) : out;
}

async function listOut(tx: Tx, p: Principal, companyId: string, docs: any[]) {
  if (!docs.length) return [];
  const versions = (await tx.query(`${VERSIONS_SQL} WHERE v.document_id = ANY($1)`, [docs.map(d => d.id)])).rows;
  const today = day(new Date());
  return docs.map(d => {
    const vs = versions.filter(v => v.document_id === d.id);
    const st = documentStatus(vs, today);
    return { id: d.id, docType: d.doc_type, title: d.title, issuer: d.issuer, documentNo: d.document_no, siteId: d.site_id, siteName: d.site_name,
      equipmentId: d.equipment_id, equipmentName: d.equipment_name, status: st.status, expiring: st.expiring, notYetValid: st.notYetValid,
      sharedReadOnly: !can(p, 'document.read', { companyId, siteId: d.site_id }).ok,
      validUntil: st.current?.valid_until ?? null, validFrom: st.current?.valid_from ?? null, versionCount: vs.length, pendingReview: !!st.pending || st.status === 'unreviewed',
      latestRejected: [...vs].sort((a, b) => b.version - a.version)[0]?.review_status === 'rejected',
      issuerCheck: issuerCheckOf(st.current) };
  });
}

export type CreateDocument = { docType: DocType; title: string; siteId: string | null; equipmentId: string | null; issuer: string | null; documentNo: string | null };

export async function createDocument(tx: Tx, p: Principal, companyId: string, b: CreateDocument) {
  let siteId = b.siteId;
  if (b.equipmentId) {
    const e = (await tx.query(`SELECT site_id FROM equipment WHERE id = $1 AND company_id = $2`, [b.equipmentId, companyId])).rows[0];
    if (!e) throw invalid('Ekipman bulunamadı.');
    if (siteId && siteId !== e.site_id) throw invalid('Ekipman bu şubede değil.');
    siteId = e.site_id;
  }
  if (siteId && !(await tx.query(`SELECT 1 FROM sites WHERE id = $1 AND company_id = $2`, [siteId, companyId])).rowCount) throw invalid('Şube bulunamadı.');
  if (!can(p, 'document.write', { companyId, siteId }).ok) throw forbidden(siteId ? 'Bu şubede belge ekleme yetkin yok.' : 'İşletme geneli belgeyi işletme sahibi ya da merkez yöneticisi ekler.');
  if (b.title.trim().length < 3) throw invalid('Belgeye bir ad ver.');
  const d = (await tx.query<{ id: string }>(
    `INSERT INTO documents (company_id, site_id, equipment_id, doc_type, title, issuer, document_no, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, siteId, b.equipmentId, b.docType, b.title.trim(), b.issuer?.trim() || null, b.documentNo?.trim() || null, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.created', entityType: 'document', entityId: d.id,
    payload: { docType: b.docType, title: b.title.trim(), siteId, equipmentId: b.equipmentId } });
  return { id: d.id };
}

async function loadDoc(tx: Tx, p: Principal, companyId: string, id: string, action: 'document.read' | 'document.write' | 'document.review') {
  const d = (await tx.query(`SELECT d.*, s.name AS site_name, eq.name AS equipment_name FROM documents d LEFT JOIN sites s ON s.id = d.site_id
     LEFT JOIN equipment eq ON eq.id = d.equipment_id WHERE d.id = $1 AND d.company_id = $2`, [id, companyId])).rows[0];
  if (!d || !(await canReadDoc(tx, p, companyId, d))) throw notFound('Belge');
  if (action !== 'document.read' && !can(p, action, { companyId, siteId: d.site_id }).ok) throw forbidden();
  return d;
}

export async function getDocument(tx: Tx, p: Principal, companyId: string, id: string) {
  const d = await loadDoc(tx, p, companyId, id, 'document.read');
  const versions = (await tx.query(`${VERSIONS_SQL} WHERE v.document_id = $1 ORDER BY v.version DESC`, [id])).rows;
  const st = documentStatus(versions, day(new Date()));
  const review = can(p, 'document.review', { companyId, siteId: d.site_id }).ok;
  const write = can(p, 'document.write', { companyId, siteId: d.site_id }).ok;
  const shares = d.site_id ? [] : (await tx.query(`SELECT sh.id, sh.site_id, s.name AS site_name, sh.granted_at, u.display_name AS granted_by_name FROM document_shares sh
     JOIN sites s ON s.id = sh.site_id JOIN users u ON u.id = sh.granted_by WHERE sh.document_id = $1 AND sh.revoked_at IS NULL ORDER BY s.name`, [id])).rows;
  return {
    id: d.id, docType: d.doc_type, title: d.title, issuer: d.issuer, documentNo: d.document_no, siteId: d.site_id, siteName: d.site_name,
    equipmentId: d.equipment_id, equipmentName: d.equipment_name, createdAt: d.created_at,
    status: st.status, expiring: st.expiring, notYetValid: st.notYetValid,
    issuerCheck: issuerCheckOf(st.current),
    currentVersionId: st.current?.id ?? null, validFrom: st.current?.valid_from ?? null, validUntil: st.current?.valid_until ?? null,
    shares, maxUploadBytes: MAX_UPLOAD_BYTES.value, uses: await documentUses(tx, id),
    expiryWarningDays: EXPIRY_WARNING_DAYS,
    versions: versions.map(v => ({ ...v,
      canRecordIssuerCheck: review && v.review_status === 'verified' && !v.issuer_check_method,
      canRetryUpload: write && v.file_status === 'pending_upload' && v.uploaded_by === p.userId,
      canReview: review && v.review_status === 'unreviewed' && v.file_status === 'stored' && v.uploaded_by !== p.userId,
      reviewBlockedReason: review && v.review_status === 'unreviewed' && v.uploaded_by === p.userId ? 'Belgeyi sen yükledin; başka bir yetkili incelemeli.'
        : review && v.review_status === 'unreviewed' && v.file_status !== 'stored' ? 'Dosya henüz yüklenmedi.' : null })),
    permissions: { write, review, share: write && !d.site_id },
  };
}

export type VersionInput = { validFrom: string | null; validUntil: string | null; notes: string | null; file: { mime: string; sha256: string; sizeBytes: number } };

/**
 * A new version: dates as the uploader reads them from the document, and the file (registered with
 * the device's hash, uploaded separately). It waits for review; the keepers are told.
 */
export async function addVersion(tx: Tx, p: Principal, companyId: string, id: string, b: VersionInput) {
  const d = await loadDoc(tx, p, companyId, id, 'document.write');
  if (d.archived_at) throw conflict('DOCUMENT_ARCHIVED', 'Arşivlenmiş belgeye sürüm eklenmez.');
  if (b.validFrom && b.validUntil && b.validUntil < b.validFrom) throw invalid('Geçerlilik bitişi başlangıçtan önce olamaz.');
  if (!ALLOWED_MIME.includes(b.file.mime)) throw invalid(`Dosya türü kabul edilmiyor: ${b.file.mime}`);
  if (!/^[0-9a-f]{64}$/.test(b.file.sha256)) throw invalid('sha256 64 karakterlik onaltılık özet olmalı.');
  await tx.query(`SELECT 1 FROM documents WHERE id = $1 FOR UPDATE`, [id]);
  const next = (await tx.query<{ n: number }>(`SELECT COALESCE(max(version), 0) + 1 AS n FROM document_versions WHERE document_id = $1`, [id])).rows[0]!.n;
  const v = (await tx.query<{ id: string }>(
    `INSERT INTO document_versions (company_id, document_id, version, valid_from, valid_until, notes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [companyId, id, next, b.validFrom, b.validUntil, b.notes?.trim() || null, p.userId])).rows[0]!;
  const ev = (await tx.query<{ id: string }>(
    `INSERT INTO evidence (company_id, document_version_id, kind, status, mime, declared_sha256, size_bytes, created_by)
     VALUES ($1,$2,'document','pending_upload',$3,$4,$5,$6) RETURNING id`,
    [companyId, v.id, b.file.mime, b.file.sha256, b.file.sizeBytes, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.version_added', entityType: 'document', entityId: id,
    payload: { versionId: v.id, version: next, validFrom: b.validFrom, validUntil: b.validUntil, evidenceId: ev.id, sha256: b.file.sha256 } });
  await notify(tx, { companyId, siteId: d.site_id, userIds: await keepers(tx, companyId, d.site_id), except: p.userId, kind: 'doc_review_needed',
    entityType: 'document', entityId: id, dedupeKey: `doc_review_needed:${v.id}`,
    title: 'Yeni belge sürümü incelemeni bekliyor', body: `${d.title} · sürüm ${next}. Yüklenmiş olması geçerli olduğu anlamına gelmez.` });
  return { versionId: v.id, version: next, evidenceId: ev.id };
}

/**
 * Review by someone other than the uploader, after the file arrived. The reviewer confirms (or
 * corrects) the dates as printed on the document. Rejected versions stay in the history.
 */
export async function reviewVersion(tx: Tx, p: Principal, companyId: string, id: string, versionId: string,
  b: { decision: 'verified' | 'rejected'; notes: string; validFrom?: string | null; validUntil?: string | null }) {
  const d = await loadDoc(tx, p, companyId, id, 'document.review');
  const v = (await tx.query(`${VERSIONS_SQL} WHERE v.id = $1 AND v.document_id = $2 FOR UPDATE OF v`, [versionId, id])).rows[0];
  if (!v) throw notFound('Sürüm');
  if (v.review_status !== 'unreviewed') throw conflict('ALREADY_REVIEWED', 'Bu sürüm zaten incelendi.');
  if (v.uploaded_by === p.userId) throw new AppError(422, 'REVIEWER_IS_UPLOADER', 'Belgeyi yükleyen kişi inceleyemez; başka bir yetkili incelemeli.');
  if (v.file_status !== 'stored') throw new AppError(422, 'FILE_MISSING', 'Dosya yüklenmeden belge incelenemez.');
  if (b.notes.trim().length < 5) throw invalid('Neyi kontrol ettiğini yaz (en az birkaç kelime).');
  const validFrom = b.validFrom !== undefined ? b.validFrom : v.valid_from;
  const validUntil = b.validUntil !== undefined ? b.validUntil : v.valid_until;
  if (validFrom && validUntil && validUntil < validFrom) throw invalid('Geçerlilik bitişi başlangıçtan önce olamaz.');
  await tx.query(`UPDATE document_versions SET review_status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(), review_notes = $4, valid_from = $5, valid_until = $6
     WHERE id = $1`, [versionId, b.decision, p.userId, b.notes.trim(), validFrom, validUntil]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.decision === 'verified' ? 'document.version_verified' : 'document.version_rejected',
    entityType: 'document', entityId: id, payload: { versionId, version: v.version, notes: b.notes.trim(), validFrom, validUntil,
      datesChanged: validFrom !== v.valid_from || validUntil !== v.valid_until } });
  await notify(tx, { companyId, siteId: d.site_id, userIds: [v.uploaded_by], except: p.userId, kind: b.decision === 'verified' ? 'doc_verified' : 'doc_rejected',
    entityType: 'document', entityId: id, dedupeKey: `doc_reviewed:${versionId}`,
    title: b.decision === 'verified' ? 'Belge incelendi ve doğrulandı' : 'Belge kabul edilmedi', body: `${d.title} · ${b.notes.trim()}` });
  return { status: b.decision };
}

/**
 * Daily/hourly scan: a verified document's end date within the warning window, and past it.
 * Each is announced once per version (the dedupe key carries the version and the date).
 */
export async function scanDocumentExpiry(db: Db, now = new Date()) {
  const companies = await db.system(async tx => (await tx.query<{ id: string }>(`SELECT DISTINCT company_id AS id FROM documents WHERE archived_at IS NULL`)).rows.map(r => r.id));
  const today = day(now);
  let created = 0;
  for (const companyId of companies) {
    created += await db.tenant(companyId, async tx => {
      const docs = (await tx.query(`SELECT id, site_id, title FROM documents WHERE company_id = $1 AND archived_at IS NULL`, [companyId])).rows;
      let c = 0;
      for (const d of docs) {
        const vs = (await tx.query(`${VERSIONS_SQL} WHERE v.document_id = $1`, [d.id])).rows;
        const st = documentStatus(vs, today);
        if (!st.current || (!st.expiring && st.status !== 'expired')) continue;
        // A renewal already uploaded and waiting: still announce, the old one is what counts until reviewed.
        const expired = st.status === 'expired';
        c += await notify(tx, { companyId, siteId: d.site_id, userIds: await keepers(tx, companyId, d.site_id),
          kind: expired ? 'doc_expired' : 'doc_expiring', entityType: 'document', entityId: d.id,
          dedupeKey: `${expired ? 'doc_expired' : 'doc_expiring'}:${st.current.id}:${st.current.valid_until}`,
          title: expired ? 'Belgenin süresi doldu' : `Belgenin süresi ${EXPIRY_WARNING_DAYS} gün içinde doluyor`,
          body: `${d.title} · geçerlilik sonu ${st.current.valid_until}${st.pending ? ' · yeni sürüm incelemede' : ''}` });
      }
      return c;
    });
  }
  return { created };
}

/** Upload limit, set from the server configuration at start (shown before a file is picked). */
export const MAX_UPLOAD_BYTES = { value: 10 * 1024 * 1024 };

export const ISSUER_METHODS = ['barcode_query', 'issuer_portal', 'issuer_written_confirmation', 'other'] as const;

/**
 * Records HOW a reviewed document was confirmed with its issuer (e.g. barcode query on the
 * issuer's site, written confirmation). The app does not query any authority itself; this is a
 * person's record with method and reference, shown as such.
 */
export async function recordIssuerCheck(tx: Tx, p: Principal, companyId: string, id: string, versionId: string,
  b: { method: typeof ISSUER_METHODS[number]; reference: string; notes: string | null }) {
  const d = await loadDoc(tx, p, companyId, id, 'document.review');
  const v = (await tx.query(`SELECT * FROM document_versions WHERE id = $1 AND document_id = $2 FOR UPDATE`, [versionId, id])).rows[0];
  if (!v) throw notFound('Sürüm');
  if (v.review_status !== 'verified') throw new AppError(422, 'NOT_REVIEWED', 'Önce kurum içi inceleme yapılmalı.');
  if (v.issuer_check_method) throw conflict('ALREADY_CHECKED', 'Bu sürüm için kurum doğrulaması zaten kayıtlı.');
  if (b.reference.trim().length < 3) throw invalid('Doğrulamanın referansını yaz (ör. barkod no, yazı tarihi ve sayısı).');
  await tx.query(`UPDATE document_versions SET issuer_check_method = $2, issuer_check_ref = $3, issuer_check_notes = $4, issuer_checked_by = $5, issuer_checked_at = clock_timestamp()
     WHERE id = $1`, [versionId, b.method, b.reference.trim(), b.notes?.trim() || null, p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.issuer_checked', entityType: 'document', entityId: id,
    payload: { versionId, method: b.method, reference: b.reference.trim(), notes: b.notes?.trim() || null } });
  return { status: 'issuer_verified', title: d.title as string };
}

/** Lets a site read a company-wide document (read only; no change or review). Revocable, kept in history. */
export async function shareDocument(tx: Tx, p: Principal, companyId: string, id: string, b: { siteId: string; share: boolean }) {
  const d = await loadDoc(tx, p, companyId, id, 'document.write');
  if (d.site_id) throw invalid('Yalnızca işletme geneli belgeler şubelerle paylaşılır.');
  if (!(await tx.query(`SELECT 1 FROM sites WHERE id = $1 AND company_id = $2`, [b.siteId, companyId])).rowCount) throw invalid('Şube bu işletmeye ait değil.');
  const live = (await tx.query(`SELECT id FROM document_shares WHERE document_id = $1 AND site_id = $2 AND revoked_at IS NULL FOR UPDATE`, [id, b.siteId])).rows[0];
  if (b.share && !live) {
    await tx.query(`INSERT INTO document_shares (company_id, document_id, site_id, granted_by) VALUES ($1,$2,$3,$4)`, [companyId, id, b.siteId, p.userId]);
  } else if (!b.share && live) {
    await tx.query(`UPDATE document_shares SET revoked_at = clock_timestamp(), revoked_by = $2 WHERE id = $1`, [live.id, p.userId]);
  } else return { changed: false };
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.share ? 'document.shared' : 'document.unshared', entityType: 'document', entityId: id, payload: { siteId: b.siteId } });
  return { changed: true };
}

const LINK_KIND_TR: Record<string, string> = { task_template: 'Kontrol', equipment: 'Ekipman', obligation: 'Yükümlülük' };

/** What a document is used for, with names resolved. Removed uses are not listed (they stay in the history). */
export async function documentUses(tx: Tx, documentId: string) {
  const rows = (await tx.query(`SELECT l.id, l.link_kind, l.ref, l.purpose, l.created_at, u.display_name AS created_by_name FROM document_links l JOIN users u ON u.id = l.created_by
     WHERE l.document_id = $1 AND l.removed_at IS NULL ORDER BY l.created_at`, [documentId])).rows;
  const out = [];
  for (const r of rows) {
    const name = r.link_kind === 'task_template' ? (await tx.query(`SELECT tt.title FROM task_templates tt JOIN rule_versions rv ON rv.id = tt.rule_version_id WHERE tt.code = $1 ORDER BY rv.version DESC LIMIT 1`, [r.ref])).rows[0]?.title
      : r.link_kind === 'equipment' ? (await tx.query(`SELECT name FROM equipment WHERE id::text = $1`, [r.ref])).rows[0]?.name
      : (await tx.query(`SELECT rv.obligation_title AS t FROM rules ru JOIN rule_versions rv ON rv.rule_id = ru.id WHERE ru.code = $1 ORDER BY rv.version DESC LIMIT 1`, [r.ref])).rows[0]?.t;
    out.push({ id: r.id, kind: r.link_kind, kindLabel: LINK_KIND_TR[r.link_kind], ref: r.ref, name: name ?? r.ref, purpose: r.purpose, createdBy: r.created_by_name, createdAt: r.created_at });
  }
  return out;
}

export async function linkDocument(tx: Tx, p: Principal, companyId: string, id: string, b: { op: 'add' | 'remove'; kind?: 'task_template' | 'equipment' | 'obligation'; ref?: string; purpose?: string; linkId?: string }) {
  const d = await loadDoc(tx, p, companyId, id, 'document.write');
  if (b.op === 'remove') {
    const r = await tx.query(`UPDATE document_links SET removed_by = $3, removed_at = clock_timestamp() WHERE id = $1 AND document_id = $2 AND removed_at IS NULL`, [b.linkId, id, p.userId]);
    if (!r.rowCount) throw notFound('Kullanım');
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.use_removed', entityType: 'document', entityId: id, payload: { linkId: b.linkId } });
    return { ok: true };
  }
  if (!b.kind || !b.ref) throw invalid('Neye bağlanacağını seç.');
  if ((b.purpose ?? '').trim().length < 5) throw invalid('Belgenin bu iş için hangi amaçla kullanıldığını yaz.');
  if (b.kind === 'equipment') {
    const e = (await tx.query(`SELECT site_id FROM equipment WHERE id::text = $1 AND company_id = $2`, [b.ref, companyId])).rows[0];
    if (!e || (d.site_id && e.site_id !== d.site_id)) throw invalid('Ekipman bu belgenin şubesinde değil.');
  } else if (b.kind === 'task_template') {
    if (!(await tx.query(`SELECT 1 FROM task_templates WHERE code = $1`, [b.ref])).rowCount) throw invalid('Bilinmeyen kontrol.');
  } else if (!(await tx.query(`SELECT 1 FROM rules WHERE code = $1`, [b.ref])).rowCount) throw invalid('Bilinmeyen yükümlülük.');
  try {
    const r = (await tx.query<{ id: string }>(`INSERT INTO document_links (company_id, document_id, link_kind, ref, purpose, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [companyId, id, b.kind, b.ref, b.purpose!.trim(), p.userId])).rows[0]!;
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.use_added', entityType: 'document', entityId: id, payload: { kind: b.kind, ref: b.ref, purpose: b.purpose!.trim() } });
    return { id: r.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('ALREADY_LINKED', 'Bu belge buna zaten bağlı.');
    throw e;
  }
}

/** Documents a check uses (by its template or its equipment), readable by this person. */
export async function documentsForTask(tx: Tx, p: Principal, companyId: string, t: { template_code: string; equipment_id: string | null; rule_code?: string | null }) {
  const rows = (await tx.query(`SELECT DISTINCT d.id, d.site_id, d.title, l.purpose, l.link_kind FROM document_links l JOIN documents d ON d.id = l.document_id
     WHERE l.company_id = $1 AND l.removed_at IS NULL AND d.archived_at IS NULL
       AND ((l.link_kind = 'task_template' AND l.ref = $2) OR (l.link_kind = 'equipment' AND l.ref = $3) OR (l.link_kind = 'obligation' AND l.ref = $4))`,
    [companyId, t.template_code, t.equipment_id ?? '', t.rule_code ?? ''])).rows;
  const out = [];
  for (const r of rows) if (await canReadDoc(tx, p, companyId, r)) out.push({ id: r.id, title: r.title, purpose: r.purpose, kind: r.link_kind });
  return out;
}

/** What a document can be tied to: checks in use at its site(s), equipment of its site, obligations. */
export async function useChoices(tx: Tx, p: Principal, companyId: string, id: string) {
  const d = await loadDoc(tx, p, companyId, id, 'document.write');
  const templates = (await tx.query(`SELECT DISTINCT ON (t.template_code) t.template_code AS code, tt.title FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     WHERE t.company_id = $1 AND ($2::uuid IS NULL OR t.site_id = $2) ORDER BY t.template_code, t.due_at DESC`, [companyId, d.site_id])).rows;
  const equipment = (await tx.query(`SELECT id, name FROM equipment WHERE company_id = $1 AND ($2::uuid IS NULL OR site_id = $2) AND active ORDER BY name`, [companyId, d.site_id])).rows;
  const obligations = (await tx.query(`SELECT DISTINCT r.code, rv.obligation_title AS title FROM obligations o JOIN rules r ON r.id = o.rule_id JOIN rule_versions rv ON rv.id = o.rule_version_id
     WHERE o.company_id = $1 AND ($2::uuid IS NULL OR o.site_id = $2) AND o.decision = 'applies' ORDER BY r.code`, [companyId, d.site_id])).rows;
  return { templates, equipment, obligations };
}
