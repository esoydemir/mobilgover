import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notifyUser } from './notifications';
import { currentFacts } from './profile';
import { loadNonconformity, reopen } from './nonconformities';

/**
 * GH-07: the fate of the product, separate from the fix of the device. The device can be repaired and measure normally while the
 * product decision is still open. Only sectors where a product can be affected get these fields; a case with a product effect
 * cannot be closed until every product assessment that was opened has a final decision with a reason (a written "no product effect" assessment by an
 * authorized person counts as a decision). A hold is a recorded decision but an interim one: the case stays open until the product's fate is decided.
 */
export const PRODUCT_DECISIONS = ['release', 'rework', 'hold', 'destroy', 'return_supplier', 'no_product_effect'] as const;
export type ProductDecision = (typeof PRODUCT_DECISIONS)[number];
export const DECISION_TR: Record<ProductDecision, string> = { release: 'Satışa/kullanıma uygun', rework: 'Yeniden işleme', hold: 'Bekletme (karantina)',
  destroy: 'İmha', return_supplier: 'Tedarikçiye iade', no_product_effect: 'Ürün etkisi yok (yetkili değerlendirme)' };
/** Hazards that, in a product sector, suggest the product may be affected. Closure needs a product decision (or an authorized written "no product effect" assessment). */
const PRODUCT_HAZARDS = new Set(['cold_chain_temperature']);
const NO_EFFECT_MIN_REASON = 20;

/** Reason written on the history row when the final decision follows a hold; it is not a correction of a mistake. */
export const FINAL_AFTER_HOLD = 'Geçici bekletme sonrasında son karar verildi.';

/**
 * Product fields exist where product that can be affected is kept: cold storage of product, or food preparation. What the site really does
 * decides, not the sector label: a market that only sells chilled dairy has a product to decide on; an office with a staff fridge states neither
 * activity. A missing answer is "unknown" (asked), never "no".
 */
export async function productScope(tx: Tx, companyId: string, siteId: string): Promise<'yes' | 'no' | 'unknown'> {
  const f = await currentFacts(tx, companyId, siteId);
  if (f['storage.cold']?.value === true || f['activity.food_preparation']?.value === true) return 'yes';
  if (f['storage.cold']?.value === false) return 'no';
  // cold storage unanswered: unknown only for a food business (it prepares or sells food product); other sites are never asked
  return f['activity.food_business']?.value === true ? 'unknown' : 'no';
}
export const productApplies = async (tx: Tx, companyId: string, siteId: string) => (await productScope(tx, companyId, siteId)) === 'yes';

type Row = { id: string; product_ref: string; quantity: string | null; quantity_unit: string | null; quantity_unknown: boolean; first_action: string; assessor_id: string; assessor: string;
  opened_by: string; opener: string; opened_at: Date; decision: ProductDecision | null; rationale: string | null; evidence_ids: string[]; decided_by: string | null; decider: string | null; decided_at: Date | null };

type Rev = { assessment_id: string; prev_decision: ProductDecision; prev_rationale: string; prev_decided_at: Date; prev_by: string; new_decision: ProductDecision; new_rationale: string;
  reason: string; corrected_at: Date; corrector: string; case_was_closed: boolean };
const revView = (r: Rev) => ({ previous: { code: r.prev_decision, label: DECISION_TR[r.prev_decision], rationale: r.prev_rationale, by: r.prev_by, at: r.prev_decided_at },
  now: { code: r.new_decision, label: DECISION_TR[r.new_decision], rationale: r.new_rationale }, reason: r.reason, correctedBy: r.corrector, correctedAt: r.corrected_at, caseWasClosed: r.case_was_closed,
  kind: r.reason === FINAL_AFTER_HOLD && r.prev_decision === 'hold' ? 'final_after_hold' as const : 'correction' as const });

const view = (r: Row) => ({
  id: r.id, product: r.product_ref, quantity: r.quantity_unknown ? null : Number(r.quantity), unit: r.quantity_unit, quantityUnknown: r.quantity_unknown,
  firstAction: r.first_action, assessor: { id: r.assessor_id, name: r.assessor }, openedBy: r.opener, openedAt: r.opened_at,
  state: !r.decision ? 'open' as const : r.decision === 'hold' ? 'held' as const : 'decided' as const,
  decision: r.decision ? { code: r.decision, label: DECISION_TR[r.decision], rationale: r.rationale, by: r.decider, at: r.decided_at, evidenceIds: r.evidence_ids } : null,
});

export async function productState(tx: Tx, n: { id: string; company_id: string; site_id: string; hazard_type: string }) {
  const scope = await productScope(tx, n.company_id, n.site_id);
  const applies = scope === 'yes';
  const rows = (await tx.query<Row>(
    `SELECT a.*, au.display_name AS assessor, ou.display_name AS opener, du.display_name AS decider FROM ncr_product_assessments a
       JOIN users au ON au.id = a.assessor_id JOIN users ou ON ou.id = a.opened_by LEFT JOIN users du ON du.id = a.decided_by
      WHERE a.ncr_id = $1 ORDER BY a.opened_at`, [n.id])).rows.map(view);
  const revs = (await tx.query<Rev>(
    `SELECT v.assessment_id, v.prev_decision, v.prev_rationale, v.prev_decided_at, pu.display_name AS prev_by, v.new_decision, v.new_rationale, v.reason, v.corrected_at, cu.display_name AS corrector, v.case_was_closed
       FROM ncr_product_decision_revisions v JOIN users pu ON pu.id = v.prev_decided_by JOIN users cu ON cu.id = v.corrected_by WHERE v.ncr_id = $1 ORDER BY v.corrected_at`, [n.id])).rows;
  const withCorrections = rows.map(r => ({ ...r, corrections: revs.filter(v => v.assessment_id === r.id).map(revView) }));
  if (scope === 'unknown' && !rows.length && PRODUCT_HAZARDS.has(n.hazard_type)) {
    return { applies: false, unknown: true, needsAnswer: 'storage.cold', required: false, suggested: false, assessments: [], openCount: 0, unknownQuantity: false, closureBlocker: null,
      suggestionText: 'Bu şubenin soğukta ürün saklayıp saklamadığı kayıtlı değil. Profildeki "Soğuk depolama" sorusunu yanıtla; yanıta göre ürün kararı gerekip gerekmediği belirlenir.' };
  }
  if (!applies && !rows.length) return null; // sites with no product effect do not see these fields
  const required = applies && (rows.length > 0 || PRODUCT_HAZARDS.has(n.hazard_type));
  const suggested = applies && rows.length === 0 && PRODUCT_HAZARDS.has(n.hazard_type);
  const open = rows.filter(r => r.state !== 'decided');
  const blocker = !required ? null : !rows.length ? 'Ürün etkisi olabilecek kayıt: etkilenen ürün için değerlendirme başlat ya da yetkili kişi gerekçeli "ürün etkisi yok" kararı versin.'
    : open.length ? `${open.length} ürün değerlendirmesinin kararı açık. ${open.map(r => `${r.product}: ${r.state === 'held' ? 'bekletmede, son karar bekliyor' : 'karar verilmedi'}`).join(' · ')}.` : null;
  return { applies, required, suggested, suggestionText: suggested ? 'Bu kayıtta ürün etkilenmiş olabilir; kapatmak için ürün kararı gerekir. Etkilenen ürün için değerlendirme başlat; etkilenmediyse yetkili kişi gerekçeli "ürün etkisi yok" kararı versin.' : null, assessments: withCorrections, openCount: open.length, unknownQuantity: rows.some(r => r.quantityUnknown), closureBlocker: blocker };
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
  const held = a.decision === 'hold';
  if (a.decision && !held) throw conflict('PRODUCT_DECIDED', 'Bu değerlendirmenin kararı zaten verildi.');
  if (held && b.decision === 'hold') throw conflict('PRODUCT_DECIDED', 'Ürün zaten bekletmede; şimdi son kararı ver.');
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
  if (held) {
    // The interim decision stays on record with who gave it and why.
    await tx.query(`INSERT INTO ncr_product_decision_revisions (company_id, ncr_id, assessment_id, prev_decision, prev_rationale, prev_evidence_ids, prev_decided_by, prev_decided_at, new_decision, new_rationale, reason, corrected_by, case_was_closed)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)`,
      [companyId, ncrId, assessmentId, a.decision, a.rationale, a.evidence_ids, a.decided_by, a.decided_at, b.decision, b.rationale.trim(), FINAL_AFTER_HOLD, p.userId]);
  }
  await tx.query(`UPDATE ncr_product_assessments SET decision = $2, rationale = $3, evidence_ids = $4, decided_by = $5, decided_at = clock_timestamp() WHERE id = $1`,
    [assessmentId, b.decision, b.rationale.trim(), ev, p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.product_decided', entityType: 'nonconformity', entityId: ncrId,
    payload: { assessmentId, product: a.product_ref, decision: b.decision, rationale: b.rationale.trim(), evidenceIds: ev, assessorId: a.assessor_id } });
  return { state: 'decided' as const, decision: b.decision };
}

export type CorrectInput = DecideInput & { reason: string };

/**
 * A decision given on wrong grounds is corrected by a person who may verify closure, with a reason. The earlier decision stays in the revision history.
 * If the case was already closed it is reopened (the reason carries the correction) so the new decision goes through closure again; the earlier closure stays in its history.
 */
export async function correctDecision(tx: Tx, p: Principal, companyId: string, ncrId: string, assessmentId: string, b: CorrectInput) {
  const n = await loadNonconformity(tx, p, companyId, ncrId, 'ncr.act', true);
  const target = { companyId, siteId: n.site_id, recordId: n.id };
  if (!can(p, 'ncr.verify_close', target).ok) throw forbidden('Verilmiş ürün kararını yalnız kapanışı doğrulamaya yetkili kişi düzeltebilir.');
  const a = (await tx.query(`SELECT * FROM ncr_product_assessments WHERE id = $1 AND ncr_id = $2 AND company_id = $3 FOR UPDATE`, [assessmentId, ncrId, companyId])).rows[0];
  if (!a) throw notFound('Ürün değerlendirmesi');
  if (!a.decision) throw conflict('PRODUCT_NOT_DECIDED', 'Henüz karar verilmemiş; düzeltme değil, karar ver.');
  if (b.reason.trim().length < 20) throw invalid('Düzeltme nedenini yaz (en az 20 karakter): önceki karar neden yanlıştı?');
  if (b.rationale.trim().length < 10) throw invalid('Yeni kararın gerekçesini yaz (en az bir cümle).');
  if (b.decision === 'no_product_effect' && b.rationale.trim().length < NO_EFFECT_MIN_REASON) throw invalid(`"Ürün etkisi yok" için gerekçe en az ${NO_EFFECT_MIN_REASON} karakter olmalı.`);
  if (b.decision === a.decision && b.rationale.trim() === a.rationale) throw invalid('Karar ve gerekçe değişmedi; düzeltilecek bir şey yok.');
  const ev = [...new Set(b.evidenceIds)];
  if (ev.length && (await tx.query(`SELECT 1 FROM evidence WHERE id = ANY($1) AND ncr_id = $2 AND company_id = $3`, [ev, ncrId, companyId])).rowCount !== ev.length) throw invalid('Kanıt bu kayda ait olmalı.');
  const wasClosed = n.status === 'closed';
  await tx.query(`INSERT INTO ncr_product_decision_revisions (company_id, ncr_id, assessment_id, prev_decision, prev_rationale, prev_evidence_ids, prev_decided_by, prev_decided_at, new_decision, new_rationale, reason, corrected_by, case_was_closed)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [companyId, ncrId, assessmentId, a.decision, a.rationale, a.evidence_ids, a.decided_by, a.decided_at, b.decision, b.rationale.trim(), b.reason.trim(), p.userId, wasClosed]);
  await tx.query(`UPDATE ncr_product_assessments SET decision = $2, rationale = $3, evidence_ids = $4, decided_by = $5, decided_at = clock_timestamp() WHERE id = $1`,
    [assessmentId, b.decision, b.rationale.trim(), ev, p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.product_decision_corrected', entityType: 'nonconformity', entityId: ncrId,
    payload: { assessmentId, product: a.product_ref, previous: { decision: a.decision, rationale: a.rationale, by: a.decided_by, at: a.decided_at }, now: { decision: b.decision, rationale: b.rationale.trim() },
      reason: b.reason.trim(), caseWasClosed: wasClosed } });
  if (wasClosed) await reopen(tx, p, companyId, ncrId, `Ürün kararı düzeltildi: ${b.reason.trim()}`);
  return { state: 'corrected' as const, decision: b.decision, reopened: wasClosed };
}
