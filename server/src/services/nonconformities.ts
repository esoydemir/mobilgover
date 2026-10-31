import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { RECURRENCE_WINDOW_DAYS, assessRisk, canClose, type Severity, type Step } from '../domain/nonconformity';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';

/** Example response windows per risk level; a company sets its own in production. */
const RESPONSE_HOURS: Record<string, number> = { critical: 4, high: 24, medium: 72, low: 168 };

/**
 * Opens a nonconformity for a task that came out nonconforming. Repeats are
 * counted by structure (same equipment and hazard type in the window), not by
 * text similarity, and raise the risk level and the process depth.
 */
export async function createFromTask(tx: Tx, p: Principal, companyId: string, task: any, measurement: any | null, reasons: string[]) {
  const recurrence = (await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM nonconformities
      WHERE company_id = $1 AND hazard_type = $2 AND equipment_id IS NOT DISTINCT FROM $3
        AND detected_at > now() - make_interval(days => $4)`,
    [companyId, task.hazard_type, task.equipment_id, RECURRENCE_WINDOW_DAYS])).rows[0]!.n;
  const risk = assessRisk(task.severity as Severity, recurrence);
  const title = measurement
    ? `${task.title}: ${measurement.value} ${measurement.unit} (limit ${measurement.limit_min ?? '—'}…${measurement.limit_max ?? '—'} ${measurement.unit})`
    : `${task.title}: uygunsuz sonuç`;
  const r = await tx.query<{ id: string }>(
    `INSERT INTO nonconformities (company_id, site_id, task_id, measurement_id, equipment_id, hazard_type, title, description,
        risk_level, risk_rationale, recurrence_count, depth, emergency_instruction, due_at, detected_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() + make_interval(hours => $14), $15) RETURNING id`,
    [companyId, task.site_id, task.id, measurement?.id ?? null, task.equipment_id, task.hazard_type, title, reasons.join('; '),
      risk.level, JSON.stringify({ ...risk.rationale, steps: risk.steps, independentVerification: risk.independentVerification }),
      recurrence, risk.depth, task.emergency_approved_by ? task.emergency_instruction : null, RESPONSE_HOURS[risk.level], p.userId]);
  const id = r.rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.opened', entityType: 'nonconformity', entityId: id,
    payload: { taskId: task.id, riskLevel: risk.level, depth: risk.depth, recurrence, reasons } });
  return id;
}

async function load(tx: Tx, p: Principal, companyId: string, id: string, action: 'ncr.read' | 'ncr.act' | 'ncr.verify_close') {
  const n = (await tx.query(`SELECT * FROM nonconformities WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
  if (!n || !can(p, action, { companyId, siteId: n.site_id, assigneeId: n.owner_id }).ok) {
    if (n && action !== 'ncr.read' && can(p, 'ncr.read', { companyId, siteId: n.site_id, assigneeId: n.owner_id }).ok) throw forbidden();
    throw notFound('Uygunsuzluk');
  }
  return n;
}

const requiredSteps = (n: any): Step[] => n.risk_rationale.steps;

export async function getNonconformity(tx: Tx, p: Principal, companyId: string, id: string) {
  const n = await load(tx, p, companyId, id, 'ncr.read');
  const steps = (await tx.query(`SELECT step, notes, done_by, done_at FROM ncr_steps WHERE ncr_id = $1 ORDER BY done_at`, [id])).rows;
  return {
    ...n, requiredSteps: requiredSteps(n), steps,
    closable: canClose({ steps: requiredSteps(n), independentVerification: n.risk_rationale.independentVerification },
      steps.map(s => ({ step: s.step, doneBy: s.done_by })), p.userId),
  };
}

/** Steps must follow the process order; correction never stands in for corrective action. */
const PREREQ: Partial<Record<Step, Step[]>> = {
  correction: ['containment'],
  corrective_action: ['root_cause'],
  effectiveness_check: ['correction', 'corrective_action'],
};

export async function completeStep(tx: Tx, p: Principal, companyId: string, id: string, step: Step, notes: string) {
  const n = await load(tx, p, companyId, id, 'ncr.act');
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı uygunsuzlukta adım eklenemez.');
  const req = requiredSteps(n);
  if (!req.includes(step)) throw invalid(`Bu kayıt için "${step}" adımı gerekmiyor (risk: ${n.risk_level}).`);
  if (notes.trim().length < 5) throw invalid('Adım için ne yapıldığını yaz.');
  const done = new Set((await tx.query<{ step: Step }>(`SELECT step FROM ncr_steps WHERE ncr_id = $1`, [id])).rows.map(r => r.step));
  if (done.has(step)) throw conflict('STEP_ALREADY_DONE', 'Bu adım zaten tamamlanmış.');
  const missing = (PREREQ[step] ?? []).filter(s => req.includes(s) && !done.has(s));
  if (missing.length) throw invalid(`Önce şu adımlar tamamlanmalı: ${missing.join(', ')}`);
  await tx.query(`INSERT INTO ncr_steps (company_id, ncr_id, step, notes, done_by) VALUES ($1,$2,$3,$4,$5)`, [companyId, id, step, notes, p.userId]);
  done.add(step);
  if (req.every(s => done.has(s))) await tx.query(`UPDATE nonconformities SET status = 'awaiting_verification' WHERE id = $1`, [id]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.step_done', entityType: 'nonconformity', entityId: id, payload: { step, notes } });
}

export async function closeNonconformity(tx: Tx, p: Principal, companyId: string, id: string, notes: string) {
  const n = await load(tx, p, companyId, id, 'ncr.verify_close');
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Bu uygunsuzluk zaten kapalı.');
  const steps = (await tx.query(`SELECT step, done_by FROM ncr_steps WHERE ncr_id = $1`, [id])).rows;
  const check = canClose({ steps: requiredSteps(n), independentVerification: n.risk_rationale.independentVerification },
    steps.map(s => ({ step: s.step, doneBy: s.done_by })), p.userId);
  if (!check.ok) throw new AppError(422, check.code, check.message);
  await tx.query(`UPDATE nonconformities SET status = 'closed', closed_by = $2, closed_at = clock_timestamp() WHERE id = $1`, [id, p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.closed', entityType: 'nonconformity', entityId: id, payload: { notes } });
}
