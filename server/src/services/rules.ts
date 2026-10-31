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
  templates: z.array(templateSchema).min(1),
});
export type DraftInput = z.infer<typeof draftSchema>;

const has = (p: Principal, r: Principal['platformRoles'][number]) => p.platformRoles.includes(r);

/** Creates a new draft version. Conditions are validated against the fact catalogue before they are stored. */
export async function createDraft(tx: Tx, p: Principal, input: DraftInput) {
  if (!has(p, 'rule_author')) throw forbidden('Kural taslağı yalnızca kural yazarı oluşturabilir.');
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
       obligation_title, obligation_summary, effective_from, effective_to, change_reason, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [rule.id, v, input.kind, input.isExample, input.provisionIds, JSON.stringify(cond.condition), cond.facts, input.ambiguityNote,
      input.obligationTitle, input.obligationSummary, input.effectiveFrom, input.effectiveTo, input.changeReason, p.userId])).rows[0]!;
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

/** Human review gate. The reviewer must differ from the author and also approves any emergency instruction. */
export async function approve(tx: Tx, p: Principal, id: string) {
  if (!has(p, 'rule_reviewer')) throw forbidden('Onay yalnızca kural inceleyicisi tarafından verilebilir.');
  const rv = await version(tx, id);
  if (rv.status !== 'in_review') throw conflict('INVALID_STATE', `Sürüm ${rv.status} durumunda.`);
  if (rv.author_id === p.userId) throw forbidden('Kuralı yazan kişi kendi kuralını onaylayamaz.');
  await tx.query(`UPDATE task_templates SET emergency_approved_by = $2 WHERE rule_version_id = $1 AND emergency_instruction IS NOT NULL`, [id, p.userId]);
  await tx.query(`UPDATE rule_versions SET status = 'approved', reviewer_id = $2, reviewed_at = now() WHERE id = $1`, [id, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.approved', entityType: 'rule_version', entityId: id, payload: { code: rv.code } });
}

/**
 * Publishes an approved version, retires the previous one and re-evaluates
 * every company. Example rules are refused outside demo deployments.
 */
export async function publish(tx: Tx, p: Principal, id: string, opts: { allowExampleRules: boolean }) {
  if (!has(p, 'platform_admin') && !has(p, 'rule_reviewer')) throw forbidden();
  const rv = await version(tx, id);
  if (rv.status !== 'approved') throw conflict('INVALID_STATE', 'Yalnızca onaylanmış sürüm yayınlanabilir.');
  if (rv.is_example && !opts.allowExampleRules) throw forbidden('Örnek kurallar yalnızca demo ortamında yayınlanabilir.');
  await tx.query(`UPDATE rule_versions SET status = 'retired', retired_at = now() WHERE rule_id = $1 AND status = 'published'`, [rv.rule_id]);
  await tx.query(`UPDATE rule_versions SET status = 'published', published_by = $2, published_at = now() WHERE id = $1`, [id, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'rule.published', entityType: 'rule_version', entityId: id, payload: { code: rv.code, version: rv.version } });
  const companies = (await tx.query<{ id: string }>(`SELECT id FROM companies`)).rows;
  for (const c of companies) await recomputeCompany(tx, c.id, p.userId);
  return { recomputedCompanies: companies.length };
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
