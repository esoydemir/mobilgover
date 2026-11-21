import type { Tx } from '../db/pool';
import { conflict, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { loadNonconformity } from './nonconformities';

/**
 * Services of the same branch and equipment that belong to another case of this equipment and have a report, split into those already linked to this
 * case and those that could be. Managers only (linking is a management act).
 */
export async function caseServiceLinks(tx: Tx, p: Principal, companyId: string, n: { id: string; site_id: string; equipment_id: string | null; status: string }) {
  const empty = { linked: [] as any[], linkable: [] as any[] };
  if (!n.equipment_id || !can(p, 'ncr.manage', { companyId, siteId: n.site_id, recordId: n.id }).ok) return empty;
  const linked = (await tx.query(
    `SELECT l.id, l.job_id, l.document_id, l.version_number, l.basis, l.linked_at, u.display_name AS linked_by, sr.title AS request_title, sn.title AS source_case_title, l.source_ncr_id
       FROM service_case_links l JOIN users u ON u.id = l.linked_by JOIN service_jobs j ON j.id = l.job_id JOIN service_requests sr ON sr.id = j.request_id
       LEFT JOIN nonconformities sn ON sn.id = l.source_ncr_id WHERE l.company_id = $1 AND l.ncr_id = $2 ORDER BY l.linked_at`, [companyId, n.id])).rows;
  const linkable = n.status === 'closed' ? [] : (await tx.query(
    `SELECT j.id AS job_id, sr.id AS request_id, sr.title AS request_title, sr.created_at AS request_created_at, sn.id AS source_case_id, sn.title AS source_case_title,
            d.id AS document_id, max(v.version) AS version, max(v.uploaded_at) AS uploaded_at
       FROM service_jobs j JOIN service_requests sr ON sr.id = j.request_id JOIN documents d ON d.service_job_id = j.id JOIN document_versions v ON v.document_id = d.id
       LEFT JOIN nonconformities sn ON sn.id = sr.ncr_id
      WHERE j.company_id = $1 AND sr.site_id = $2 AND sr.status <> 'cancelled' AND j.status <> 'cancelled' AND sr.ncr_id IS DISTINCT FROM $3
        AND sn.equipment_id = $4 AND NOT EXISTS (SELECT 1 FROM service_case_links l WHERE l.ncr_id = $3 AND l.job_id = j.id)
      GROUP BY j.id, sr.id, sn.id, d.id ORDER BY sr.created_at DESC`, [companyId, n.site_id, n.id, n.equipment_id])).rows;
  return { linked, linkable };
}

/**
 * An authorised person says that a service job already done for another case of the same equipment also covers this case. Source case, target case,
 * service job, report version at this moment, the person and the basis are recorded. Only then can that report be the required evidence of a task.
 */
export async function linkServiceToCase(tx: Tx, p: Principal, companyId: string, ncrId: string, b: { jobId: string; basis: string }) {
  const n = await loadNonconformity(tx, p, companyId, ncrId, 'ncr.manage', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapanmış vakaya servis ilişkilendirilemez.');
  if (!n.equipment_id) throw invalid('Bu vakada ekipman yok; servis ilişkilendirilemez.');
  const basis = b.basis.trim();
  if (basis.length < 15) throw invalid('Dayanağı yaz (en az 15 karakter): servis bu vakanın arızasını da kapsıyor mu, nasıl biliniyor?');
  const j = (await tx.query(
    `SELECT j.id, sr.site_id, sr.ncr_id AS source_ncr_id, sn.equipment_id AS source_equipment, d.id AS document_id,
            (SELECT v.id FROM document_versions v WHERE v.document_id = d.id ORDER BY v.version DESC LIMIT 1) AS version_id,
            (SELECT max(v.version) FROM document_versions v WHERE v.document_id = d.id) AS version
       FROM service_jobs j JOIN service_requests sr ON sr.id = j.request_id LEFT JOIN nonconformities sn ON sn.id = sr.ncr_id
       LEFT JOIN documents d ON d.service_job_id = j.id WHERE j.id = $1 AND j.company_id = $2`, [b.jobId, companyId])).rows[0];
  if (!j) throw notFound('Servis işi');
  if (j.site_id !== n.site_id) throw invalid('Servis başka bir şubeye ait; bu vakayla ilişkilendirilemez.');
  if (j.source_ncr_id === n.id) throw conflict('SERVICE_OWN_CASE', 'Bu servis zaten bu vakadan açılmış.');
  if (!j.source_ncr_id || j.source_equipment !== n.equipment_id) throw invalid('Servis bu vakayla aynı ekipmanın başka bir vakasından açılmış olmalı.');
  if (!j.document_id || !j.version_id) throw conflict('SERVICE_NO_REPORT', 'Serviste henüz rapor yok; rapor gelince ilişkilendir.');
  if ((await tx.query(`SELECT 1 FROM service_case_links WHERE ncr_id = $1 AND job_id = $2`, [n.id, j.id])).rowCount) throw conflict('SERVICE_ALREADY_LINKED', 'Bu servis bu vakayla zaten ilişkilendirilmiş.');
  const id = (await tx.query<{ id: string }>(
    `INSERT INTO service_case_links (company_id, ncr_id, job_id, source_ncr_id, document_id, document_version_id, version_number, linked_by, basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [companyId, n.id, j.id, j.source_ncr_id, j.document_id, j.version_id, j.version, p.userId, basis])).rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.service_linked', entityType: 'nonconformity', entityId: n.id,
    payload: { linkId: id, targetCaseId: n.id, sourceCaseId: j.source_ncr_id, jobId: j.id, documentId: j.document_id, versionId: j.version_id, version: j.version, basis } });
  return { id, version: j.version };
}
