import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notifyUser } from './notifications';
import { currentFacts } from './profile';
import { loadNonconformity } from './nonconformities';

/**
 * GH-07: the fate of the product, separate from the fix of the device. The device can be repaired and measure normally while the
 * product decision is still open. Only sectors where a product can be affected get these fields; a case with a product effect
 * cannot be closed until every product assessment that was opened has a decision with a reason (a written "no product effect" assessment by an
 * authorized person counts as a decision).
 */
export const PRODUCT_DECISIONS = ['release', 'rework', 'hold', 'destroy', 'return_supplier', 'no_product_effect'] as const;
export type ProductDecision = (typeof PRODUCT_DECISIONS)[number];
export const DECISION_TR: Record<ProductDecision, string> = { release: 'Satışa/kullanıma uygun', rework: 'Yeniden işleme', hold: 'Bekletme (karantina)',
  destroy: 'İmha', return_supplier: 'Tedarikçiye iade', no_product_effect: 'Ürün etkisi yok (yetkili değerlendirme)' };
/** Hazards that, in a product sector, suggest the product may be affected. They prompt an assessment; closure is blocked once one is started. */
const PRODUCT_HAZARDS = new Set(['cold_chain_temperature']);
const NO_EFFECT_MIN_REASON = 20;

/** Product fields exist only where a product is handled: today, sites that prepare food or drink. */
export async function productApplies(tx: Tx, companyId: string, siteId: string) {
  const f = await currentFacts(tx, companyId, siteId);
  return f['activity.food_preparation']?.value === true;
}

type Row = { id: string; product_ref: string; quantity: string | null; quantity_unit: string | null; quantity_unknown: boolean; first_action: string; assessor_id: string; assessor: string;
  opened_by: string; opener: string; opened_at: Date; decision: ProductDecision | null; rationale: string | null; evidence_ids: string[]; decided_by: string | null; decider: string | null; decided_at: Date | null };

const view = (r: Row) => ({
  id: r.id, product: r.product_ref, quantity: r.quantity_unknown ? null : Number(r.quantity), unit: r.quantity_unit, quantityUnknown: r.quantity_unknown,
  firstAction: r.first_action, assessor: { id: r.assessor_id, name: r.assessor }, openedBy: r.opener, openedAt: r.opened_at,
  state: r.decision ? 'decided' as const : 'open' as const,
  decision: r.decision ? { code: r.decision, label: DECISION_TR[r.decision], rationale: r.rationale, by: r.decider, at: r.decided_at, evidenceIds: r.evidence_ids } : null,
});

export async function productState(tx: Tx, n: { id: string; company_id: string; site_id: string; hazard_type: string }) {
  const applies = await productApplies(tx, n.company_id, n.site_id);
  const rows = (await tx.query<Row>(
    `SELECT a.*, au.display_name AS assessor, ou.display_name AS opener, du.display_name AS decider FROM ncr_product_assessments a
       JOIN users au ON au.id = a.assessor_id JOIN users ou ON ou.id = a.opened_by LEFT JOIN users du ON du.id = a.decided_by
      WHERE a.ncr_id = $1 ORDER BY a.opened_at`, [n.id])).rows.map(view);
  if (!applies && !rows.length) return null; // sectors without a product effect do not see these fields
  const required = applies && rows.length > 0;
  const suggested = applies && rows.length === 0 && PRODUCT_HAZARDS.has(n.hazard_type);
  const open = rows.filter(r => r.state === 'open');
  const blocker = !required ? null : open.length ? `${open.length} ürün değerlendirmesinin kararı açık.` : null;
  return { applies, required, suggested, suggestionText: suggested ? 'Bu kayıtta ürün etkilenmiş olabilir. Etkilenen ürün için değerlendirme başlat; etkilenmediyse yetkili kişi gerekçeli "ürün etkisi yok" kararı versin.' : null, assessments: rows, openCount: open.length, unknownQuantity: rows.some(r => r.quantityUnknown), closureBlocker: blocker };
}

/** Called at closure: a product effect without a recorded decision keeps the case open, whatever the device measures. */
export async function assertProductClosable(tx: Tx, n: any) {
  const s = await productState(tx, n);
  if (s?.closureBlocker) throw new AppError(422, 'PRODUCT_DECISION_OPEN', `Kapatılamaz: ${s.closureBlocker}`);
}

export type OpenInput = { product: string; quantity: number | null; unit: string | null; quantityUnknown: boolean; firstAction: string; assessorId: string };

export async function openAssessment(tx: Tx, p: Principal, companyId: string, ncrId: string, b: OpenInput) {
  const n = await loadNonconformity(tx, p, companyId, ncrId, 'ncr.act', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta ürün değerlendirmesi başlatılamaz; önce yeniden aç.');
  if (!(await productApplies(tx, companyId, n.site_id))) throw new AppError(422, 'PRODUCT_NOT_APPLICABLE', 'Bu şubenin faaliyetinde ürün etkisi alanı yok.');
  if (b.quantityUnknown === (b.quantity !== null)) throw invalid('Miktarı yaz ya da "miktar bilinmiyor" olarak işaretle; ikisi birlikte olmaz.');
  if (b.product.trim().length < 2) throw invalid('Ürün veya parti bilgisini yaz.');
  if (b.firstAction.trim().length < 5) throw invalid('Alınan ilk önlemi yaz.');
  const ok = (await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND (site_id IS NULL OR site_id = $3)`, [b.assessorId, companyId, n.site_id])).rowCount;
  if (!ok) throw invalid('Değerlendiren kişi bu şubede etkin bir üye olmalı.');
  const id = (await tx.query<{ id: string }>(
    `INSERT INTO ncr_product_assessments (company_id, ncr_id, product_ref, quantity, quantity_unit, quantity_unknown, first_action, assessor_id, opened_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [companyId, ncrId, b.product.trim(), b.quantityUnknown ? null : b.quantity, b.unit?.trim() || null, b.quantityUnknown, b.firstAction.trim(), b.assessorId, p.userId])).rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.product_assessment_opened', entityType: 'nonconformity', entityId: ncrId,
    payload: { assessmentId: id, product: b.product.trim(), quantity: b.quantityUnknown ? null : b.quantity, unit: b.unit ?? null, quantityUnknown: b.quantityUnknown, firstAction: b.firstAction.trim(), assessorId: b.assessorId } });
  if (b.assessorId !== p.userId) {
    await notifyUser(tx, { companyId, siteId: n.site_id, userId: b.assessorId, kind: 'product_assessment', entityType: 'nonconformity', entityId: ncrId, dedupeKey: `product_assessment:${id}`,
      title: 'Ürün değerlendirmesi sende', body: `${n.title} · ${b.product.trim()}${b.quantityUnknown ? ' · miktar bilinmiyor' : ''}` });
  }
  return { id };
}

export type DecideInput = { decision: ProductDecision; rationale: string; evidenceIds: string[] };

/** The named assessor decides, or a person who manages the case. "No product effect" needs a person who may verify closure. */
export async function decideAssessment(tx: Tx, p: Principal, companyId: string, ncrId: string, assessmentId: string, b: DecideInput) {
  const n = await loadNonconformity(tx, p, companyId, ncrId, 'ncr.act', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta ürün kararı verilemez; önce yeniden aç.');
  const a = (await tx.query(`SELECT * FROM ncr_product_assessments WHERE id = $1 AND ncr_id = $2 AND company_id = $3 FOR UPDATE`, [assessmentId, ncrId, companyId])).rows[0];
  if (!a) throw notFound('Ürün değerlendirmesi');
  if (a.decision) throw conflict('PRODUCT_DECIDED', 'Bu değerlendirmenin kararı zaten verildi.');
  const target = { companyId, siteId: n.site_id, recordId: n.id };
  const authorized = can(p, 'ncr.verify_close', target).ok;
  if (a.assessor_id !== p.userId && !authorized && !can(p, 'ncr.manage', target).ok) throw forbidden('Bu değerlendirmeyi atanan kişi ya da kaydı yöneten yetkili karara bağlar.');
  if (b.decision === 'no_product_effect') {
    if (!authorized) throw forbidden('"Ürün etkisi yok" kararını yalnız kapanışı doğrulamaya yetkili kişi verebilir.');
    if (b.rationale.trim().length < NO_EFFECT_MIN_REASON) throw invalid(`"Ürün etkisi yok" için gerekçe en az ${NO_EFFECT_MIN_REASON} karakter olmalı.`);
  }
  if (b.rationale.trim().length < 10) throw invalid('Kararın gerekçesini yaz (en az bir cümle).');
  const ev = [...new Set(b.evidenceIds)];
  if (ev.length && (await tx.query(`SELECT 1 FROM evidence WHERE id = ANY($1) AND ncr_id = $2 AND company_id = $3`, [ev, ncrId, companyId])).rowCount !== ev.length) throw invalid('Kanıt bu kayda ait olmalı.');
  await tx.query(`UPDATE ncr_product_assessments SET decision = $2, rationale = $3, evidence_ids = $4, decided_by = $5, decided_at = clock_timestamp() WHERE id = $1`,
    [assessmentId, b.decision, b.rationale.trim(), ev, p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.product_decided', entityType: 'nonconformity', entityId: ncrId,
    payload: { assessmentId, product: a.product_ref, decision: b.decision, rationale: b.rationale.trim(), evidenceIds: ev, assessorId: a.assessor_id } });
  return { state: 'decided' as const, decision: b.decision };
}
