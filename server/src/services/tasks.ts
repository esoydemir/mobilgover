import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { assessEvidence, evidenceRequirementSchema, limitSchema, selectLimit, withinLimit, type EvidenceRequirement } from '../domain/evidence';
import { can, onlyAssignedTasks, type Principal } from '../domain/permissions';
import { localDay, occurrences, type Recurrence } from '../domain/schedule';
import { ALLOWED_MIME } from '../storage/local';
import { appendAudit } from './audit';
import { createFromTask } from './nonconformities';
import { currentObligations } from './obligations';

/** Device clocks may drift a little; anything further in the future is rejected. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Creates task occurrences for obligations that currently apply. Safe to
 * re-run: the unique index turns an existing period into a no-op.
 */
export async function generateTasks(tx: Tx, companyId: string, siteId: string, fromDay: string, toDay: string) {
  const site = (await tx.query(`SELECT * FROM sites WHERE id = $1 AND company_id = $2`, [siteId, companyId])).rows[0];
  if (!site) throw notFound('Şube');
  const closures = (await tx.query<{ day: string }>(`SELECT day FROM site_closures WHERE site_id = $1`, [siteId])).rows.map(r => r.day);
  const cal = { timezone: site.timezone, openingDays: site.opening_days, closures };
  const applying = (await currentObligations(tx, companyId, siteId)).filter(o => o.decision === 'applies');
  let created = 0, existing = 0;

  for (const o of applying) {
    const templates = (await tx.query(`SELECT * FROM task_templates WHERE rule_version_id = $1`, [o.rule_version_id])).rows;
    for (const t of templates) {
      const rec = t.recurrence as Recurrence & { perEquipmentType?: string };
      const targets: (string | null)[] = rec.perEquipmentType
        ? (await tx.query<{ id: string }>(`SELECT id FROM equipment WHERE company_id = $1 AND site_id = $2 AND type = $3 AND active`,
            [companyId, siteId, rec.perEquipmentType])).rows.map(r => r.id)
        : [null];
      for (const equipmentId of targets) {
        for (const occ of occurrences(rec, cal, fromDay, toDay)) {
          // The person responsible for this check (if set and still an eligible active member) gets the task.
          const r = await tx.query(
            `INSERT INTO tasks (company_id, site_id, obligation_id, template_id, rule_id, template_code, equipment_id, period_key, due_at, assignee_id, assigned_by, assigned_at)
             SELECT $1,$2,$3,$4,$5,$6,$7::uuid,$8,$9, d.user_id, d.set_by, CASE WHEN d.user_id IS NULL THEN NULL ELSE now() END
               FROM (SELECT 1) one
               LEFT JOIN task_assignment_defaults d
                 ON d.company_id = $1 AND d.site_id = $2 AND d.template_code = $6 AND d.equipment_id IS NOT DISTINCT FROM $7::uuid
                AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = d.user_id AND m.company_id = $1 AND m.status = 'active'
                              AND (m.site_id IS NULL OR m.site_id = $2))
             ON CONFLICT DO NOTHING`,
            [companyId, siteId, o.id, t.id, o.rule_id, t.code, equipmentId, occ.periodKey, occ.dueAt.toISOString()]);
          if (r.rowCount) created++; else existing++;
        }
      }
    }
  }
  if (created) {
    await appendAudit(tx, { companyId, actorId: null, eventType: 'tasks.generated', entityType: 'site', entityId: siteId, payload: { fromDay, toDay, created } });
  }
  return { created, existing };
}

async function loadTask(tx: Tx, p: Principal, companyId: string, taskId: string, action: 'task.read' | 'task.execute') {
  const t = (await tx.query(
    `SELECT t.*, tt.title, tt.instructions, tt.evidence, tt.limits, tt.severity, tt.hazard_type, tt.emergency_instruction, tt.emergency_approved_by,
            e.type AS equipment_type, e.name AS equipment_name, rv.is_example, rv.kind AS rule_kind, rv.version AS rule_version
       FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id
       LEFT JOIN equipment e ON e.id = t.equipment_id
      WHERE t.id = $1 AND t.company_id = $2`, [taskId, companyId])).rows[0];
  // Unauthorized and nonexistent look the same, so task ids cannot be probed.
  if (!t || !can(p, action, { companyId, siteId: t.site_id, assigneeId: t.assignee_id }).ok) throw notFound('Görev');
  return t;
}

export async function listTasks(tx: Tx, p: Principal, companyId: string, q: { siteId?: string; from?: string; to?: string; status?: string }) {
  const assignedOnly = onlyAssignedTasks(p, companyId);
  const r = await tx.query(
    `SELECT t.id, t.site_id, t.status, t.outcome, t.due_at, t.period_key, t.review_flag, t.assignee_id, t.equipment_id,
            tt.title, tt.severity, e.name AS equipment_name, au.display_name AS assignee_name
       FROM tasks t JOIN task_templates tt ON tt.id = t.template_id LEFT JOIN equipment e ON e.id = t.equipment_id
       LEFT JOIN users au ON au.id = t.assignee_id
      WHERE t.company_id = $1 AND ($2::uuid IS NULL OR t.site_id = $2)
        AND ($3::timestamptz IS NULL OR t.due_at >= $3) AND ($4::timestamptz IS NULL OR t.due_at < $4)
        AND ($5::text IS NULL OR t.status = $5) AND (NOT $6 OR t.assignee_id = $7)
      ORDER BY t.due_at, tt.title`,
    [companyId, q.siteId ?? null, q.from ?? null, q.to ?? null, q.status ?? null, assignedOnly, p.userId]);
  return r.rows.filter(t => can(p, 'task.read', { companyId, siteId: t.site_id, assigneeId: t.assignee_id }).ok);
}

async function collected(tx: Tx, taskId: string) {
  const m = await tx.query(`SELECT * FROM measurements WHERE task_id = $1 ORDER BY recorded_at`, [taskId]);
  const e = await tx.query(`SELECT id, kind, status, mime, sha256, size_bytes, body, created_at, stored_at, rejection_reason FROM evidence WHERE task_id = $1 ORDER BY created_at`, [taskId]);
  return { measurements: m.rows, evidence: e.rows };
}

export async function taskDetail(tx: Tx, p: Principal, companyId: string, taskId: string) {
  const t = await loadTask(tx, p, companyId, taskId, 'task.read');
  const c = await collected(tx, taskId);
  const ncr = (await tx.query(`SELECT id, status, risk_level, depth FROM nonconformities WHERE task_id = $1`, [taskId])).rows[0] ?? null;
  const reqs = (t.evidence as unknown[]).map(x => evidenceRequirementSchema.parse(x));
  return {
    id: t.id, status: t.status, outcome: t.outcome, dueAt: t.due_at, periodKey: t.period_key, reviewFlag: t.review_flag,
    title: t.title, instructions: t.instructions, severity: t.severity,
    equipment: t.equipment_id ? { id: t.equipment_id, name: t.equipment_name, type: t.equipment_type } : null,
    rule: { version: t.rule_version, kind: t.rule_kind, isExample: t.is_example },
    obligationId: t.obligation_id,
    requirements: reqs,
    limits: t.limits,
    // Only an approved emergency instruction is shown; nothing is improvised.
    emergencyInstruction: t.emergency_approved_by ? t.emergency_instruction : null,
    progress: assessEvidence(reqs, toCollected(c)),
    measurements: c.measurements, evidence: c.evidence, nonconformity: ncr,
    completedBy: t.completed_by, completedAt: t.completed_at, statusReason: t.status_reason,
    assignee: t.assignee_id ? { id: t.assignee_id, name: await userName(tx, t.assignee_id) } : null,
    // Who is responsible for this recurring check from now on (null = nobody set).
    seriesResponsible: await seriesResponsible(tx, companyId, t.site_id, t.template_code, t.equipment_id),
    canAssign: can(p, 'task.assign', { companyId, siteId: t.site_id }).ok,
  };
}

async function userName(tx: Tx, userId: string) {
  return (await tx.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [userId])).rows[0]?.display_name ?? null;
}

async function seriesResponsible(tx: Tx, companyId: string, siteId: string, templateCode: string, equipmentId: string | null) {
  const d = (await tx.query(
    `SELECT d.user_id, u.display_name FROM task_assignment_defaults d JOIN users u ON u.id = d.user_id
      WHERE d.company_id = $1 AND d.site_id = $2 AND d.template_code = $3 AND d.equipment_id IS NOT DISTINCT FROM $4::uuid`,
    [companyId, siteId, templateCode, equipmentId])).rows[0];
  return d ? { id: d.user_id as string, name: d.display_name as string } : null;
}

/** Active members who may be given work at this site: company-wide roles, or anyone whose membership is this site. */
export async function assignableMembers(tx: Tx, p: Principal, companyId: string, siteId: string) {
  if (!can(p, 'task.assign', { companyId, siteId }).ok) throw forbidden();
  return (await tx.query(
    `SELECT DISTINCT ON (u.id) u.id, u.display_name, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = $1 AND m.status = 'active' AND (m.site_id IS NULL OR m.site_id = $2)
      ORDER BY u.id, m.role`, [companyId, siteId])).rows
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || String(a.display_name).localeCompare(String(b.display_name), 'tr'));
}
const ROLE_ORDER = ['staff', 'site_manager', 'hq_manager', 'owner'];

/**
 * Assigns an open task (or clears the assignment). With `applyToFuture`, the person
 * becomes responsible for this recurring check: later open tasks of the same check
 * are reassigned and newly generated ones are assigned automatically.
 */
export async function assignTask(tx: Tx, p: Principal, companyId: string, taskId: string, b: { userId: string | null; applyToFuture: boolean }) {
  const t = await loadTask(tx, p, companyId, taskId, 'task.read');
  if (!can(p, 'task.assign', { companyId, siteId: t.site_id }).ok) throw forbidden('Görev atama yetkin yok.');
  assertOpen(t);
  if (b.userId) {
    const ok = (await tx.query(
      `SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND (site_id IS NULL OR site_id = $3)`,
      [b.userId, companyId, t.site_id])).rowCount;
    if (!ok) throw invalid('Bu kişi bu şubede görev alamaz (etkin üye değil ya da başka şubede).');
  }
  await tx.query(`UPDATE tasks SET assignee_id = $3, assigned_by = $4, assigned_at = now() WHERE id = $1 AND company_id = $2`,
    [taskId, companyId, b.userId, p.userId]);
  let alsoAssigned = 0;
  if (b.applyToFuture) {
    await tx.query(`DELETE FROM task_assignment_defaults WHERE company_id = $1 AND site_id = $2 AND template_code = $3 AND equipment_id IS NOT DISTINCT FROM $4::uuid`,
      [companyId, t.site_id, t.template_code, t.equipment_id]);
    if (b.userId) {
      await tx.query(`INSERT INTO task_assignment_defaults (company_id, site_id, template_code, equipment_id, user_id, set_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [companyId, t.site_id, t.template_code, t.equipment_id, b.userId, p.userId]);
    }
    alsoAssigned = (await tx.query(
      `UPDATE tasks SET assignee_id = $5, assigned_by = $6, assigned_at = now()
        WHERE company_id = $1 AND site_id = $2 AND template_code = $3 AND equipment_id IS NOT DISTINCT FROM $4::uuid
          AND status = 'open' AND due_at >= now() AND id <> $7 AND assignee_id IS DISTINCT FROM $5`,
      [companyId, t.site_id, t.template_code, t.equipment_id, b.userId, p.userId, taskId])).rowCount ?? 0;
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'task.assigned', entityType: 'task', entityId: taskId,
    payload: { assigneeId: b.userId, applyToFuture: b.applyToFuture, alsoAssigned } });
  return { assigneeId: b.userId, alsoAssigned, seriesResponsible: b.applyToFuture ? (b.userId ? { id: b.userId, name: await userName(tx, b.userId) } : null) : undefined };
}

function toCollected(c: { measurements: any[]; evidence: any[] }) {
  const checklistRow = [...c.evidence].reverse().find(e => e.kind === 'checklist' && e.status === 'stored');
  return {
    measurements: c.measurements.map(m => ({ quantity: m.quantity, withinLimit: m.within_limit })),
    files: c.evidence.filter(e => ['photo', 'document', 'device_record'].includes(e.kind)).map(e => ({ kind: e.kind, status: e.status })),
    checklist: checklistRow ? checklistRow.body.answers : null,
    notes: c.evidence.filter(e => e.kind === 'note' && e.status === 'stored').length,
    approvals: c.evidence.filter(e => e.kind === 'approval' && e.status === 'stored').map(e => e.body.role),
  };
}

const assertOpen = (t: any) => {
  if (t.status === 'done') throw conflict('TASK_ALREADY_DONE', 'Bu görev zaten tamamlanmış.', { completedBy: t.completed_by, completedAt: t.completed_at, outcome: t.outcome });
  if (t.status !== 'open') throw conflict('TASK_NOT_OPEN', `Görev açık değil (${t.status}).`, { reason: t.status_reason });
};

export type MeasurementInput = { quantity: string; value: number; unit: string; measuredAt: string; instrumentId?: string | null; productCategory?: string };

/**
 * Records a measurement against the limit that belongs to this equipment
 * type. An out-of-limit value is accepted and stored as such: the check was
 * done, the result is nonconforming.
 */
export async function recordMeasurement(tx: Tx, p: Principal, companyId: string, taskId: string, m: MeasurementInput) {
  const t = await loadTask(tx, p, companyId, taskId, 'task.execute');
  assertOpen(t);
  const req = (t.evidence as EvidenceRequirement[]).find(r => r.kind === 'measurement' && r.quantity === m.quantity);
  if (!req) throw invalid(`Bu görev "${m.quantity}" ölçümü istemiyor.`);
  const measuredAt = new Date(m.measuredAt);
  if (Number.isNaN(measuredAt.getTime())) throw invalid('Ölçüm zamanı geçersiz.');
  if (measuredAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) throw invalid('Ölçüm zamanı gelecekte olamaz; cihaz saatini kontrol et.');

  const limits = (t.limits as unknown[]).map(l => limitSchema.parse(l));
  const sel = selectLimit(limits, m.quantity, t.equipment_type, m.unit, m.productCategory);
  if (!sel.ok) throw new AppError(422, sel.code, sel.message);

  let calibration: 'valid' | 'expired' | 'unknown' = 'unknown';
  if (m.instrumentId) {
    const inst = (await tx.query(`SELECT calibrated_until FROM equipment WHERE id = $1 AND company_id = $2`, [m.instrumentId, companyId])).rows[0];
    if (!inst) throw notFound('Ölçüm cihazı');
    if (inst.calibrated_until) calibration = inst.calibrated_until >= localDay(measuredAt, 'UTC') ? 'valid' : 'expired';
  }
  const ok = withinLimit(m.value, sel.limit);
  const r = await tx.query<{ id: string }>(
    `INSERT INTO measurements (company_id, task_id, quantity, value, unit, measured_at, instrument_id, calibration_status, limit_min, limit_max, limit_source, within_limit, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, recorded_at`,
    [companyId, taskId, m.quantity, m.value, m.unit, measuredAt.toISOString(), m.instrumentId ?? null, calibration,
      sel.limit.min, sel.limit.max, JSON.stringify({ templateId: t.template_id, ruleVersion: t.rule_version, ...sel.limit }), ok, p.userId]);
  const id = r.rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'measurement.recorded', entityType: 'measurement', entityId: id,
    clientTime: measuredAt.toISOString(), payload: { taskId, value: m.value, unit: m.unit, withinLimit: ok, limit: sel.limit, calibration } });
  return { id, withinLimit: ok, limit: sel.limit, calibrationStatus: calibration };
}

export type EvidenceInput =
  | { kind: 'photo' | 'document' | 'device_record'; mime: string; sha256: string; sizeBytes: number }
  | { kind: 'note'; text: string }
  | { kind: 'checklist'; answers: Record<string, 'pass' | 'fail' | 'na'> }
  | { kind: 'approval'; role: 'owner' | 'hq_manager' | 'site_manager' };

/**
 * Files are registered first as `pending_upload` with the hash the device
 * computed; they count as evidence only after the bytes arrive and match.
 */
export async function addEvidence(tx: Tx, p: Principal, companyId: string, taskId: string, e: EvidenceInput) {
  const t = await loadTask(tx, p, companyId, taskId, 'task.execute');
  assertOpen(t);
  let row;
  if (e.kind === 'photo' || e.kind === 'document' || e.kind === 'device_record') {
    if (!ALLOWED_MIME.includes(e.mime)) throw invalid(`Dosya türü kabul edilmiyor: ${e.mime}`);
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) throw invalid('sha256 64 karakterlik onaltılık özet olmalı.');
    row = (await tx.query(
      `INSERT INTO evidence (company_id, task_id, kind, status, mime, declared_sha256, size_bytes, created_by)
       VALUES ($1,$2,$3,'pending_upload',$4,$5,$6,$7) RETURNING id, status`,
      [companyId, taskId, e.kind, e.mime, e.sha256, e.sizeBytes, p.userId])).rows[0];
  } else {
    if (e.kind === 'note' && e.text.trim().length < 3) throw invalid('Açıklama boş olamaz.');
    if (e.kind === 'approval') {
      // An approval is evidence only if the approver actually holds that role here.
      const holds = p.memberships.some(m => m.companyId === companyId && m.role === e.role && (!m.siteId || m.siteId === t.site_id));
      if (!holds) throw forbidden('Bu onayı verebilmek için o role sahip olmalısın.');
    }
    let body: Record<string, unknown>;
    if (e.kind === 'note') body = { text: e.text };
    else if (e.kind === 'checklist') body = { answers: e.answers };
    else if (e.kind === 'approval') body = { role: e.role };
    else throw invalid('Bilinmeyen kanıt türü.');
    row = (await tx.query(
      `INSERT INTO evidence (company_id, task_id, kind, status, body, created_by, stored_at)
       VALUES ($1,$2,$3,'stored',$4,$5, clock_timestamp()) RETURNING id, status`,
      [companyId, taskId, e.kind, JSON.stringify(body), p.userId])).rows[0];
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'evidence.added', entityType: 'evidence', entityId: row.id,
    payload: { taskId, kind: e.kind, status: row.status, sha256: 'sha256' in e ? e.sha256 : null } });
  return { id: row.id as string, status: row.status as string };
}

/**
 * Closes the check. Requires complete evidence (no pending uploads); records
 * the outcome honestly and opens a nonconformity when it is out of limit.
 */
export async function completeTask(tx: Tx, p: Principal, companyId: string, taskId: string, clientCompletedAt?: string) {
  await tx.query(`SELECT 1 FROM tasks WHERE id = $1 AND company_id = $2 FOR UPDATE`, [taskId, companyId]);
  const t = await loadTask(tx, p, companyId, taskId, 'task.execute');
  assertOpen(t);
  const reqs = (t.evidence as unknown[]).map(x => evidenceRequirementSchema.parse(x));
  const c = await collected(tx, taskId);
  const a = assessEvidence(reqs, toCollected(c));
  if (!a.complete) {
    throw new AppError(422, 'EVIDENCE_INCOMPLETE', 'Zorunlu kanıt tamamlanmadan görev kapatılamaz.', { missing: a.missing, pending: a.pending });
  }
  const outcome = a.nonconforming.length ? 'nonconforming' : 'conforming';

  // Done under an obligation that has since been superseded (e.g. offline): keep it, flag it for review.
  const cur = (await currentObligations(tx, companyId, t.site_id)).find(o => o.rule_id === t.rule_id);
  const reviewFlag = cur && cur.id !== t.obligation_id ? (cur.decision === 'applies' ? 'RULE_VERSION_CHANGED' : 'OBLIGATION_NO_LONGER_APPLIES') : t.review_flag;

  await tx.query(
    `UPDATE tasks SET status = 'done', outcome = $2, completed_by = $3, completed_at = clock_timestamp(), review_flag = $4 WHERE id = $1`,
    [taskId, outcome, p.userId, reviewFlag]);
  let nonconformityId: string | null = null;
  if (outcome === 'nonconforming') {
    const failed = c.measurements.find(m => !m.within_limit);
    nonconformityId = await createFromTask(tx, p, companyId, t, failed ?? null, a.nonconforming);
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'task.completed', entityType: 'task', entityId: taskId,
    clientTime: clientCompletedAt ?? null, payload: { outcome, reasons: a.nonconforming, nonconformityId, reviewFlag } });
  return { outcome, nonconformityId, reviewFlag, nonconformities: a.nonconforming };
}
