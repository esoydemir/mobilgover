import type { Db, Tx } from '../db/pool';
import { AppError, conflict, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { contentMatchesMime, sha256Hex, type EvidenceStore } from '../storage/local';
import { appendAudit } from './audit';

/**
 * Second half of an upload. The bytes are hashed on the server; only a match
 * with the hash declared at registration turns the evidence into `stored`.
 * A mismatch or a wrong file type is recorded as `rejected`, never silently fixed.
 */
export async function uploadContent(db: Db, store: EvidenceStore, p: Principal, companyId: string, evidenceId: string, bytes: Buffer) {
  const ev = await db.tenant(companyId, async tx => {
    const r = (await tx.query(
      `SELECT e.*, t.site_id, t.assignee_id FROM evidence e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.id = $1 AND e.company_id = $2`,
      [evidenceId, companyId])).rows[0];
    if (!r) throw notFound('Kanıt');
    // Task evidence: whoever may do the task. Action and document evidence: only the person who
    // registered it (they were authorised at registration), so nobody else can fill in their file.
    const ok = r.task_id ? can(p, 'task.execute', { companyId, siteId: r.site_id, assigneeId: r.assignee_id }).ok : r.created_by === p.userId;
    if (!ok) throw notFound('Kanıt');
    return r;
  });
  // The details tell a client whose earlier answer was lost what actually happened.
  if (ev.status !== 'pending_upload') throw conflict('EVIDENCE_NOT_PENDING', `Bu kanıt zaten ${ev.status === 'stored' ? 'kaydedilmiş' : 'reddedilmiş'}.`,
    { status: ev.status, sha256: ev.sha256, reason: ev.rejection_reason });

  const actual = sha256Hex(bytes);
  let rejection: string | null = null;
  if (actual !== ev.declared_sha256) rejection = 'Yüklenen dosyanın özeti beyan edilen özetle eşleşmiyor (yarım veya değişmiş yükleme).';
  else if (ev.size_bytes != null && Number(ev.size_bytes) !== bytes.length) rejection = 'Dosya boyutu beyan edilenle eşleşmiyor.';
  else if (!contentMatchesMime(ev.mime, bytes)) rejection = 'Dosya içeriği bildirilen türle uyuşmuyor.';

  const key = `${companyId}/${evidenceId}`;
  if (!rejection) {
    try { await store.put(key, bytes); } catch (e) {
      // An earlier attempt wrote the file but did not get to record it (crash, lost connection).
      // Identical bytes are accepted; different bytes under the same key are never overwritten.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const existing = await store.get(key);
      if (!existing || sha256Hex(existing) !== actual) throw conflict('EVIDENCE_FILE_CONFLICT', 'Bu kanıt için farklı içerikte bir dosya zaten var; kayıt değiştirilmedi.');
    }
  }

  await db.tenant(companyId, async tx => {
    const upd = await tx.query(
      `UPDATE evidence SET status = $3, sha256 = $4, storage_key = $5, stored_at = clock_timestamp(), rejection_reason = $6
        WHERE id = $1 AND company_id = $2 AND status = 'pending_upload' RETURNING status`,
      [evidenceId, companyId, rejection ? 'rejected' : 'stored', actual, rejection ? null : key, rejection]);
    if (!upd.rowCount) throw conflict('EVIDENCE_NOT_PENDING', 'Kanıt aynı anda başka bir yüklemeyle güncellendi.');
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: rejection ? 'evidence.rejected' : 'evidence.stored', entityType: 'evidence',
      entityId: evidenceId, payload: { sha256: actual, size: bytes.length, reason: rejection } });
  });
  // Thrown after commit, so the rejection itself stays on record.
  if (rejection) throw new AppError(422, 'UPLOAD_REJECTED', rejection, { evidenceId, sha256: actual });
  return { id: evidenceId, status: 'stored', sha256: actual };
}

export type FileCheck = { evidenceId: string; status: 'intact' | 'modified' | 'missing' };

/** Re-hashes stored files and compares them with the recorded digest. */
export async function verifyStoredFiles(tx: Tx, store: EvidenceStore, companyId: string, taskIds?: string[]): Promise<FileCheck[]> {
  const rows = (await tx.query(
    `SELECT id, sha256, storage_key FROM evidence
      WHERE company_id = $1 AND status = 'stored' AND storage_key IS NOT NULL AND ($2::uuid[] IS NULL OR task_id = ANY($2))`,
    [companyId, taskIds ?? null])).rows;
  const out: FileCheck[] = [];
  for (const r of rows) {
    const bytes = await store.get(r.storage_key);
    out.push({ evidenceId: r.id, status: !bytes ? 'missing' : sha256Hex(bytes) === r.sha256 ? 'intact' : 'modified' });
  }
  return out;
}

/**
 * Reads a stored file for someone allowed to see what it belongs to: a task (task.read),
 * a nonconformity action (ncr.read on the case) or a document version (document.read).
 */
export async function readContent(db: Db, store: EvidenceStore, p: Principal, companyId: string, evidenceId: string) {
  const ev = await db.tenant(companyId, async tx => {
    const r = (await tx.query(
      `SELECT e.id, e.status, e.mime, e.storage_key, e.sha256, e.task_id, e.ncr_id, e.action_id, e.document_version_id,
              t.site_id AS task_site, t.assignee_id AS task_assignee, n.site_id AS ncr_site, n.owner_id AS ncr_owner, d.site_id AS doc_site
         FROM evidence e LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN nonconformities n ON n.id = e.ncr_id
         LEFT JOIN document_versions v ON v.id = e.document_version_id LEFT JOIN documents d ON d.id = v.document_id
        WHERE e.id = $1 AND e.company_id = $2`, [evidenceId, companyId])).rows[0];
    if (!r) throw notFound('Kanıt');
    let ok = false;
    if (r.task_id) ok = can(p, 'task.read', { companyId, siteId: r.task_site, assigneeId: r.task_assignee }).ok;
    else if (r.ncr_id) {
      const holds = (await tx.query(`SELECT 1 FROM ncr_actions WHERE ncr_id = $1 AND owner_id = $2 LIMIT 1`, [r.ncr_id, p.userId])).rowCount;
      ok = can(p, 'ncr.read', { companyId, siteId: r.ncr_site, assigneeId: r.ncr_owner === p.userId || holds ? p.userId : r.ncr_owner }).ok;
    } else if (r.document_version_id) ok = can(p, 'document.read', { companyId, siteId: r.doc_site }).ok;
    if (!ok) throw notFound('Kanıt');
    return r;
  });
  if (ev.status !== 'stored' || !ev.storage_key) throw conflict('EVIDENCE_NOT_STORED', 'Bu kanıtın dosyası yok (yüklenmedi ya da reddedildi).');
  const bytes = await store.get(ev.storage_key);
  if (!bytes) throw notFound('Kanıt dosyası');
  return { mime: ev.mime as string, bytes, sha256: ev.sha256 as string };
}
