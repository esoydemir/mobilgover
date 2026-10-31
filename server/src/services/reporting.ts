import type { Tx } from '../db/pool';
import { forbidden } from '../domain/errors';
import { computeIndicators } from '../domain/indicators';
import { can, type Principal } from '../domain/permissions';
import type { EvidenceStore } from '../storage/local';
import { appendAudit, verifyCompanyChain } from './audit';
import { verifyStoredFiles } from './evidence';
import { currentObligations } from './obligations';

export type Period = { siteId?: string; from: string; to: string };

export async function indicators(tx: Tx, p: Principal, companyId: string, q: Period) {
  if (!can(p, 'indicators.read', { companyId, siteId: q.siteId ?? null }).ok) throw forbidden();
  const t = (await tx.query(
    `SELECT
       count(*) FILTER (WHERE due_at <= now()) AS due,
       count(*) FILTER (WHERE due_at <= now() AND status = 'done' AND completed_at <= due_at) AS on_time,
       count(*) FILTER (WHERE status = 'done') AS done,
       count(*) FILTER (WHERE status = 'done' AND outcome = 'conforming') AS conforming,
       count(*) FILTER (WHERE status = 'done' AND NOT EXISTS (
         SELECT 1 FROM evidence e WHERE e.task_id = t.id AND e.status <> 'stored')) AS covered,
       count(*) FILTER (WHERE status IN ('open','missed') AND due_at < now()) AS overdue
     FROM tasks t
    WHERE company_id = $1 AND ($2::uuid IS NULL OR site_id = $2) AND status <> 'cancelled' AND due_at >= $3 AND due_at < $4`,
    [companyId, q.siteId ?? null, q.from, q.to])).rows[0];
  const n = (await tx.query(
    `SELECT count(*) FILTER (WHERE status <> 'closed' AND risk_level IN ('high','critical')) AS critical,
            count(*) FILTER (WHERE status <> 'closed' AND recurrence_count >= 2) AS recurring
       FROM nonconformities WHERE company_id = $1 AND ($2::uuid IS NULL OR site_id = $2)`, [companyId, q.siteId ?? null])).rows[0];
  const obl = await currentObligations(tx, companyId, q.siteId);
  return computeIndicators({
    dueTasks: +t.due, onTimeTasks: +t.on_time, doneTasks: +t.done, conformingTasks: +t.conforming,
    doneWithCompleteEvidence: +t.covered, overdueTasks: +t.overdue,
    openCriticalOrHighNcrs: +n.critical, recurringNcrs: +n.recurring,
    obligationsNeedingInfo: obl.filter(o => o.decision === 'needs_info').length,
    obligationsNeedingReview: obl.filter(o => o.decision === 'needs_review').length,
  });
}

/**
 * Audit file. It lists gaps, open nonconformities, missed checks, unknowns and
 * integrity results alongside completed work; a file with only good news
 * would mislead an inspector.
 */
export async function auditExport(tx: Tx, store: EvidenceStore, p: Principal, companyId: string, q: Period) {
  if (!can(p, 'audit.export', { companyId, siteId: q.siteId ?? null }).ok) throw forbidden();
  const company = (await tx.query(`SELECT id, name, is_demo FROM companies WHERE id = $1`, [companyId])).rows[0];
  const obligations = await currentObligations(tx, companyId, q.siteId);
  const tasks = (await tx.query(
    `SELECT t.id, t.site_id, t.status, t.outcome, t.due_at, t.completed_at, t.completed_by, t.review_flag, t.status_reason,
            tt.title, rv.version AS rule_version, r.code AS rule_code, rv.is_example
       FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = t.rule_id
      WHERE t.company_id = $1 AND ($2::uuid IS NULL OR t.site_id = $2) AND t.due_at >= $3 AND t.due_at < $4 ORDER BY t.due_at`,
    [companyId, q.siteId ?? null, q.from, q.to])).rows;
  const ncrs = (await tx.query(
    `SELECT id, site_id, title, risk_level, depth, status, recurrence_count, detected_at, closed_at, closed_by
       FROM nonconformities WHERE company_id = $1 AND ($2::uuid IS NULL OR site_id = $2)
        AND (detected_at < $4 AND (closed_at IS NULL OR closed_at >= $3)) ORDER BY detected_at`,
    [companyId, q.siteId ?? null, q.from, q.to])).rows;
  const ruleVersions = (await tx.query(
    `SELECT DISTINCT r.code, rv.version, rv.kind, rv.is_example, rv.status, rv.effective_from
       FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id JOIN rules r ON r.id = o.rule_id WHERE o.company_id = $1 ORDER BY r.code, rv.version`,
    [companyId])).rows;
  const files = await verifyStoredFiles(tx, store, companyId, tasks.map(t => t.id));
  const chain = await verifyCompanyChain(tx, companyId);
  const now = new Date().toISOString();

  const gaps = [
    ...obligations.filter(o => o.decision === 'needs_info').map(o => ({ type: 'missing_profile_info', rule: o.rule_code, facts: o.missing_facts })),
    ...obligations.filter(o => o.decision === 'needs_review').map(o => ({ type: 'needs_expert_review', rule: o.rule_code })),
    ...tasks.filter(t => (t.status === 'open' || t.status === 'missed') && t.due_at < now).map(t => ({ type: 'overdue_check', taskId: t.id, title: t.title, dueAt: t.due_at })),
    ...tasks.filter(t => t.review_flag).map(t => ({ type: 'needs_review', taskId: t.id, flag: t.review_flag })),
    ...files.filter(f => f.status !== 'intact').map(f => ({ type: 'evidence_integrity', evidenceId: f.evidenceId, status: f.status })),
  ];
  const result = {
    scope: { company: company.name, companyId, siteId: q.siteId ?? null, isDemo: company.is_demo },
    period: { from: q.from, to: q.to },
    generatedAt: now,
    generatedBy: p.userId,
    disclaimer: 'Bu dosya GoverHub kayıtlarının dökümüdür; resmî denetim sonucu veya hukuki uygunluk beyanı değildir.',
    exampleContentWarning: ruleVersions.some(r => r.is_example) ? 'Bu dosya ÖRNEK kurallara dayanan kayıtlar içeriyor; hukuki dayanakları doğrulanmamıştır.' : null,
    ruleVersions,
    obligations: obligations.map(o => ({ rule: o.rule_code, version: o.rule_version, decision: o.decision, decidedBy: o.decided_by, reason: o.reason, isExample: o.is_example })),
    summary: {
      tasks: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      nonconforming: tasks.filter(t => t.outcome === 'nonconforming').length,
      overdue: gaps.filter(g => g.type === 'overdue_check').length,
      openNonconformities: ncrs.filter(n => n.status !== 'closed').length,
    },
    gaps,
    tasks,
    nonconformities: ncrs,
    integrity: { auditChain: chain, files },
  };
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'audit.exported', entityType: 'company', entityId: companyId, payload: { period: result.period, siteId: q.siteId ?? null, gaps: gaps.length } });
  return result;
}
