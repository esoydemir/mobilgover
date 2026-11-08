import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { RECURRENCE_WINDOW_DAYS, assessRisk, type Severity } from '../domain/nonconformity';
import { CAUSE_CATEGORIES, flow, suggestions, verifierConflict, type CauseCategory, type FlowInput } from '../domain/ncrflow';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify, siteManagers } from './notifications';

/** Example response windows per risk level; a company sets its own in production. */
const RESPONSE_HOURS: Record<string, number> = { critical: 4, high: 24, medium: 72, low: 168 };

/** Topics a person can pick when reporting a problem by hand (used for repeat counting). */
export const MANUAL_HAZARDS = ['cold_chain_temperature', 'personal_hygiene', 'gas_leak', 'equipment_failure', 'cleaning', 'other'] as const;

/** Equipment type → service category suggested for equipment causes (example categories). */
const SERVICE_FOR_EQUIPMENT: Record<string, string> = { refrigerator: 'refrigeration_service', freezer: 'refrigeration_service' };

async function recurrenceOf(tx: Tx, companyId: string, hazardType: string, equipmentId: string | null) {
  return (await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM nonconformities
      WHERE company_id = $1 AND hazard_type = $2 AND equipment_id IS NOT DISTINCT FROM $3
        AND detected_at > now() - make_interval(days => $4)`,
    [companyId, hazardType, equipmentId, RECURRENCE_WINDOW_DAYS])).rows[0]!.n;
}

/**
 * Opens a nonconformity for a task that came out nonconforming. Repeats are
 * counted by structure (same equipment and hazard type in the window), not by
 * text similarity, and raise the risk level and the process depth.
 */
export async function createFromTask(tx: Tx, p: Principal, companyId: string, task: any, measurement: any | null, reasons: string[]) {
  const recurrence = await recurrenceOf(tx, companyId, task.hazard_type, task.equipment_id);
  const risk = assessRisk(task.severity as Severity, recurrence);
  const title = measurement
    ? `${task.title}: ${measurement.value} ${measurement.unit} (limit ${measurement.limit_min ?? '—'}…${measurement.limit_max ?? '—'} ${measurement.unit})`
    : `${task.title}: uygunsuz sonuç`;
  const r = await tx.query<{ id: string }>(
    `INSERT INTO nonconformities (company_id, site_id, task_id, measurement_id, equipment_id, hazard_type, title, description,
        risk_level, risk_rationale, recurrence_count, depth, emergency_instruction, due_at, detected_by, severity, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() + make_interval(hours => $14), $15, $16, 'task') RETURNING id`,
    [companyId, task.site_id, task.id, measurement?.id ?? null, task.equipment_id, task.hazard_type, title, reasons.join('; '),
      risk.level, JSON.stringify({ ...risk.rationale, steps: risk.steps, independentVerification: risk.independentVerification }),
      recurrence, risk.depth, task.emergency_approved_by ? task.emergency_instruction : null, RESPONSE_HOURS[risk.level], p.userId, task.severity]);
  const id = r.rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.opened', entityType: 'nonconformity', entityId: id,
    payload: { taskId: task.id, riskLevel: risk.level, depth: risk.depth, recurrence, reasons } });
  await notifyNew(tx, companyId, task.site_id, id, title, risk.level, p.userId);
  return id;
}

export type ManualInput = { siteId: string; title: string; description: string; hazardType: string; severity: Severity; equipmentId: string | null; containment: string | null };

/**
 * A problem noticed outside a scheduled check. Anyone working at the site may report it.
 * Risk is sized the same way as for task findings. A staff reporter stays responsible
 * (so they can record the first response) until a manager assigns someone.
 */
export async function createManual(tx: Tx, p: Principal, companyId: string, b: ManualInput) {
  if (!can(p, 'ncr.report', { companyId, siteId: b.siteId }).ok) throw forbidden('Bu şubede uygunsuzluk bildirme yetkin yok.');
  if (b.equipmentId) {
    const e = (await tx.query(`SELECT 1 FROM equipment WHERE id = $1 AND company_id = $2 AND site_id = $3`, [b.equipmentId, companyId, b.siteId])).rowCount;
    if (!e) throw invalid('Seçilen ekipman bu şubede değil.');
  }
  const recurrence = await recurrenceOf(tx, companyId, b.hazardType, b.equipmentId);
  const risk = assessRisk(b.severity, recurrence);
  const isManager = can(p, 'ncr.manage', { companyId, siteId: b.siteId }).ok;
  const owner = isManager ? null : p.userId;
  const r = await tx.query<{ id: string }>(
    `INSERT INTO nonconformities (company_id, site_id, equipment_id, hazard_type, title, description, risk_level, risk_rationale, recurrence_count,
        depth, due_at, detected_by, severity, source, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(hours => $11), $12, $13, 'manual', $14) RETURNING id`,
    [companyId, b.siteId, b.equipmentId, b.hazardType, b.title, b.description, risk.level,
      JSON.stringify({ ...risk.rationale, steps: risk.steps, independentVerification: risk.independentVerification }),
      recurrence, risk.depth, RESPONSE_HOURS[risk.level], p.userId, b.severity, owner]);
  const id = r.rows[0]!.id;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.opened', entityType: 'nonconformity', entityId: id,
    payload: { source: 'manual', riskLevel: risk.level, depth: risk.depth, recurrence, hazardType: b.hazardType, severity: b.severity } });
  if (b.containment && b.containment.trim().length >= 5) {
    await tx.query(`INSERT INTO ncr_steps (company_id, ncr_id, step, notes, done_by, iteration) VALUES ($1,$2,'containment',$3,$4,1)`, [companyId, id, b.containment.trim(), p.userId]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.step_done', entityType: 'nonconformity', entityId: id, payload: { step: 'containment', notes: b.containment.trim() } });
  }
  await notifyNew(tx, companyId, b.siteId, id, b.title, risk.level, p.userId);
  return { id, riskLevel: risk.level, depth: risk.depth, recurrence };
}

async function notifyNew(tx: Tx, companyId: string, siteId: string, id: string, title: string, risk: string, actor: string) {
  await notify(tx, { companyId, siteId, userIds: await siteManagers(tx, companyId, siteId), except: actor,
    kind: 'ncr_reported', entityType: 'nonconformity', entityId: id, dedupeKey: `ncr_reported:${id}`,
    title: 'Yeni uygunsuzluk: sorumlu ve termin bekliyor', body: `${title} · risk ${RISK_TR[risk] ?? risk}` });
}
const RISK_TR: Record<string, string> = { low: 'düşük', medium: 'orta', high: 'yüksek', critical: 'kritik' };

/** Loads with access check. Staff may work on a case they own or hold an action in. */
async function load(tx: Tx, p: Principal, companyId: string, id: string, action: 'ncr.read' | 'ncr.act' | 'ncr.verify_close' | 'ncr.manage', forUpdate = false) {
  const n = (await tx.query(`SELECT * FROM nonconformities WHERE id = $1 AND company_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`, [id, companyId])).rows[0];
  if (!n) throw notFound('Uygunsuzluk');
  const actionOwner = (await tx.query(`SELECT 1 FROM ncr_actions WHERE ncr_id = $1 AND owner_id = $2 LIMIT 1`, [id, p.userId])).rowCount;
  const target = { companyId, siteId: n.site_id, assigneeId: n.owner_id === p.userId || actionOwner ? p.userId : n.owner_id };
  if (!can(p, action, target).ok) {
    if (action !== 'ncr.read' && can(p, 'ncr.read', target).ok) throw forbidden();
    throw notFound('Uygunsuzluk');
  }
  return n;
}

async function flowData(tx: Tx, n: any) {
  const steps = (await tx.query(`SELECT s.step, s.notes, s.done_by, s.done_at, s.iteration, u.display_name AS done_by_name
     FROM ncr_steps s JOIN users u ON u.id = s.done_by WHERE s.ncr_id = $1 ORDER BY s.done_at`, [n.id])).rows;
  const causes = (await tx.query(`SELECT c.id, c.stage, c.iteration, c.categories, c.notes, c.migrated, c.done_by, c.done_at, u.display_name AS done_by_name
     FROM ncr_cause_assessments c JOIN users u ON u.id = c.done_by WHERE c.ncr_id = $1 ORDER BY c.done_at`, [n.id])).rows;
  const actions = (await tx.query(`SELECT a.*, ou.display_name AS owner_name, du.display_name AS done_by_name,
       (a.status = 'open' AND a.due_at IS NOT NULL AND a.due_at < now()) AS overdue,
       (a.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = a.owner_id AND m.company_id = a.company_id
          AND m.status = 'active' AND (m.site_id IS NULL OR m.site_id = $2))) AS owner_inactive
     FROM ncr_actions a LEFT JOIN users ou ON ou.id = a.owner_id LEFT JOIN users du ON du.id = a.done_by
    WHERE a.ncr_id = $1 ORDER BY a.created_at`, [n.id, n.site_id])).rows;
  const verifications = (await tx.query(`SELECT v.iteration, v.result, v.notes, v.verified_by, v.verified_at, u.display_name AS verified_by_name
     FROM ncr_verifications v JOIN users u ON u.id = v.verified_by WHERE v.ncr_id = $1 ORDER BY v.verified_at`, [n.id])).rows;
  const input: FlowInput = {
    flowVersion: n.flow_version, depth: n.depth, status: n.status, iteration: n.iteration, ownerId: n.owner_id, dueAt: n.due_at,
    independentVerification: !!n.risk_rationale.independentVerification,
    steps: steps.map(s => ({ step: s.step, iteration: s.iteration, doneBy: s.done_by })),
    causes: causes.map(c => ({ stage: c.stage, iteration: c.iteration, categories: c.categories, migrated: c.migrated })),
    actions: actions.map(a => ({ kind: a.kind, iteration: a.iteration, status: a.status, doneBy: a.done_by })),
  };
  return { steps, causes, actions, verifications, input };
}

export async function getNonconformity(tx: Tx, p: Principal, companyId: string, id: string) {
  const n = await load(tx, p, companyId, id, 'ncr.read');
  const d = await flowData(tx, n);
  const f = flow(d.input);
  const target = { companyId, siteId: n.site_id, assigneeId: n.owner_id === p.userId || d.actions.some(a => a.owner_id === p.userId) ? p.userId : n.owner_id };
  const latestInitial = [...d.causes].reverse().find(c => c.stage === 'initial');
  const latestVerified = [...d.causes].reverse().find(c => c.stage === 'verified');
  const equipment = n.equipment_id ? (await tx.query(`SELECT id, name, type FROM equipment WHERE id = $1`, [n.equipment_id])).rows[0] : null;
  const task = n.task_id ? (await tx.query(`SELECT t.id, t.obligation_id, tt.title, tt.instructions FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.id = $1`, [n.task_id])).rows[0] : null;
  const services = (await tx.query(`SELECT r.id, r.title, r.status, r.category_code, j.status AS job_status FROM service_requests r
     LEFT JOIN service_jobs j ON j.request_id = r.id WHERE r.company_id = $1 AND r.ncr_id = $2 ORDER BY r.created_at`, [companyId, id])).rows;
  const owner = n.owner_id ? (await tx.query(`SELECT u.display_name, EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.company_id = $2
       AND m.status = 'active' AND (m.site_id IS NULL OR m.site_id = $3)) AS active FROM users u WHERE u.id = $1`, [n.owner_id, companyId, n.site_id])).rows[0] : null;
  const history = (await tx.query(`SELECT e.event_type, e.payload, e.occurred_at, u.display_name AS actor_name FROM audit_events e
     LEFT JOIN users u ON u.id = e.actor_id WHERE e.company_id = $1 AND e.entity_type = 'nonconformity' AND e.entity_id = $2 ORDER BY e.seq`, [companyId, id])).rows;
  const canVerify = can(p, 'ncr.verify_close', target).ok;
  return {
    ...n,
    // Kept for older app versions.
    requiredSteps: n.risk_rationale.steps, closable: { ok: false },
    owner: n.owner_id ? { id: n.owner_id, name: owner?.display_name ?? null, active: !!owner?.active } : null,
    overdue: n.status !== 'closed' && !!n.due_at && new Date(n.due_at) < new Date(),
    equipment, task,
    flow: f,
    steps: d.steps, causes: d.causes, actions: d.actions, verifications: d.verifications, services, history,
    cause: { initial: latestInitial ?? null, verified: latestVerified ?? null },
    suggestions: latestInitial ? suggestions(latestInitial.categories as CauseCategory[], {
      hasEquipment: !!equipment, hasObligation: !!task?.obligation_id, serviceCategory: equipment ? SERVICE_FOR_EQUIPMENT[equipment.type] ?? null : null,
    }).map(s => ({ ...s, serviceCategory: s.kind === 'service_request' && equipment ? SERVICE_FOR_EQUIPMENT[equipment.type] ?? null : null })) : [],
    permissions: {
      act: can(p, 'ncr.act', target).ok,
      manage: can(p, 'ncr.manage', target).ok,
      verify: canVerify && n.status === 'awaiting_verification' && !verifierConflict(d.input, p.userId),
      verifyBlockedReason: canVerify && n.status === 'awaiting_verification' && verifierConflict(d.input, p.userId)
        ? 'Bu turdaki düzeltmeyi sen yaptın; yüksek riskli kaydı başka bir yetkili doğrulamalı.' : null,
      reopen: canVerify && n.status === 'closed',
      serviceRequest: can(p, 'service.request', target).ok,
    },
  };
}

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

/** Owner and due date (managers). Every change is in the audit history with its reason. */
export async function setAssignment(tx: Tx, p: Principal, companyId: string, id: string, b: { ownerId: string; dueAt: string; reason: string | null }) {
  const n = await load(tx, p, companyId, id, 'ncr.manage', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta sorumlu değiştirilemez; önce yeniden aç.');
  await assertEligible(tx, companyId, n.site_id, b.ownerId);
  const due = new Date(b.dueAt);
  if (Number.isNaN(due.getTime())) throw invalid('Geçerli bir termin gir.');
  const changingDue = n.due_at && iso(n.due_at) !== due.toISOString();
  // The first due date comes from the example response-time policy; a manager may set it once freely.
  // Later changes need a reason (kept in the history).
  if (changingDue && n.assigned_by && (b.reason ?? '').trim().length < 5) throw invalid('Termini değiştirmek için gerekçe yaz.');
  if (n.owner_id === b.ownerId && !changingDue) return { changed: false };
  await tx.query(`UPDATE nonconformities SET owner_id = $3, due_at = $4, assigned_by = $5, assigned_at = now() WHERE id = $1 AND company_id = $2`,
    [id, companyId, b.ownerId, due.toISOString(), p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.assigned', entityType: 'nonconformity', entityId: id,
    payload: { owner: { from: n.owner_id, to: b.ownerId }, dueAt: { from: iso(n.due_at), to: due.toISOString() }, reason: b.reason?.trim() || null } });
  if (n.owner_id !== b.ownerId || changingDue) {
    await notify(tx, { companyId, siteId: n.site_id, userIds: [b.ownerId], except: p.userId, kind: 'ncr_assigned', entityType: 'nonconformity', entityId: id,
      dedupeKey: `ncr_assigned:${id}:${b.ownerId}:${due.toISOString()}`,
      title: n.owner_id === b.ownerId ? 'Uygunsuzluk termini değişti' : 'Sana bir uygunsuzluk atandı', body: `${n.title} · termin ${due.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}` });
  }
  return { changed: true };
}

async function assertEligible(tx: Tx, companyId: string, siteId: string, userId: string) {
  const ok = (await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND (site_id IS NULL OR site_id = $3)`,
    [userId, companyId, siteId])).rowCount;
  if (!ok) throw invalid('Bu kişi bu şubede iş alamaz (etkin üye değil ya da başka şubede).');
}

/** First response (containment) and the effectiveness check of the current round. */
export async function recordStep(tx: Tx, p: Principal, companyId: string, id: string, step: 'containment' | 'effectiveness_check', notes: string) {
  const n = await load(tx, p, companyId, id, 'ncr.act', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı uygunsuzlukta adım eklenemez.');
  if (notes.trim().length < 5) throw invalid('Ne yapıldığını yaz.');
  if (step === 'containment') {
    if ((await tx.query(`SELECT 1 FROM ncr_steps WHERE ncr_id = $1 AND step = 'containment'`, [id])).rowCount) throw conflict('STEP_ALREADY_DONE', 'İlk müdahale zaten kaydedilmiş.');
    await tx.query(`INSERT INTO ncr_steps (company_id, ncr_id, step, notes, done_by, iteration) VALUES ($1,$2,'containment',$3,$4,$5)`, [companyId, id, notes.trim(), p.userId, n.iteration]);
  } else {
    if (n.status === 'awaiting_verification') throw conflict('ALREADY_REQUESTED', 'Etkinlik kontrolü kaydedildi; yetkili doğrulaması bekleniyor.');
    const d = await flowData(tx, n);
    const f = flow(d.input);
    if (!f.readyForEffectiveness) throw new AppError(422, 'FLOW_INCOMPLETE', `Önce: ${f.blockers.join(' ')}`);
    await tx.query(`INSERT INTO ncr_steps (company_id, ncr_id, step, notes, done_by, iteration) VALUES ($1,$2,'effectiveness_check',$3,$4,$5)`, [companyId, id, notes.trim(), p.userId, n.iteration]);
    await tx.query(`UPDATE nonconformities SET status = 'awaiting_verification' WHERE id = $1`, [id]);
    const managers = await siteManagers(tx, companyId, n.site_id);
    await notify(tx, { companyId, siteId: n.site_id, userIds: managers, except: p.userId, kind: 'ncr_verification_requested', entityType: 'nonconformity', entityId: id,
      dedupeKey: `ncr_verification_requested:${id}:${n.iteration}`, title: 'Doğrulama isteği', body: `${n.title} · etkinlik kontrolü kaydedildi, doğrulaman bekleniyor` });
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.step_done', entityType: 'nonconformity', entityId: id, payload: { step, notes: notes.trim(), iteration: n.iteration } });
}

/**
 * Cause assessment. "initial" is a first view anyone working on it may record; it is not a
 * conclusion. "verified" is the root cause a manager confirms with what supports it.
 */
export async function assessCause(tx: Tx, p: Principal, companyId: string, id: string, b: { stage: 'initial' | 'verified'; categories: CauseCategory[]; notes: string }) {
  const n = await load(tx, p, companyId, id, b.stage === 'verified' ? 'ncr.manage' : 'ncr.act', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta değerlendirme eklenemez.');
  const cats = [...new Set(b.categories)];
  if (!cats.length || cats.some(c => !CAUSE_CATEGORIES.includes(c))) throw invalid('En az bir neden türü seç.');
  if (b.notes.trim().length < (b.stage === 'verified' ? 10 : 5)) throw invalid(b.stage === 'verified' ? 'Doğrulanmış kök neden için neye dayandığını yaz.' : 'Kısa bir açıklama yaz.');
  if (b.stage === 'verified' && !(await tx.query(`SELECT 1 FROM ncr_cause_assessments WHERE ncr_id = $1 AND stage = 'initial'`, [id])).rowCount && n.flow_version > 1) {
    throw invalid('Önce ilk değerlendirme yapılmalı.');
  }
  await tx.query(`INSERT INTO ncr_cause_assessments (company_id, ncr_id, iteration, stage, categories, notes, done_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [companyId, id, n.iteration, b.stage, cats, b.notes.trim(), p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.cause_assessed', entityType: 'nonconformity', entityId: id,
    payload: { stage: b.stage, categories: cats, notes: b.notes.trim(), iteration: n.iteration } });
}

export type ActionInput = { kind: 'correction' | 'corrective_action' | 'follow_up'; description: string; ownerId: string | null; dueAt: string | null; supportRef: Record<string, unknown> | null };

export async function addAction(tx: Tx, p: Principal, companyId: string, id: string, b: ActionInput) {
  const n = await load(tx, p, companyId, id, 'ncr.act', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta aksiyon eklenemez; önce yeniden aç.');
  if (n.status === 'awaiting_verification') throw conflict('AWAITING_VERIFICATION', 'Doğrulama beklenirken aksiyon eklenemez.');
  if (b.kind === 'corrective_action' && n.depth !== 'capa') throw invalid('Bu kayıt düzeltme akışında; düzeltici faaliyet yerine düzeltme ya da takip aksiyonu ekle.');
  if (b.description.trim().length < 5) throw invalid('Aksiyonu tarif et.');
  const manager = can(p, 'ncr.manage', { companyId, siteId: n.site_id }).ok;
  if (b.ownerId && b.ownerId !== p.userId && !manager) throw forbidden('Başkasına aksiyon atamak için yönetici olmalısın.');
  const owner = b.ownerId ?? p.userId;
  await assertEligible(tx, companyId, n.site_id, owner);
  const a = (await tx.query<{ id: string }>(
    `INSERT INTO ncr_actions (company_id, ncr_id, iteration, kind, description, owner_id, due_at, support_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [companyId, id, n.iteration, b.kind, b.description.trim(), owner, b.dueAt, b.supportRef ? JSON.stringify(b.supportRef) : null, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.action_added', entityType: 'nonconformity', entityId: id,
    payload: { actionId: a.id, kind: b.kind, description: b.description.trim(), ownerId: owner, dueAt: b.dueAt, iteration: n.iteration, supportRef: b.supportRef } });
  await notify(tx, { companyId, siteId: n.site_id, userIds: [owner], except: p.userId, kind: 'action_assigned', entityType: 'nonconformity', entityId: id,
    dedupeKey: `action_assigned:${a.id}:${owner}`, title: 'Sana bir aksiyon atandı', body: `${b.description.trim()} · ${n.title}` });
  return { id: a.id };
}

/** Complete, cancel or reassign an action. Completing needs what was done; the owner or a manager may complete. */
export async function updateAction(tx: Tx, p: Principal, companyId: string, id: string, actionId: string,
  b: { op: 'done' | 'cancel' | 'reassign'; notes?: string; ownerId?: string; dueAt?: string | null }) {
  const n = await load(tx, p, companyId, id, 'ncr.act', true);
  const a = (await tx.query(`SELECT * FROM ncr_actions WHERE id = $1 AND ncr_id = $2 FOR UPDATE`, [actionId, id])).rows[0];
  if (!a) throw notFound('Aksiyon');
  if (n.status !== 'open') throw conflict('NCR_NOT_OPEN', n.status === 'closed' ? 'Kapalı kayıtta aksiyon değişmez.' : 'Doğrulama beklenirken aksiyon değişmez.');
  if (a.status !== 'open') throw conflict('ACTION_NOT_OPEN', 'Bu aksiyon zaten kapanmış.');
  const manager = can(p, 'ncr.manage', { companyId, siteId: n.site_id }).ok;
  const notes = (b.notes ?? '').trim();
  if (b.op === 'done') {
    if (a.owner_id !== p.userId && !manager) throw forbidden('Aksiyonu sorumlusu ya da bir yönetici tamamlar.');
    if (notes.length < 5) throw invalid('Ne yapıldığını yaz.');
    await tx.query(`UPDATE ncr_actions SET status = 'done', result_notes = $2, done_by = $3, done_at = clock_timestamp() WHERE id = $1`, [actionId, notes, p.userId]);
  } else if (b.op === 'cancel') {
    if (!manager && a.created_by !== p.userId) throw forbidden('Aksiyonu açan kişi ya da bir yönetici iptal eder.');
    if (notes.length < 5) throw invalid('İptal gerekçesi yaz.');
    await tx.query(`UPDATE ncr_actions SET status = 'cancelled', result_notes = $2 WHERE id = $1`, [actionId, notes]);
  } else {
    if (!manager) throw forbidden('Aksiyonu yönetici yeniden atar.');
    if (!b.ownerId) throw invalid('Yeni sorumluyu seç.');
    await assertEligible(tx, companyId, n.site_id, b.ownerId);
    await tx.query(`UPDATE ncr_actions SET owner_id = $2, due_at = COALESCE($3, due_at) WHERE id = $1`, [actionId, b.ownerId, b.dueAt ?? null]);
    await notify(tx, { companyId, siteId: n.site_id, userIds: [b.ownerId], except: p.userId, kind: 'action_assigned', entityType: 'nonconformity', entityId: id,
      dedupeKey: `action_assigned:${actionId}:${b.ownerId}`, title: 'Sana bir aksiyon atandı', body: `${a.description} · ${n.title}` });
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: `nonconformity.action_${b.op}`, entityType: 'nonconformity', entityId: id,
    payload: { actionId, notes: notes || null, owner: b.op === 'reassign' ? { from: a.owner_id, to: b.ownerId } : undefined } });
}

/**
 * Verification of the effectiveness check. "effective" closes the case. "not effective"
 * keeps it open and starts a new round (new action, new check, new verification).
 * Accepting a service delivery never does this; only this call closes a case.
 */
export async function verify(tx: Tx, p: Principal, companyId: string, id: string, b: { result: 'effective' | 'not_effective'; notes: string }) {
  const n = await load(tx, p, companyId, id, 'ncr.verify_close', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Bu uygunsuzluk zaten kapalı.');
  if (n.status !== 'awaiting_verification') throw new AppError(422, 'FLOW_INCOMPLETE', 'Önce etkinlik kontrolü kaydedilmeli.');
  if (b.notes.trim().length < (b.result === 'effective' ? 5 : 10)) throw invalid(b.result === 'effective' ? 'Neyi kontrol ettiğini yaz.' : 'Neden etkili bulmadığını yaz.');
  const d = await flowData(tx, n);
  if (verifierConflict(d.input, p.userId)) throw new AppError(422, 'VERIFIER_NOT_INDEPENDENT', 'Yüksek riskli kayıtta kapanışı, bu turun düzeltmesini yapan kişiden farklı bir yetkili doğrulamalı.');
  await tx.query(`INSERT INTO ncr_verifications (company_id, ncr_id, iteration, result, notes, verified_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [companyId, id, n.iteration, b.result, b.notes.trim(), p.userId]);
  if (b.result === 'effective') {
    await tx.query(`UPDATE nonconformities SET status = 'closed', closed_by = $2, closed_at = clock_timestamp() WHERE id = $1`, [id, p.userId]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.closed', entityType: 'nonconformity', entityId: id, payload: { notes: b.notes.trim(), iteration: n.iteration } });
  } else {
    await tx.query(`UPDATE nonconformities SET status = 'open', iteration = iteration + 1 WHERE id = $1`, [id]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.verification_failed', entityType: 'nonconformity', entityId: id, payload: { notes: b.notes.trim(), iteration: n.iteration } });
    await notify(tx, { companyId, siteId: n.site_id, userIds: [n.owner_id], except: p.userId, kind: 'ncr_verification_failed', entityType: 'nonconformity', entityId: id,
      dedupeKey: `ncr_verification_failed:${id}:${n.iteration}`, title: 'Doğrulama başarısız: kayıt açık kaldı', body: `${n.title} · yeni aksiyon ve yeni etkinlik kontrolü gerekiyor` });
  }
  return { status: b.result === 'effective' ? 'closed' : 'open', iteration: b.result === 'effective' ? n.iteration : n.iteration + 1 };
}

/** Reopening a closed case needs a reason; the earlier closure stays in the history. */
export async function reopen(tx: Tx, p: Principal, companyId: string, id: string, reason: string) {
  const n = await load(tx, p, companyId, id, 'ncr.verify_close', true);
  if (n.status !== 'closed') throw conflict('NCR_NOT_CLOSED', 'Yalnızca kapalı kayıt yeniden açılır.');
  if (reason.trim().length < 10) throw invalid('Yeniden açma gerekçesini yaz (en az bir cümle).');
  await tx.query(`INSERT INTO ncr_verifications (company_id, ncr_id, iteration, result, notes, verified_by) VALUES ($1,$2,$3,'reopened',$4,$5)`,
    [companyId, id, n.iteration, reason.trim(), p.userId]);
  await tx.query(`UPDATE nonconformities SET status = 'open', iteration = iteration + 1, reopened_count = reopened_count + 1, closed_by = NULL, closed_at = NULL WHERE id = $1`, [id]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.reopened', entityType: 'nonconformity', entityId: id,
    payload: { reason: reason.trim(), previousClosedBy: n.closed_by, previousClosedAt: iso(n.closed_at), iteration: n.iteration + 1 } });
  await notify(tx, { companyId, siteId: n.site_id, userIds: [n.owner_id], except: p.userId, kind: 'ncr_reopened', entityType: 'nonconformity', entityId: id,
    dedupeKey: `ncr_reopened:${id}:${n.iteration + 1}`, title: 'Uygunsuzluk yeniden açıldı', body: `${n.title} · ${reason.trim()}` });
}

/** List with owner, overdue and round. Staff see cases they own or hold an action in. */
export async function listNonconformities(tx: Tx, p: Principal, companyId: string, status: 'open' | 'closed' | null) {
  const rows = (await tx.query(
    `SELECT n.id, n.site_id, n.title, n.risk_level, n.depth, n.status, n.detected_at, n.due_at, n.owner_id, n.task_id, n.source, n.iteration, n.reopened_count,
            u.display_name AS owner_name, (n.status <> 'closed' AND n.due_at < now()) AS overdue,
            EXISTS (SELECT 1 FROM ncr_actions a WHERE a.ncr_id = n.id AND a.owner_id = $3) AS my_action
       FROM nonconformities n LEFT JOIN users u ON u.id = n.owner_id
      WHERE n.company_id = $1 AND ($2::text IS NULL OR ($2 = 'closed') = (n.status = 'closed')) ORDER BY n.detected_at DESC`,
    [companyId, status, p.userId])).rows;
  return rows.filter(n => can(p, 'ncr.read', { companyId, siteId: n.site_id, assigneeId: n.owner_id === p.userId || n.my_action ? p.userId : n.owner_id }).ok)
    .map(({ my_action, ...n }) => n);
}

/**
 * Open work whose responsible person is no longer an active member of that site
 * (suspended, removed, moved): for managers to reassign.
 */
export async function reassignmentQueue(tx: Tx, p: Principal, companyId: string) {
  const inactive = (col: string, site: string) => `${col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = ${col}
      AND m.company_id = $1 AND m.status = 'active' AND (m.site_id IS NULL OR m.site_id = ${site}))`;
  const ncrs = (await tx.query(`SELECT n.id, n.site_id, n.title, n.due_at, u.display_name AS owner_name FROM nonconformities n JOIN users u ON u.id = n.owner_id
     WHERE n.company_id = $1 AND n.status <> 'closed' AND ${inactive('n.owner_id', 'n.site_id')}`, [companyId])).rows;
  const actions = (await tx.query(`SELECT a.id, a.ncr_id, n.site_id, a.description, a.due_at, n.title AS ncr_title, u.display_name AS owner_name
     FROM ncr_actions a JOIN nonconformities n ON n.id = a.ncr_id JOIN users u ON u.id = a.owner_id
     WHERE a.company_id = $1 AND a.status = 'open' AND n.status <> 'closed' AND ${inactive('a.owner_id', 'n.site_id')}`, [companyId])).rows;
  const tasks = (await tx.query(`SELECT t.id, t.site_id, tt.title, t.due_at, u.display_name AS owner_name FROM tasks t
     JOIN task_templates tt ON tt.id = t.template_id JOIN users u ON u.id = t.assignee_id
     WHERE t.company_id = $1 AND t.status = 'open' AND ${inactive('t.assignee_id', 't.site_id')} ORDER BY t.due_at LIMIT 200`, [companyId])).rows;
  const mine = <T extends { site_id: string }>(xs: T[]) => xs.filter(x => can(p, 'ncr.manage', { companyId, siteId: x.site_id }).ok);
  return { nonconformities: mine(ncrs), actions: mine(actions), tasks: mine(tasks) };
}
