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
    if (!r || !can(p, 'task.execute', { companyId, siteId: r.site_id, assigneeId: r.assignee_id }).ok) throw notFound('Kanıt');
    return r;
  });
  if (ev.status !== 'pending_upload') throw conflict('EVIDENCE_NOT_PENDING', `Bu kanıt zaten ${ev.status} durumunda.`);

  const actual = sha256Hex(bytes);
  let rejection: string | null = null;
  if (actual !== ev.declared_sha256) rejection = 'Yüklenen dosyanın özeti beyan edilen özetle eşleşmiyor (yarım veya değişmiş yükleme).';
  else if (ev.size_bytes != null && Number(ev.size_bytes) !== bytes.length) rejection = 'Dosya boyutu beyan edilenle eşleşmiyor.';
  else if (!contentMatchesMime(ev.mime, bytes)) rejection = 'Dosya içeriği bildirilen türle uyuşmuyor.';

  const key = `${companyId}/${evidenceId}`;
  if (!rejection) await store.put(key, bytes);

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
