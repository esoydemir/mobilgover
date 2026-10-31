import type { Tx } from '../db/pool';
import { AppError, forbidden, invalid } from '../domain/errors';
import type { Principal } from '../domain/permissions';
import { appendAudit } from './audit';

/**
 * Retention matrix per record type. Periods are proposed by one person and
 * approved by another, with a legal basis. This code never deletes records:
 * deletion jobs will only read periods with status 'approved'.
 */
const admin = (p: Principal) => { if (!p.platformRoles.includes('platform_admin')) throw forbidden(); };

export async function listRetention(tx: Tx, p: Principal) {
  admin(p);
  return (await tx.query(`SELECT * FROM retention_policies ORDER BY record_type`)).rows.map(r => ({
    ...r, automaticDeletion: false,
    note: r.status === 'approved' ? 'Onaylı süre. Otomatik silme işi henüz yok; silme ayrı bir onaylı iş gerektirir.' : 'Süre onaylanmadı; hiçbir kayıt silinmez.',
  }));
}

export async function proposeRetention(tx: Tx, p: Principal, recordType: string, periodMonths: number, legalBasis: string) {
  admin(p);
  if (!Number.isInteger(periodMonths) || periodMonths < 1) throw invalid('Süre ay cinsinden pozitif tam sayı olmalı.');
  if (legalBasis.trim().length < 10) throw invalid('Hukuki dayanak veya gerekçe yazılmalı.');
  const r = await tx.query(`UPDATE retention_policies SET period_months = $2, legal_basis = $3, status = 'proposed', proposed_by = $4, proposed_at = now(), approved_by = NULL, approved_at = NULL
                            WHERE record_type = $1`, [recordType, periodMonths, legalBasis, p.userId]);
  if (!r.rowCount) throw new AppError(404, 'NOT_FOUND', 'Kayıt türü bulunamadı.');
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'retention.proposed', entityType: 'retention_policy', entityId: recordType, payload: { periodMonths, legalBasis } });
}

export async function approveRetention(tx: Tx, p: Principal, recordType: string) {
  admin(p);
  const cur = (await tx.query(`SELECT * FROM retention_policies WHERE record_type = $1 FOR UPDATE`, [recordType])).rows[0];
  if (!cur || cur.status !== 'proposed') throw new AppError(409, 'INVALID_STATE', 'Onaylanacak bir öneri yok.');
  if (cur.proposed_by === p.userId) throw forbidden('Süreyi öneren kişi kendi önerisini onaylayamaz.');
  await tx.query(`UPDATE retention_policies SET status = 'approved', approved_by = $2, approved_at = now() WHERE record_type = $1`, [recordType, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'retention.approved', entityType: 'retention_policy', entityId: recordType, payload: { periodMonths: cur.period_months } });
}
