import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { RECURRENCE_WINDOW_DAYS, assessRisk, type Severity } from '../domain/nonconformity';
import { CAUSE_CATEGORIES, SELF_VERIFY_MIN_REASON, actionContributors, flow, roundPerformers, selfVerifyAllowed, suggestions, type CauseCategory, type FlowInput, type RiskLevel } from '../domain/ncrflow';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify, siteManagers } from './notifications';
import { ALLOWED_MIME } from '../storage/local';

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
async function load(tx: Tx, p: Principal, companyId: string, id: string, action: 'ncr.read' | 'ncr.act' | 'ncr.verify_close' | 'ncr.manage' | 'ncr.verify', forUpdate = false) {
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
  const actions = (await tx.query(`SELECT a.*, ou.display_name AS owner_name, du.display_name AS done_by_name, vu.display_name AS verified_by_name,
       pu.display_name AS performed_by_name,
       COALESCE((SELECT json_agg(json_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'mime', e.mime, 'body', e.body,
          'created_by', e.created_by, 'created_at', e.created_at, 'rejection_reason', e.rejection_reason) ORDER BY e.created_at)
          FROM evidence e WHERE e.action_id = a.id), '[]'::json) AS evidence,
       (a.status = 'open' AND a.due_at IS NOT NULL AND a.due_at < now()) AS overdue,
       (a.owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = a.owner_id AND m.company_id = a.company_id
          AND m.status = 'active' AND (m.site_id IS NULL OR m.site_id = $2))) AS owner_inactive
     FROM ncr_actions a LEFT JOIN users ou ON ou.id = a.owner_id LEFT JOIN users du ON du.id = a.done_by LEFT JOIN users vu ON vu.id = a.verified_by
       LEFT JOIN users pu ON pu.id = a.performed_by
    WHERE a.ncr_id = $1 ORDER BY a.created_at`, [n.id, n.site_id])).rows;
  const verifications = (await tx.query(`SELECT v.iteration, v.result, v.notes, v.verified_by, v.verified_at, v.verification_mode, v.verified_via, u.display_name AS verified_by_name
     FROM ncr_verifications v JOIN users u ON u.id = v.verified_by WHERE v.ncr_id = $1 ORDER BY v.verified_at`, [n.id])).rows;
  // A provider who did a service job for this case took part in its fix.
  const providerUsers = (await tx.query<{ user_id: string }>(`SELECT DISTINCT pp.user_id FROM service_requests r JOIN service_jobs j ON j.request_id = r.id
     JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE r.ncr_id = $1 AND r.company_id = $2`, [n.id, n.company_id])).rows.map(r => r.user_id);
  const input: FlowInput = {
    providerUsers,
    flowVersion: n.flow_version, depth: n.depth, status: n.status, iteration: n.iteration, ownerId: n.owner_id, dueAt: n.due_at,
    independentVerification: !!n.risk_rationale.independentVerification,
    steps: steps.map(s => ({ step: s.step, iteration: s.iteration, doneBy: s.done_by })),
    causes: causes.map(c => ({ stage: c.stage, iteration: c.iteration, categories: c.categories, migrated: c.migrated })),
    actions: actions.map(a => ({ kind: a.kind, iteration: a.iteration, status: a.status, doneBy: a.done_by, ownerId: a.owner_id, performedBy: a.performed_by,
      verification: a.verification_status, evidenceBy: (a.evidence as { created_by: string }[]).map(e => e.created_by) })),
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
  const closure = closureOptions(n, d.input, p.userId, canVerify && n.status === 'awaiting_verification');
  return {
    ...n,
    // How verification works for this case (shown on screen).
    verificationPolicy: n.risk_rationale.independentVerification
      ? 'Yüksek risk: aksiyon sonuçlarını ve kapanışı, işte payı olmayan biri doğrular (işletmeden ya da davet edilen dış doğrulayıcı).'
      : n.risk_level === 'medium'
        ? 'Orta risk: düzeltme ve takip aksiyonlarında ve kapanışta gerekçeli öz doğrulama yapılabilir (etiketlenir); düzeltici faaliyet bağımsız doğrulanır.'
        : 'Düşük risk: payı olan kişi gerekçe yazarak öz doğrulama yapabilir; "öz doğrulama" olarak etiketlenir.',
    // Kept for older app versions.
    requiredSteps: n.risk_rationale.steps, closable: { ok: false },
    owner: n.owner_id ? { id: n.owner_id, name: owner?.display_name ?? null, active: !!owner?.active } : null,
    overdue: n.status !== 'closed' && !!n.due_at && new Date(n.due_at) < new Date(),
    equipment, task,
    flow: f,
    steps: d.steps, causes: d.causes, verifications: d.verifications, services, history,
    actions: d.actions.map((a, i) => {
      const inp = d.input.actions[i]!;
      const contributors = actionContributors(inp);
      const isProvider = d.input.providerUsers?.includes(p.userId) ?? false;
      // Something to verify: a fresh claim, or an older "completed" that an open case now needs verified.
      const pending = a.status === 'done' && (a.verification_status === 'declared' || (a.verification_status === 'legacy' && n.status !== 'closed'));
      const mayVerify = pending && n.status !== 'closed' && can(p, 'ncr.verify', { companyId, siteId: n.site_id }).ok;
      const mine = contributors.has(p.userId) || isProvider;
      const selfOk = mayVerify && contributors.has(p.userId) && !isProvider && selfVerifyAllowed(n.risk_level as RiskLevel, a.kind);
      const manage = can(p, 'ncr.manage', { companyId, siteId: n.site_id }).ok;
      return { ...a,
        legacy_unverified: a.verification_status === 'legacy' && n.status !== 'closed',
        can_verify: mayVerify && !mine,
        can_self_verify: selfOk,
        verify_blocked_reason: mayVerify && mine
          ? isProvider ? 'Bu kayıt için hizmeti sen verdin; sonucunu doğrulayamazsın.'
          : selfOk ? `Bu aksiyonda payın var. Risk ${RISK_TR[n.risk_level]} olduğu için gerekçeli öz doğrulama yapabilirsin; "öz doğrulama" olarak etiketlenir.`
          : `Bu aksiyonda payın var ve risk ${RISK_TR[n.risk_level]}: bağımsız bir yetkili ya da davet ettiğiniz dış doğrulayıcı doğrulamalı.` : null,
        can_add_evidence: a.status === 'open' && n.status !== 'closed' && (a.owner_id === p.userId || manage) };
    }),
    cause: { initial: latestInitial ?? null, verified: latestVerified ?? null },
    suggestions: latestInitial ? suggestions(latestInitial.categories as CauseCategory[], {
      hasEquipment: !!equipment, hasObligation: !!task?.obligation_id, serviceCategory: equipment ? SERVICE_FOR_EQUIPMENT[equipment.type] ?? null : null,
    }).map(s => ({ ...s, serviceCategory: s.kind === 'service_request' && equipment ? SERVICE_FOR_EQUIPMENT[equipment.type] ?? null : null })) : [],
    permissions: {
      act: can(p, 'ncr.act', target).ok,
      manage: can(p, 'ncr.manage', target).ok,
      verify: closure.verify,
      selfVerify: closure.selfVerify,
      verifyBlockedReason: closure.reason,
      inviteVerifier: can(p, 'members.manage', { companyId }).ok,
      reopen: canVerify && n.status === 'closed',
      serviceRequest: can(p, 'service.request', target).ok,
    },
  };
}

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

/** Closure: independent, labelled self-verification (low/medium risk), or refused. */
function closureOptions(n: any, input: FlowInput, userId: string, able: boolean) {
  const performers = roundPerformers(input);
  const isProvider = input.providerUsers?.includes(userId) ?? false;
  if (!able) return { verify: false, selfVerify: false, reason: null as string | null };
  if (!performers.has(userId)) return { verify: true, selfVerify: false, reason: null };
  if (isProvider) return { verify: false, selfVerify: false, reason: 'Bu kayıt için hizmeti sen verdin; kapanışı doğrulayamazsın.' };
  if (!input.independentVerification && selfVerifyAllowed(n.risk_level as RiskLevel, 'closure')) {
    return { verify: false, selfVerify: true, reason: 'Bu turun düzeltmesinde payın var. Risk yüksek olmadığı için gerekçeli öz doğrulama yapabilirsin; kapanış "öz doğrulama" olarak etiketlenir.' };
  }
  return { verify: false, selfVerify: false, reason: 'Bu turdaki düzeltme ya da düzeltici faaliyette payın var (sorumlu, yapan, beyan eden veya kanıt veren); yüksek riskli kaydı payı olmayan bir yetkili ya da davet edilen dış doğrulayıcı doğrulamalı.' };
}

/**
 * Who should hear about something to verify: managers of the site and outside verifiers with a
 * live grant there, minus the people who took part. For high risk everyone eligible is told;
 * otherwise outside verifiers only when nobody inside the business is eligible.
 */
async function verifierRecipients(tx: Tx, companyId: string, siteId: string, exclude: Set<string>, highRisk: boolean) {
  const internal = (await siteManagers(tx, companyId, siteId)).filter(u => !exclude.has(u));
  const external = (await tx.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM access_grants WHERE company_id = $1 AND revoked_at IS NULL
     AND expires_at > now() AND 'ncr_verify' = ANY(scopes) AND (site_id IS NULL OR site_id = $2)`, [companyId, siteId])).rows.map(r => r.user_id).filter(u => !exclude.has(u));
  return highRisk || !internal.length ? [...internal, ...external] : internal;
}

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
    const managers = await verifierRecipients(tx, companyId, n.site_id, roundPerformers(d.input), !!n.risk_rationale.independentVerification);
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

export type ActionInput = { kind: 'correction' | 'corrective_action' | 'follow_up'; description: string; ownerId: string | null; dueAt: string | null;
  supportRef: Record<string, unknown> | null; evidenceRequired?: 'none' | 'photo' | 'document' };

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
    `INSERT INTO ncr_actions (company_id, ncr_id, iteration, kind, description, owner_id, due_at, support_ref, created_by, evidence_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, id, n.iteration, b.kind, b.description.trim(), owner, b.dueAt, b.supportRef ? JSON.stringify(b.supportRef) : null, p.userId, b.evidenceRequired ?? 'none'])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.action_added', entityType: 'nonconformity', entityId: id,
    payload: { actionId: a.id, kind: b.kind, description: b.description.trim(), ownerId: owner, dueAt: b.dueAt, iteration: n.iteration, supportRef: b.supportRef,
      evidenceRequired: b.evidenceRequired ?? 'none' } });
  await notify(tx, { companyId, siteId: n.site_id, userIds: [owner], except: p.userId, kind: 'action_assigned', entityType: 'nonconformity', entityId: id,
    dedupeKey: `action_assigned:${a.id}:${owner}`, title: 'Sana bir aksiyon atandı', body: `${b.description.trim()} · ${n.title}` });
  return { id: a.id };
}

const EVIDENCE_TR: Record<string, string> = { photo: 'fotoğraf', document: 'belge' };

/**
 * People with a part in this action: its responsible person (aksiyon sorumlusu), whoever did the
 * work, whoever declared it done and whoever gave its evidence. The business-owner ROLE is not a part.
 */
async function actionPerformers(tx: Tx, a: any): Promise<Set<string>> {
  const ev = (await tx.query<{ created_by: string }>(`SELECT DISTINCT created_by FROM evidence WHERE action_id = $1`, [a.id])).rows;
  return actionContributors({ kind: a.kind, iteration: a.iteration, status: a.status, ownerId: a.owner_id, performedBy: a.performed_by, doneBy: a.done_by,
    evidenceBy: ev.map(e => e.created_by) });
}

/** Users behind provider profiles that did a service job for this case. */
async function caseProviders(tx: Tx, n: any): Promise<string[]> {
  return (await tx.query<{ user_id: string }>(`SELECT DISTINCT pp.user_id FROM service_requests r JOIN service_jobs j ON j.request_id = r.id
     JOIN professional_profiles pp ON pp.id = j.provider_profile_id WHERE r.ncr_id = $1 AND r.company_id = $2`, [n.id, n.company_id])).rows.map(r => r.user_id);
}

/**
 * Declare done ("yapıldı"), verify that declaration, cancel or reassign an action.
 * Declaring needs what was done and, when the action asks for it, stored evidence; it stays a
 * claim ("declared") until someone else with manager rights checks it. Only a verified
 * result counts toward the effectiveness check. A rejected claim reopens the action.
 */
export async function updateAction(tx: Tx, p: Principal, companyId: string, id: string, actionId: string,
  b: { op: 'done' | 'cancel' | 'reassign' | 'verify'; notes?: string; ownerId?: string; dueAt?: string | null; result?: 'accepted' | 'rejected';
    performedBy?: string | null; selfVerify?: boolean }) {
  const n = await load(tx, p, companyId, id, b.op === 'verify' ? 'ncr.verify' : 'ncr.act', true);
  const a = (await tx.query(`SELECT * FROM ncr_actions WHERE id = $1 AND ncr_id = $2 FOR UPDATE`, [actionId, id])).rows[0];
  if (!a) throw notFound('Aksiyon');
  const manager = can(p, 'ncr.manage', { companyId, siteId: n.site_id }).ok;
  const notes = (b.notes ?? '').trim();
  if (b.op === 'verify') {
    if (n.status === 'closed') throw conflict('NCR_NOT_OPEN', 'Kapalı kayıtta aksiyon değişmez.');
    const pending = a.status === 'done' && (a.verification_status === 'declared' || a.verification_status === 'legacy');
    if (!pending) throw conflict('ACTION_NOT_DECLARED', 'Bu aksiyon için doğrulama bekleyen bir "yapıldı" beyanı yok.');
    // Separate roles: responsible, doer, declarer, evidence giver — and a provider who served this case.
    const contributors = await actionPerformers(tx, a);
    const providers = await caseProviders(tx, n);
    if (providers.includes(p.userId)) throw new AppError(422, 'VERIFIER_IS_PROVIDER', 'Bu kayıt için hizmeti sen verdin; aksiyon sonucunu doğrulayamazsın.');
    let mode: 'independent' | 'self' = 'independent';
    if (contributors.has(p.userId)) {
      if (!selfVerifyAllowed(n.risk_level as RiskLevel, a.kind)) {
        throw new AppError(422, 'VERIFIER_NOT_INDEPENDENT', `Bu aksiyonda payın var (sorumlu, yapan, beyan eden ya da kanıt veren) ve risk ${RISK_TR[n.risk_level]}: payı olmayan bir yetkili ya da davet edilen dış doğrulayıcı doğrulamalı.`);
      }
      if (!b.selfVerify) throw new AppError(422, 'SELF_VERIFICATION_CONFIRM', 'Bu aksiyonda payın var. Öz doğrulama yapacaksan bunu açıkça işaretle ve gerekçe yaz.');
      if (b.result === 'accepted' && notes.length < SELF_VERIFY_MIN_REASON) throw invalid(`Öz doğrulama için gerekçe en az ${SELF_VERIFY_MIN_REASON} karakter olmalı (neye bakarak doğruladın, neden başkası doğrulamıyor).`);
      mode = 'self';
    }
    const permit = can(p, 'ncr.verify', { companyId, siteId: n.site_id }); const via = permit.ok ? permit.via : null;
    if (!b.result) throw invalid('Sonucu seç: doğrulandı ya da reddedildi.');
    if (notes.length < (b.result === 'accepted' ? 5 : 10)) throw invalid(b.result === 'accepted' ? 'Neyi kontrol ettiğini yaz.' : 'Neden reddettiğini yaz.');
    if (a.evidence_required !== 'none' && b.result === 'accepted') {
      const ok = (await tx.query(`SELECT 1 FROM evidence WHERE action_id = $1 AND status = 'stored' AND kind = $2`, [actionId, a.evidence_required])).rowCount;
      if (!ok) throw new AppError(422, 'EVIDENCE_INCOMPLETE', `Gerekli ${EVIDENCE_TR[a.evidence_required]} kanıtı yok; doğrulanamaz.`);
    }
    if (b.result === 'accepted') {
      await tx.query(`UPDATE ncr_actions SET verification_status = 'verified', verified_by = $2, verified_at = clock_timestamp(), verification_notes = $3,
          verification_mode = $4, verified_via = $5 WHERE id = $1`, [actionId, p.userId, notes, mode, via]);
    } else {
      // The claim did not hold: the action is open again; the earlier claim stays in the history.
      await tx.query(`UPDATE ncr_actions SET status = 'open', verification_status = 'rejected', verified_by = $2, verified_at = clock_timestamp(), verification_notes = $3,
          verification_mode = $4, verified_via = $5, done_by = NULL, done_at = NULL, performed_by = NULL WHERE id = $1`, [actionId, p.userId, notes, mode, via]);
    }
    await notify(tx, { companyId, siteId: n.site_id, userIds: [a.owner_id, a.done_by].filter(Boolean), except: p.userId,
      kind: b.result === 'accepted' ? 'action_verified' : 'action_rejected', entityType: 'nonconformity', entityId: id,
      dedupeKey: `action_${b.result}:${actionId}:${a.done_at ? new Date(a.done_at).toISOString() : ''}`,
      title: b.result === 'accepted' ? 'Aksiyon sonucu doğrulandı' : 'Aksiyon sonucu kabul edilmedi: yeniden yapılmalı', body: `${a.description} · ${notes}` });
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.result === 'accepted' ? 'nonconformity.action_verified' : 'nonconformity.action_rejected',
      entityType: 'nonconformity', entityId: id, payload: { actionId, notes, declaredBy: a.done_by, performedBy: a.performed_by, responsible: a.owner_id,
        mode, via, legacy: a.verification_status === 'legacy' } });
    return;
  }
  if (n.status !== 'open') throw conflict('NCR_NOT_OPEN', n.status === 'closed' ? 'Kapalı kayıtta aksiyon değişmez.' : 'Doğrulama beklenirken aksiyon değişmez.');
  if (a.status !== 'open') throw conflict('ACTION_NOT_OPEN', 'Bu aksiyon zaten kapanmış.');
  if (b.op === 'done') {
    if (a.owner_id !== p.userId && !manager) throw forbidden('Aksiyonu sorumlusu ya da bir yönetici tamamlar.');
    if (notes.length < 5) throw invalid('Ne yapıldığını yaz.');
    const ev = (await tx.query<{ kind: string; status: string }>(`SELECT kind, status FROM evidence WHERE action_id = $1`, [actionId])).rows;
    if (ev.some(e => e.status === 'pending_upload')) throw new AppError(422, 'EVIDENCE_PENDING', 'Yüklenmesi süren kanıt var; yükleme bitince tekrar dene.');
    if (a.evidence_required !== 'none' && !ev.some(e => e.status === 'stored' && e.kind === a.evidence_required)) {
      throw new AppError(422, 'EVIDENCE_INCOMPLETE', `Bu aksiyon için ${EVIDENCE_TR[a.evidence_required]} kanıtı gerekli; önce kanıtı ekle.`);
    }
    // Who did the work may differ from who reports it (e.g. a manager records a staff member's work).
    const performedBy = b.performedBy ?? p.userId;
    if (performedBy !== p.userId) await assertEligible(tx, companyId, n.site_id, performedBy);
    await tx.query(`UPDATE ncr_actions SET status = 'done', result_notes = $2, done_by = $3, done_at = clock_timestamp(), verification_status = 'declared',
        verified_by = NULL, verified_at = NULL, verification_mode = NULL, verified_via = NULL, performed_by = $4 WHERE id = $1`, [actionId, notes, p.userId, performedBy]);
    if (a.kind !== 'follow_up') {
      const performers = await actionPerformers(tx, { ...a, done_by: p.userId, performed_by: performedBy });
      const managers = await verifierRecipients(tx, companyId, n.site_id, performers, !!n.risk_rationale.independentVerification);
      await notify(tx, { companyId, siteId: n.site_id, userIds: managers, except: p.userId, kind: 'action_declared', entityType: 'nonconformity', entityId: id,
        dedupeKey: `action_declared:${actionId}:${new Date((await tx.query(`SELECT done_at FROM ncr_actions WHERE id = $1`, [actionId])).rows[0].done_at).toISOString()}`,
        title: 'Aksiyon "yapıldı" olarak bildirildi: doğrulaman bekleniyor', body: `${a.description} · ${notes}` });
    }
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
    payload: { actionId, notes: notes || null, owner: b.op === 'reassign' ? { from: a.owner_id, to: b.ownerId } : undefined,
      verification: b.op === 'done' ? 'declared' : undefined, performedBy: b.op === 'done' ? (b.performedBy ?? p.userId) : undefined } });
}

/**
 * Evidence for an action (photo or document). Registered as pending with the device's hash; it
 * counts only after the bytes arrive and match. The action's owner or a manager adds it while
 * the action is open.
 */
export async function addActionEvidence(tx: Tx, p: Principal, companyId: string, id: string, actionId: string,
  e: { kind: 'photo' | 'document'; mime: string; sha256: string; sizeBytes: number }) {
  const n = await load(tx, p, companyId, id, 'ncr.act', true);
  const a = (await tx.query(`SELECT * FROM ncr_actions WHERE id = $1 AND ncr_id = $2 FOR UPDATE`, [actionId, id])).rows[0];
  if (!a) throw notFound('Aksiyon');
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Kapalı kayıtta kanıt eklenemez.');
  if (a.status !== 'open') throw conflict('ACTION_NOT_OPEN', 'Kanıt, aksiyon "yapıldı" diye bildirilmeden önce eklenir.');
  if (a.owner_id !== p.userId && !can(p, 'ncr.manage', { companyId, siteId: n.site_id }).ok) throw forbidden('Kanıtı aksiyonun sorumlusu ya da bir yönetici ekler.');
  if (!ALLOWED_MIME.includes(e.mime)) throw invalid(`Dosya türü kabul edilmiyor: ${e.mime}`);
  if (e.kind === 'photo' && !e.mime.startsWith('image/')) throw invalid('Fotoğraf kanıtı JPEG ya da PNG olmalı.');
  if (!/^[0-9a-f]{64}$/.test(e.sha256)) throw invalid('sha256 64 karakterlik onaltılık özet olmalı.');
  const row = (await tx.query<{ id: string; status: string }>(
    `INSERT INTO evidence (company_id, ncr_id, action_id, kind, status, mime, declared_sha256, size_bytes, created_by)
     VALUES ($1,$2,$3,$4,'pending_upload',$5,$6,$7,$8) RETURNING id, status`,
    [companyId, id, actionId, e.kind, e.mime, e.sha256, e.sizeBytes, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'evidence.added', entityType: 'evidence', entityId: row.id,
    payload: { ncrId: id, actionId, kind: e.kind, sha256: e.sha256 } });
  return row;
}

/**
 * Verification of the effectiveness check. "effective" closes the case. "not effective"
 * keeps it open and starts a new round (new action, new check, new verification).
 * Accepting a service delivery never does this; only this call closes a case.
 */
export async function verify(tx: Tx, p: Principal, companyId: string, id: string, b: { result: 'effective' | 'not_effective'; notes: string; selfVerify?: boolean }) {
  const n = await load(tx, p, companyId, id, 'ncr.verify_close', true);
  if (n.status === 'closed') throw conflict('NCR_CLOSED', 'Bu uygunsuzluk zaten kapalı.');
  if (n.status !== 'awaiting_verification') throw new AppError(422, 'FLOW_INCOMPLETE', 'Önce etkinlik kontrolü kaydedilmeli.');
  if (b.notes.trim().length < (b.result === 'effective' ? 5 : 10)) throw invalid(b.result === 'effective' ? 'Neyi kontrol ettiğini yaz.' : 'Neden etkili bulmadığını yaz.');
  const d = await flowData(tx, n);
  // Saying "not effective" only keeps the case open, so anyone allowed to verify may say it.
  let mode: 'independent' | 'self' = 'independent';
  if (b.result === 'effective' && roundPerformers(d.input).has(p.userId)) {
    if (d.input.providerUsers?.includes(p.userId)) throw new AppError(422, 'VERIFIER_IS_PROVIDER', 'Bu kayıt için hizmeti sen verdin; kapanışı doğrulayamazsın.');
    if (d.input.independentVerification || !selfVerifyAllowed(n.risk_level as RiskLevel, 'closure')) {
      throw new AppError(422, 'VERIFIER_NOT_INDEPENDENT', 'Yüksek riskli kayıtta kapanışı, bu turda düzeltme ya da düzeltici faaliyetin sorumlusu, yapanı, beyan edeni veya kanıt vereni olmayan bir yetkili (ya da davet edilen dış doğrulayıcı) doğrulamalı.');
    }
    if (!b.selfVerify) throw new AppError(422, 'SELF_VERIFICATION_CONFIRM', 'Bu turun düzeltmesinde payın var. Öz doğrulama yapacaksan bunu açıkça işaretle ve gerekçe yaz.');
    if (b.notes.trim().length < SELF_VERIFY_MIN_REASON) throw invalid(`Öz doğrulama için gerekçe en az ${SELF_VERIFY_MIN_REASON} karakter olmalı.`);
    mode = 'self';
  }
  const permit = can(p, 'ncr.verify_close', { companyId, siteId: n.site_id }); const via = permit.ok ? permit.via : null;
  // A "done" that nobody has checked yet is not a result; the case cannot be closed on it.
  const f = flow(d.input);
  if (b.result === 'effective' && !f.readyForEffectiveness) throw new AppError(422, 'FLOW_INCOMPLETE', `Önce: ${f.blockers.join(' ')}`);
  await tx.query(`INSERT INTO ncr_verifications (company_id, ncr_id, iteration, result, notes, verified_by, verification_mode, verified_via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [companyId, id, n.iteration, b.result, b.notes.trim(), p.userId, mode, via]);
  if (b.result === 'effective') {
    await tx.query(`UPDATE nonconformities SET status = 'closed', closed_by = $2, closed_at = clock_timestamp() WHERE id = $1`, [id, p.userId]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.closed', entityType: 'nonconformity', entityId: id,
      payload: { notes: b.notes.trim(), iteration: n.iteration, mode, via } });
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
