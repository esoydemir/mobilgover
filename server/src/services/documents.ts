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

export type DocStatus = 'no_file' | 'file_pending' | 'awaiting_review' | 'rejected' | 'not_yet_valid' | 'valid' | 'expiring' | 'expired';

type VersionRow = { id: string; version: number; review_status: 'unreviewed' | 'verified' | 'rejected'; valid_from: string | null; valid_until: string | null; file_status: string | null };

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => day(new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000));

/**
 * The document's state. Validity comes only from the newest VERIFIED version; a newer version
 * waiting for review is shown separately and does not make the document valid by itself.
 */
export function documentStatus(versions: VersionRow[], today: string): { status: DocStatus; current: VersionRow | null; pending: VersionRow | null } {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const current = sorted.find(v => v.review_status === 'verified') ?? null;
  const latest = sorted[0] ?? null;
  const pending = latest && latest !== current && latest.review_status === 'unreviewed' ? latest : null;
  if (current) {
    if (current.valid_from && current.valid_from > today) return { status: 'not_yet_valid', current, pending };
    if (current.valid_until && current.valid_until < today) return { status: 'expired', current, pending };
    if (current.valid_until && current.valid_until <= addDays(today, EXPIRY_WARNING_DAYS)) return { status: 'expiring', current, pending };
    return { status: 'valid', current, pending };
  }
  if (!latest) return { status: 'no_file', current, pending };
  if (latest.file_status !== 'stored') return { status: 'file_pending', current, pending };
  return { status: latest.review_status === 'rejected' ? 'rejected' : 'awaiting_review', current, pending };
}

/** People who keep a document: owner/HQ for company-wide ones, plus the site manager for a site's. */
async function keepers(tx: Tx, companyId: string, siteId: string | null): Promise<string[]> {
  if (siteId) return siteManagers(tx, companyId, siteId);
  return (await tx.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM memberships WHERE company_id = $1 AND status = 'active'
     AND site_id IS NULL AND role IN ('owner','hq_manager')`, [companyId])).rows.map(r => r.user_id);
}

const VERSIONS_SQL = `SELECT v.id, v.document_id, v.version, v.valid_from::text AS valid_from, v.valid_until::text AS valid_until, v.notes, v.review_status,
     v.reviewed_by, v.reviewed_at, v.review_notes, v.uploaded_by, v.uploaded_at, uu.display_name AS uploaded_by_name, ru.display_name AS reviewed_by_name,
     e.id AS evidence_id, e.status AS file_status, e.mime, e.rejection_reason AS file_rejection
   FROM document_versions v JOIN users uu ON uu.id = v.uploaded_by LEFT JOIN users ru ON ru.id = v.reviewed_by
   LEFT JOIN LATERAL (SELECT * FROM evidence x WHERE x.document_version_id = v.id ORDER BY x.created_at DESC LIMIT 1) e ON true`;

export async function listDocuments(tx: Tx, p: Principal, companyId: string, f: { siteId?: string | null; equipmentId?: string | null } = {}) {
  const docs = (await tx.query(
    `SELECT d.*, s.name AS site_name, eq.name AS equipment_name FROM documents d LEFT JOIN sites s ON s.id = d.site_id LEFT JOIN equipment eq ON eq.id = d.equipment_id
      WHERE d.company_id = $1 AND d.archived_at IS NULL AND ($2::uuid IS NULL OR d.site_id = $2) AND ($3::uuid IS NULL OR d.equipment_id = $3)
      ORDER BY d.created_at`, [companyId, f.siteId ?? null, f.equipmentId ?? null])).rows
    .filter(d => can(p, 'document.read', { companyId, siteId: d.site_id }).ok);
  if (!docs.length) return [];
  const versions = (await tx.query(`${VERSIONS_SQL} WHERE v.document_id = ANY($1)`, [docs.map(d => d.id)])).rows;
  const today = day(new Date());
  return docs.map(d => {
    const vs = versions.filter(v => v.document_id === d.id);
    const st = documentStatus(vs, today);
    return { id: d.id, docType: d.doc_type, title: d.title, issuer: d.issuer, documentNo: d.document_no, siteId: d.site_id, siteName: d.site_name,
      equipmentId: d.equipment_id, equipmentName: d.equipment_name, status: st.status,
      validUntil: st.current?.valid_until ?? null, validFrom: st.current?.valid_from ?? null, versionCount: vs.length, pendingReview: !!st.pending || st.status === 'awaiting_review' };
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
  if (!d || !can(p, 'document.read', { companyId, siteId: d.site_id }).ok) throw notFound('Belge');
  if (!can(p, action, { companyId, siteId: d.site_id }).ok) throw forbidden();
  return d;
}

export async function getDocument(tx: Tx, p: Principal, companyId: string, id: string) {
  const d = await loadDoc(tx, p, companyId, id, 'document.read');
  const versions = (await tx.query(`${VERSIONS_SQL} WHERE v.document_id = $1 ORDER BY v.version DESC`, [id])).rows;
  const st = documentStatus(versions, day(new Date()));
  const review = can(p, 'document.review', { companyId, siteId: d.site_id }).ok;
  return {
    id: d.id, docType: d.doc_type, title: d.title, issuer: d.issuer, documentNo: d.document_no, siteId: d.site_id, siteName: d.site_name,
    equipmentId: d.equipment_id, equipmentName: d.equipment_name, createdAt: d.created_at,
    status: st.status, currentVersionId: st.current?.id ?? null, validFrom: st.current?.valid_from ?? null, validUntil: st.current?.valid_until ?? null,
    expiryWarningDays: EXPIRY_WARNING_DAYS,
    versions: versions.map(v => ({ ...v,
      canReview: review && v.review_status === 'unreviewed' && v.file_status === 'stored' && v.uploaded_by !== p.userId,
      reviewBlockedReason: review && v.review_status === 'unreviewed' && v.uploaded_by === p.userId ? 'Belgeyi sen yükledin; başka bir yetkili incelemeli.'
        : review && v.review_status === 'unreviewed' && v.file_status !== 'stored' ? 'Dosya henüz yüklenmedi.' : null })),
    permissions: { write: can(p, 'document.write', { companyId, siteId: d.site_id }).ok, review },
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
        if (!st.current || (st.status !== 'expiring' && st.status !== 'expired')) continue;
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
