import { z } from 'zod';
import type { Tx } from '../db/pool';
import { decide } from '../domain/applicability';
import { validateCondition } from '../domain/conditions';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { evidenceRequirementSchema, limitSchema } from '../domain/evidence';
import type { Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { currentObligations, recomputeCompany } from './obligations';
import { currentFacts } from './profile';

const recurrenceSchema = z.union([
  z.object({ freq: z.literal('daily'), at: z.string().regex(/^\d{2}:\d{2}$/), perEquipmentType: z.string().optional() }),
  z.object({ freq: z.literal('weekly'), weekday: z.number().int().min(1).max(7), at: z.string().regex(/^\d{2}:\d{2}$/), perEquipmentType: z.string().optional() }),
  z.object({ freq: z.literal('monthly'), day: z.number().int().min(1).max(28), at: z.string().regex(/^\d{2}:\d{2}$/), perEquipmentType: z.string().optional() }),
]);

export const templateSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(3),
  instructions: z.string().min(3),
  recurrence: recurrenceSchema,
  evidence: z.array(evidenceRequirementSchema).min(1),
  limits: z.array(limitSchema).default([]),
  severity: z.enum(['minor', 'major', 'critical']),
  hazardType: z.string().min(2),
  emergencyInstruction: z.string().min(10).optional(),
});

export const draftSchema = z.object({
  code: z.string().regex(/^[A-Z0-9-]+$/),
  title: z.string().min(3),
  kind: z.enum(['legal_requirement', 'good_practice']),
  isExample: z.boolean(),
  provisionIds: z.array(z.uuid()).default([]),
  ambiguityNote: z.string().nullable().default(null),
  condition: z.unknown(),
  obligationTitle: z.string().min(3),
  obligationSummary: z.string().min(3),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().default(null),
  changeReason: z.string().min(5),
  /** Subject areas (e.g. food_safety, gas_safety) whose specialist must review before approval. */
  requiredReviewAreas: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  templates: z.array(templateSchema).min(1),
});
export type DraftInput = z.input<typeof draftSchema>;

const has = (p: Principal, r: Principal['platformRoles'][number]) => p.platformRoles.includes(r);

/** Creates a new draft version. Conditions are validated against the fact catalogue before they are stored. */
export async function createDraft(tx: Tx, p: Principal, raw: DraftInput) {
  if (!has(p, 'rule_author')) throw forbidden('Kural taslağı yalnızca kural yazarı oluşturabilir.');
  return insertDraft(tx, p.userId, raw);
}

/** Validates a draft input without writing anything (the same checks createDraft makes). Returns the parsed input. */
export async function validateDraftInput(tx: Tx, raw: DraftInput) {
  const input = draftSchema.parse(raw);
  const cond = validateCondition(input.condition);
  if (!cond.ok) throw invalid('Kural koşulu geçersiz.', cond.errors);
  for (const t of input.templates) {
    if (t.evidence.some(e => e.kind === 'measurement') && !t.limits.length) throw invalid(`"${t.code}" ölçüm istiyor ama limit tanımlamıyor; limit tahmin edilmez.`);
  }
  if (input.provisionIds.length) {
    const src = await tx.query(`SELECT p.id, ls.is_example FROM provisions p JOIN source_versions sv ON sv.id = p.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id WHERE p.id = ANY($1)`, [input.provisionIds]);
    if (src.rowCount !== input.provisionIds.length) throw invalid('Bilinmeyen hüküm referansı.');
    if (!input.isExample && src.rows.some(r => r.is_example)) throw invalid('Gerçek kural, örnek bir kaynağa dayanamaz.');
  } else if (input.kind === 'legal_requirement' && !input.isExample) {
    throw invalid('Mevzuat yükümlülüğü en az bir kaynak hükme bağlanmalı.');
  }
  return { input, condition: cond.condition };
}

/** Writes the draft for an already authorised author (the role check is the caller's). */
export async function insertDraft(tx: Tx, authorId: string, raw: DraftInput) {
  const p = { userId: authorId };
  const input = draftSchema.parse(raw);
  const cond = validateCondition(input.condition);
  if (!cond.ok) throw invalid('Kural koşulu geçersiz.', cond.errors);
  for (const t of input.templates) {
    if (t.evidence.some(e => e.kind === 'measurement') && !t.limits.length) {
      throw invalid(`"${t.code}" ölçüm istiyor ama limit tanımlamıyor; limit tahmin edilmez.`);
    }
  }
  if (input.provisionIds.length) {
    const src = await tx.query(
      `SELECT p.id, ls.is_example FROM provisions p JOIN source_versions sv ON sv.id = p.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id WHERE p.id = ANY($1)`,
      [input.provisionIds]);
    if (src.rowCount !== input.provisionIds.length) throw invalid('Bilinmeyen hüküm referansı.');
    if (!input.isExample && src.rows.some(r => r.is_example)) throw invalid('Gerçek kural, örnek bir kaynağa dayanamaz.');
  } else if (input.kind === 'legal_requirement' && !input.isExample) {
    throw invalid('Mevzuat yükümlülüğü en az bir kaynak hükme bağlanmalı.');
  }

  await tx.query(`INSERT INTO rules (code, title) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [input.code, input.title]);
  const rule = (await tx.query(`SELECT id FROM rules WHERE code = $1`, [input.code])).rows[0]!;
  const v = (await tx.query<{ n: number }>(`SELECT COALESCE(max(version), 0) + 1 AS n FROM rule_versions WHERE rule_id = $1`, [rule.id])).rows[0]!.n;
  const rv = (await tx.query<{ id: string }>(
    `INSERT INTO rule_versions (rule_id, version, kind, is_example, provision_ids, condition, required_facts, ambiguity_note,
       obligation_title, obligation_summary, effective_from, effective_to, change_reason, author_id, required_review_areas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [rule.id, v, input.kind, input.isExample, input.provisionIds, JSON.stringify(cond.condition), cond.facts, input.ambiguityNote,
      input.obligationTitle, input.obligationSummary, input.effectiveFrom, input.effectiveTo, input.changeReason, p.userId, input.requiredReviewAreas])).rows[0]!;
  for (const t of input.templates) {
    await tx.query(
      `INSERT INTO task_templates (rule_version_id, code, title, instructions, recurrence, evidence, limits, severity, hazard_type, emergency_instruction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rv.id, t.code, t.title, t.instructions, JSON.stringify(t.recurrence), JSON.stringify(t.evidence), JSON.stringify(t.limits),
        t.severity, t.hazardType, t.emergencyInstruction ?? null]);
  }
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.drafted', entityType: 'rule_version', entityId: rv.id, payload: { code: input.code, version: v } });
  return { id: rv.id, version: v };
}

async function version(tx: Tx, id: string) {
  const rv = (await tx.query(`SELECT rv.*, r.code FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1 FOR UPDATE OF rv`, [id])).rows[0];
  if (!rv) throw notFound('Kural sürümü');
  return rv;
}

export async function submitForReview(tx: Tx, p: Principal, id: string) {
  if (!has(p, 'rule_author')) throw forbidden();
  const rv = await version(tx, id);
  if (rv.status !== 'draft') throw conflict('INVALID_STATE', `Sürüm ${rv.status} durumunda.`);
  await tx.query(`UPDATE rule_versions SET status = 'in_review' WHERE id = $1`, [id]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.submitted', entityType: 'rule_version', entityId: id, payload: { code: rv.code } });
}

/**
 * Specialist review for one subject area. Only someone registered for that
 * area may record it, and never the author.
 */
export async function areaReview(tx: Tx, p: Principal, id: string, area: string, decision: 'approved' | 'changes_requested', notes: string) {
  const rv = await version(tx, id);
  if (rv.status !== 'in_review') throw conflict('INVALID_STATE', `Sürüm ${rv.status} durumunda.`);
  if (!rv.required_review_areas.includes(area)) throw invalid(`Bu kural "${area}" alanında inceleme gerektirmiyor.`);
  if (rv.author_id === p.userId) throw forbidden('Kuralı yazan kişi alan incelemesi yapamaz.');
  const ok = (await tx.query(`SELECT 1 FROM reviewer_areas WHERE user_id = $1 AND area = $2`, [p.userId, area])).rowCount;
  if (!ok) throw forbidden(`"${area}" alanında inceleme yetkin yok.`);
  if (notes.trim().length < 5) throw invalid('İnceleme notu yaz.');
  await tx.query(`INSERT INTO rule_area_reviews (rule_version_id, area, reviewer_id, decision, notes) VALUES ($1,$2,$3,$4,$5)`, [id, area, p.userId, decision, notes]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.area_reviewed', entityType: 'rule_version', entityId: id, payload: { code: rv.code, version: rv.version, area, decision, reason: notes.trim() } });
}

/** Area reviews still missing (latest decision per area must be "approved"). */
async function pendingAreas(tx: Tx, rv: any): Promise<string[]> {
  const r = await tx.query(`SELECT DISTINCT ON (area) area, decision FROM rule_area_reviews WHERE rule_version_id = $1 ORDER BY area, created_at DESC`, [rv.id]);
  const approved = new Set(r.rows.filter(x => x.decision === 'approved').map(x => x.area));
  return rv.required_review_areas.filter((a: string) => !approved.has(a));
}

export async function listRuleVersions(tx: Tx, p: Principal, status?: string) {
  if (!p.platformRoles.length) throw forbidden();
  const rows = (await tx.query(
    `SELECT rv.id, r.code, rv.version, rv.status, rv.kind, rv.is_example, rv.obligation_title, rv.required_review_areas, rv.author_id, rv.reviewer_id, rv.created_at, rv.published_at
       FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE ($1::text IS NULL OR rv.status = $1) ORDER BY r.code, rv.version`, [status ?? null])).rows;
  for (const r of rows) r.pendingAreaReviews = r.status === 'in_review' ? await pendingAreas(tx, r) : [];
  return rows;
}

/** Human review gate. The reviewer must differ from the author and also approves any emergency instruction. */
/** A decision on a rule needs a written reason; empty or whitespace-only text is refused before anything changes. */
export function needReason(reason: string | null | undefined, what: string): string {
  const r = (reason ?? '').trim();
  if (r.length === 0) throw invalid(`${what} için gerekçe yazmalısın.`);
  return r;
}

export async function approve(tx: Tx, p: Principal, id: string, reason: string | null | undefined) {
  if (!has(p, 'rule_reviewer')) throw forbidden('Onay yalnızca kural inceleyicisi tarafından verilebilir.');
  const why = needReason(reason, 'Kuralı onaylamak');
  const rv = await version(tx, id);
  if (rv.status !== 'in_review') throw conflict('INVALID_STATE', `Sürüm ${rv.status} durumunda.`);
  if (rv.author_id === p.userId) throw forbidden('Kuralı yazan kişi kendi kuralını onaylayamaz.');
  const missing = await pendingAreas(tx, rv);
  if (missing.length) throw conflict('AREA_REVIEW_MISSING', `Önce alan uzmanı incelemesi gerekiyor: ${missing.join(', ')}`, { missing });
  await tx.query(`UPDATE task_templates SET emergency_approved_by = $2 WHERE rule_version_id = $1 AND emergency_instruction IS NOT NULL`, [id, p.userId]);
  await tx.query(`UPDATE rule_versions SET status = 'approved', reviewer_id = $2, reviewed_at = now() WHERE id = $1`, [id, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.approved', entityType: 'rule_version', entityId: id, payload: { code: rv.code, version: rv.version, reason: why } });
}

/**
 * Publishes an approved version, retires the previous one and re-evaluates
 * every company. Example rules are refused outside demo deployments.
 */
export async function publish(tx: Tx, p: Principal, id: string, opts: { allowExampleRules: boolean; reason: string | null | undefined }) {
  if (!has(p, 'platform_admin') && !has(p, 'rule_reviewer')) throw forbidden();
  const why = needReason(opts.reason, 'Kuralı yayımlamak');
  await publishVersion(tx, p.userId, id, { allowExampleRules: opts.allowExampleRules, reason: why });
  const companies = (await tx.query<{ id: string }>(`SELECT id FROM companies`)).rows;
  for (const c of companies) await recomputeCompany(tx, c.id, p.userId);
  return { recomputedCompanies: companies.length };
}

/**
 * Moves an approved version to "published" and retires the previous one. No re-evaluation here: the manual path above
 * evaluates every company, the legislation path only the sites in scope.
 */
export async function publishVersion(tx: Tx, actorId: string, id: string, opts: { allowExampleRules: boolean; reason: string; extra?: Record<string, unknown> }) {
  const rv = await version(tx, id);
  if (rv.status !== 'approved') throw conflict('INVALID_STATE', 'Yalnızca onaylanmış sürüm yayınlanabilir.');
  if (rv.is_example && !opts.allowExampleRules) throw forbidden('Örnek kurallar yalnızca demo ortamında yayınlanabilir.');
  await tx.query(`UPDATE rule_versions SET status = 'retired', retired_at = now() WHERE rule_id = $1 AND status = 'published'`, [rv.rule_id]);
  await tx.query(`UPDATE rule_versions SET status = 'published', published_by = $2, published_at = now() WHERE id = $1`, [id, actorId]);
  await appendAudit(tx, { companyId: null, actorId, eventType: 'rule.published', entityType: 'rule_version', entityId: id, payload: { code: rv.code, version: rv.version, reason: opts.reason, ...(opts.extra ?? {}) } });
  return rv;
}

/**
 * Impact simulation: what publishing this version would change, per site,
 * without writing anything. Lets reviewers see consequences before the gate.
 */
export async function previewImpact(tx: Tx, p: Principal, id: string) {
  if (!has(p, 'rule_reviewer') && !has(p, 'platform_admin')) throw forbidden();
  const rv = await version(tx, id);
  const sites = (await tx.query(`SELECT s.id, s.company_id, s.name, c.name AS company FROM sites s JOIN companies c ON c.id = s.company_id`)).rows;
  const onDate = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const s of sites) {
    const facts = await currentFacts(tx, s.company_id, s.id);
    const d = decide({ ruleVersionId: rv.id, condition: rv.condition, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to, ambiguityNote: rv.ambiguity_note }, facts, onDate);
    const prev = (await currentObligations(tx, s.company_id, s.id)).find(o => o.rule_id === rv.rule_id);
    const next = d?.decision ?? 'not_in_force';
    if ((prev?.decision ?? null) !== next) out.push({ companyId: s.company_id, siteId: s.id, site: s.name, from: prev?.decision ?? null, to: next, missingFacts: d?.missingFacts ?? [] });
  }
  return { ruleCode: rv.code, version: rv.version, changes: out };
}

// ── Rule writing screen (6E) ──

/** Synthetic business profiles used to preview a draft before publishing. Not real businesses. */
export const SAMPLE_PROFILES: { key: string; label: string; facts: Record<string, unknown>; equipment: string[] }[] = [
  { key: 'cafe_cold', label: 'Kafe · soğuk depo var · LPG yok', facts: { 'activity.food_preparation': true, 'storage.cold': true, 'utility.lpg': false, 'service.delivery': false, 'staff.count': 6, 'site.province': 'İstanbul' }, equipment: ['refrigerator', 'thermometer'] },
  { key: 'restaurant_lpg', label: 'Lokanta · soğuk depo ve LPG var · paket servis', facts: { 'activity.food_preparation': true, 'storage.cold': true, 'utility.lpg': true, 'service.delivery': true, 'staff.count': 14, 'site.province': 'Ankara' }, equipment: ['refrigerator', 'freezer', 'thermometer'] },
  { key: 'kiosk', label: 'Büfe · hazırlama yok · soğutucu yok', facts: { 'activity.food_preparation': false, 'storage.cold': false, 'utility.lpg': false, 'service.delivery': false, 'staff.count': 2, 'site.province': 'İzmir' }, equipment: [] },
  { key: 'unknown', label: 'Yeni işletme · profil eksik', facts: { 'activity.food_preparation': true }, equipment: [] },
];

const FREQ_TR = (r: any) => r.freq === 'daily' ? `her gün ${r.at}` : r.freq === 'weekly' ? `her hafta (${r.weekday}. gün) ${r.at}` : `her ay ${r.day}. gün ${r.at}`;

/** Which obligations and which tasks a draft would create for each sample profile. Nothing is written. */
export function samplePreview(rv: { condition: any; effective_from: string; effective_to: string | null; ambiguity_note: string | null; id: string },
  templates: { code: string; title: string; recurrence: any; evidence: any[]; limits: any[] }[]) {
  const onDate = new Date().toISOString().slice(0, 10);
  return SAMPLE_PROFILES.map(sp => {
    const facts: Record<string, any> = {};
    for (const [k, v] of Object.entries(sp.facts)) facts[k] = { id: k, key: k, value: v, source: 'user_declared', verification: 'user_confirmed', validFrom: null, validTo: null, recordedAt: onDate };
    const d = decide({ ruleVersionId: rv.id, condition: rv.condition, effectiveFrom: String(rv.effective_from).slice(0, 10), effectiveTo: rv.effective_to ? String(rv.effective_to).slice(0, 10) : null, ambiguityNote: rv.ambiguity_note }, facts as any, onDate);
    const decision = d?.decision ?? 'not_in_force';
    const tasks = decision === 'applies' ? templates.flatMap(t => {
      const per = t.recurrence?.perEquipmentType as string | undefined;
      const units = per ? sp.equipment.filter(e => e === per).length : 1;
      if (!units) return [{ code: t.code, title: t.title, schedule: FREQ_TR(t.recurrence), count: 0, note: `Bu profilde "${per}" türü ekipman yok; görev oluşmaz.` }];
      const m = t.evidence.find((e: any) => e.kind === 'measurement');
      const lim = t.limits.find((l: any) => !l.equipmentType || l.equipmentType === per);
      return [{ code: t.code, title: t.title, schedule: FREQ_TR(t.recurrence), count: units,
        note: [m ? `ölçüm ${m.unit}${lim ? ` (${lim.min ?? '—'}…${lim.max ?? '—'})` : ''}` : null, `kanıt: ${t.evidence.map((e: any) => e.kind).join(', ')}`].filter(Boolean).join(' · ') }];
    }) : [];
    return { profile: sp.key, label: sp.label, decision, reason: d?.reason ?? 'Yürürlük tarihi dışında.', missingFacts: d?.missingFacts ?? [], tasks };
  });
}

/** Full view of one version for the writing screen: fields, templates, sources, reviews, sample preview. */
export async function ruleVersionDetail(tx: Tx, p: Principal, id: string) {
  if (!p.platformRoles.length) throw forbidden();
  const rv = (await tx.query(`SELECT rv.*, r.code, r.title AS rule_title FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1`, [id])).rows[0];
  if (!rv) throw notFound('Kural sürümü');
  const templates = (await tx.query(`SELECT code, title, instructions, recurrence, evidence, limits, severity, hazard_type, emergency_instruction FROM task_templates WHERE rule_version_id = $1 ORDER BY code`, [id])).rows;
  const sources = rv.provision_ids.length ? (await tx.query(`SELECT pr.id, pr.ref, ls.title, ls.is_example, sv.version_label FROM provisions pr JOIN source_versions sv ON sv.id = pr.source_version_id
     JOIN legal_sources ls ON ls.id = sv.source_id WHERE pr.id = ANY($1)`, [rv.provision_ids])).rows : [];
  const reviews = (await tx.query(`SELECT ar.area, ar.decision, ar.notes, ar.created_at, u.display_name AS reviewer FROM rule_area_reviews ar JOIN users u ON u.id = ar.reviewer_id
     WHERE ar.rule_version_id = $1 ORDER BY ar.created_at`, [id])).rows;
  const usedByTasks = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE tt.rule_version_id = $1`, [id])).rows[0]!.n;
  return {
    id: rv.id, code: rv.code, title: rv.rule_title, version: rv.version, status: rv.status, kind: rv.kind, isExample: rv.is_example, condition: rv.condition,
    obligationTitle: rv.obligation_title, obligationSummary: rv.obligation_summary, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to, changeReason: rv.change_reason,
    ambiguityNote: rv.ambiguity_note, requiredReviewAreas: rv.required_review_areas, pendingAreaReviews: rv.status === 'in_review' ? await pendingAreas(tx, rv) : [],
    provisionIds: rv.provision_ids, sources, reviews, templates, usedByTasks,
    sourceNote: !sources.length ? 'Kaynak hükmü bağlı değil: yalnız örnek ya da iyi uygulama olarak kalabilir.' : sources.some(s => s.is_example) ? 'Örnek kaynağa dayanıyor: gerçek kural olarak yayımlanamaz.' : null,
    canEdit: rv.status === 'draft' && rv.author_id === p.userId,
    samplePreview: samplePreview(rv, templates.map(t => ({ code: t.code, title: t.title, recurrence: t.recurrence, evidence: t.evidence, limits: t.limits }))),
  };
}

/** Edit a draft (author only, draft only). Templates of a draft are replaced; no task uses them yet. */
export async function updateDraft(tx: Tx, p: Principal, id: string, raw: DraftInput) {
  if (!has(p, 'rule_author')) throw forbidden('Kural taslağını yalnızca kural yazarı düzenler.');
  const rv = await version(tx, id);
  if (rv.status !== 'draft') throw conflict('INVALID_STATE', 'Yalnız taslak düzenlenir; yayımlanan sürüm değişmez, yeni sürüm açılır.');
  if (rv.author_id !== p.userId) throw forbidden('Taslağı yazan kişi düzenler.');
  const input = draftSchema.parse(raw);
  if (input.code !== rv.code) throw invalid('Kural kodu taslakta değiştirilemez.');
  const cond = validateCondition(input.condition);
  if (!cond.ok) throw invalid('Kural koşulu geçersiz.', cond.errors);
  for (const t of input.templates) if (t.evidence.some(e => e.kind === 'measurement') && !t.limits.length) throw invalid(`"${t.code}" ölçüm istiyor ama limit tanımlamıyor; limit tahmin edilmez.`);
  if (input.provisionIds.length) {
    const src = await tx.query(`SELECT p.id, ls.is_example FROM provisions p JOIN source_versions sv ON sv.id = p.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id WHERE p.id = ANY($1)`, [input.provisionIds]);
    if (src.rowCount !== input.provisionIds.length) throw invalid('Bilinmeyen hüküm referansı.');
    if (!input.isExample && src.rows.some(r => r.is_example)) throw invalid('Gerçek kural, örnek bir kaynağa dayanamaz.');
  } else if (input.kind === 'legal_requirement' && !input.isExample) throw invalid('Mevzuat yükümlülüğü en az bir kaynak hükme bağlanmalı.');
  await tx.query(`UPDATE rule_versions SET kind = $2, is_example = $3, provision_ids = $4, condition = $5, required_facts = $6, ambiguity_note = $7, obligation_title = $8,
     obligation_summary = $9, effective_from = $10, effective_to = $11, change_reason = $12, required_review_areas = $13 WHERE id = $1`,
    [id, input.kind, input.isExample, input.provisionIds, JSON.stringify(cond.condition), cond.facts, input.ambiguityNote, input.obligationTitle, input.obligationSummary,
      input.effectiveFrom, input.effectiveTo, input.changeReason, input.requiredReviewAreas]);
  await tx.query(`DELETE FROM task_templates WHERE rule_version_id = $1`, [id]);
  for (const t of input.templates) {
    await tx.query(`INSERT INTO task_templates (rule_version_id, code, title, instructions, recurrence, evidence, limits, severity, hazard_type, emergency_instruction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, t.code, t.title, t.instructions, JSON.stringify(t.recurrence), JSON.stringify(t.evidence), JSON.stringify(t.limits), t.severity, t.hazardType, t.emergencyInstruction ?? null]);
  }
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.draft_edited', entityType: 'rule_version', entityId: id, payload: { code: rv.code, version: rv.version } });
  return { id };
}

/** Sources a draft may cite (example sources are labelled). */
export async function listProvisions(tx: Tx, p: Principal) {
  if (!p.platformRoles.length) throw forbidden();
  return (await tx.query(`SELECT pr.id, pr.ref, left(pr.excerpt, 160) AS excerpt, ls.title, ls.is_example, sv.version_label FROM provisions pr
     JOIN source_versions sv ON sv.id = pr.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id ORDER BY ls.title, pr.ref`)).rows;
}
