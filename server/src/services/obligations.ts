import type { Tx } from '../db/pool';
import { decide } from '../domain/applicability';
import type { Facts } from '../domain/conditions';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { canonical } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify } from './notifications';
import { currentFacts } from './profile';

const today = (now = new Date()) => now.toISOString().slice(0, 10);

function snapshot(facts: Facts, keys: string[]) {
  return Object.fromEntries(keys.map(k => {
    const f = facts[k as keyof Facts];
    return [k, f ? { id: f.id, value: f.value, source: f.source, verification: f.verification, recordedAt: f.recordedAt } : null];
  }));
}

/** Current decision per rule for a site: the latest row wins, older rows are history. */
export async function currentObligations(tx: Tx, companyId: string, siteId?: string) {
  const r = await tx.query(
    `SELECT DISTINCT ON (o.site_id, o.rule_id) o.*, rv.version AS rule_version, rv.kind, rv.is_example, rv.obligation_title, rv.status AS rule_status, r.code AS rule_code
       FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id JOIN rules r ON r.id = o.rule_id
      WHERE o.company_id = $1 AND ($2::uuid IS NULL OR o.site_id = $2)
      ORDER BY o.site_id, o.rule_id, o.decided_at DESC`, [companyId, siteId ?? null]);
  return r.rows;
}

export type RecomputeResult = { changed: { ruleCode: string; from: string | null; to: string }[]; cancelledTasks: number };

/**
 * Re-evaluates every published rule for one site. Unchanged decisions add
 * nothing (safe to run repeatedly); changed decisions append a new row and
 * leave the old one, and the tasks done under it, untouched.
 */
export async function recomputeSite(tx: Tx, companyId: string, siteId: string, actorId: string | null, now = new Date(), forceRuleId: string | null = null): Promise<RecomputeResult> {
  const onDate = today(now);
  const facts = await currentFacts(tx, companyId, siteId);
  const rules = await tx.query(
    `SELECT rv.*, r.code FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.status = 'published'`);
  const current = new Map((await currentObligations(tx, companyId, siteId)).map(o => [o.rule_id, o]));
  const result: RecomputeResult = { changed: [], cancelledTasks: 0 };

  for (const rv of rules.rows) {
    const prev = current.get(rv.rule_id);
    // A manual decision stands until the rule itself changes; it is never silently overwritten.
    // (forceRuleId: an authorised person withdrew their manual decision, so the engine decides again.)
    const forced = forceRuleId === rv.rule_id;
    if (!forced && prev && prev.decided_by !== 'engine' && prev.rule_version_id === rv.id) continue;
    const d = decide({ ruleVersionId: rv.id, condition: rv.condition, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to, ambiguityNote: rv.ambiguity_note }, facts, onDate);
    if (!d) continue;
    const factsSnap = snapshot(facts, rv.required_facts);
    if (!forced && prev && prev.rule_version_id === rv.id && prev.decision === d.decision
        // jsonb reorders object keys, so compare canonical forms.
        && canonical(prev.missing_facts) === canonical(d.missingFacts)
        && canonical(prev.facts_snapshot) === canonical(factsSnap)) continue;

    const ins = await tx.query<{ id: string }>(
      `INSERT INTO obligations (company_id, site_id, rule_id, rule_version_id, decision, decided_by, reason, trace, facts_snapshot, missing_facts)
       VALUES ($1,$2,$3,$4,$5,'engine',$6,$7,$8,$9) RETURNING id`,
      [companyId, siteId, rv.rule_id, rv.id, d.decision, d.reason, JSON.stringify(d.trace), JSON.stringify(factsSnap), d.missingFacts]);
    await appendAudit(tx, {
      companyId, actorId, eventType: 'obligation.decided', entityType: 'obligation', entityId: ins.rows[0]!.id,
      payload: { ruleCode: rv.code, ruleVersion: rv.version, decision: d.decision, previous: prev?.decision ?? null, missingFacts: d.missingFacts },
    });
    result.changed.push({ ruleCode: rv.code, from: prev?.decision ?? null, to: d.decision });

    if (prev && d.decision !== 'applies') {
      result.cancelledTasks += (await cancelOpenTasks(tx, companyId, prev.id, `Yükümlülük kararı değişti: ${d.decision}`)).cancelledTasks;
    } else if (prev && prev.rule_version_id !== rv.id) {
      // New rule version, still applies: open tasks stay valid but are flagged so a person checks them.
      await tx.query(`UPDATE tasks SET review_flag = 'RULE_VERSION_CHANGED' WHERE obligation_id = $1 AND status = 'open'`, [prev.id]);
    }
  }
  return result;
}

/**
 * Open work under a decision that no longer applies. Checks whose time has already passed
 * become "missed" (the delay stays visible in reports); checks still ahead are cancelled.
 */
async function cancelOpenTasks(tx: Tx, companyId: string, obligationId: string, reason: string, code: 'obligation_changed' | 'override' = 'obligation_changed') {
  const missed = await tx.query(`UPDATE tasks SET status = 'missed', status_reason = $3 WHERE company_id = $1 AND obligation_id = $2 AND status = 'open' AND due_at < now()`,
    [companyId, obligationId, `Süresi geçmişti; ardından: ${reason}`]);
  const r = await tx.query(`UPDATE tasks SET status = 'cancelled', status_reason = $3, cancel_code = $4 WHERE company_id = $1 AND obligation_id = $2 AND status = 'open'`,
    [companyId, obligationId, reason, code]);
  return { cancelledTasks: r.rowCount ?? 0, missedTasks: missed.rowCount ?? 0 };
}

export async function recomputeCompany(tx: Tx, companyId: string, actorId: string | null) {
  const sites = await tx.query<{ id: string }>(`SELECT id FROM sites WHERE company_id = $1`, [companyId]);
  for (const s of sites.rows) await recomputeSite(tx, companyId, s.id, actorId);
}

/** Everything needed to answer "why does this apply to me?" for one obligation. */
export async function explain(tx: Tx, p: Principal, companyId: string, obligationId: string) {
  const o = (await tx.query(`SELECT * FROM obligations WHERE id = $1 AND company_id = $2`, [obligationId, companyId])).rows[0];
  if (!o || !can(p, 'obligation.read', { companyId, siteId: o.site_id }).ok) throw notFound('Yükümlülük');
  const rv = (await tx.query(`SELECT rv.*, r.code FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1`, [o.rule_version_id])).rows[0];
  const provisions = (await tx.query(
    `SELECT p.ref, p.excerpt, sv.version_label, sv.effective_from, ls.title AS source_title, ls.issuer, ls.url, ls.is_example
       FROM provisions p JOIN source_versions sv ON sv.id = p.source_version_id JOIN legal_sources ls ON ls.id = sv.source_id
      WHERE p.id = ANY($1)`, [rv.provision_ids])).rows;
  const history = (await tx.query(
    `SELECT id, decision, decided_by, reason, decided_at, rule_version_id FROM obligations
      WHERE company_id = $1 AND site_id = $2 AND rule_id = $3 ORDER BY decided_at`, [companyId, o.site_id, o.rule_id])).rows;
  const latest = history[history.length - 1];
  const reviews = (await tx.query(`SELECT r.id, r.status, r.reason, r.requested_at, r.reviewed_at, r.review_notes, ru.display_name AS requested_by_name, vu.display_name AS reviewed_by_name
     FROM obligation_override_requests r JOIN obligations ob ON ob.id = r.obligation_id JOIN users ru ON ru.id = r.requested_by LEFT JOIN users vu ON vu.id = r.reviewed_by
    WHERE r.company_id = $1 AND ob.site_id = $2 AND ob.rule_id = $3 ORDER BY r.requested_at`, [companyId, o.site_id, o.rule_id])).rows;
  const pending = (await tx.query(`SELECT r.*, u.display_name AS requested_by_name FROM obligation_override_requests r JOIN users u ON u.id = r.requested_by
     WHERE r.obligation_id = $1 AND r.status = 'pending'`, [o.id])).rows[0];
  const manualName = o.decided_by !== 'engine'
    ? (await tx.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id::text = $1`, [o.decided_by])).rows[0]?.display_name ?? null : null;
  return {
    obligation: { id: o.id, decision: o.decision, reason: o.reason, decidedBy: o.decided_by, decidedByName: manualName, decidedAt: o.decided_at, missingFacts: o.missing_facts,
      isCurrent: latest?.id === o.id, currentId: latest?.id ?? o.id, manual: o.decided_by !== 'engine',
      canOverride: can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok,
      mandatory: rv.kind !== 'good_practice' },
    pendingReview: pending ? { id: pending.id, reason: pending.reason, requestedBy: pending.requested_by, requestedByName: pending.requested_by_name, requestedAt: pending.requested_at,
      canReview: can(p, 'obligation.review', { companyId, siteId: o.site_id }).ok && pending.requested_by !== p.userId } : null,
    reviews: reviews,
    rule: {
      code: rv.code, version: rv.version, status: rv.status, kind: rv.kind, isExample: rv.is_example,
      title: rv.obligation_title, summary: rv.obligation_summary, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to,
      ambiguityNote: rv.ambiguity_note,
      label: rv.is_example ? 'ÖRNEK KURAL — hukuki dayanağı doğrulanmadı' : rv.kind === 'good_practice' ? 'İyi uygulama önerisi — mevzuat hükmü değil' : 'Mevzuat yükümlülüğü',
    },
    provisions,
    matchedFacts: o.facts_snapshot,
    trace: o.trace,
    history,
  };
}

/**
 * "Does not apply", decided by an authorised person with a reason.
 * - Good-practice suggestion: takes effect at once.
 * - Mandatory (legal) obligation: does NOT take effect; it becomes a review request that
 *   someone else must approve (another owner/HQ manager, or an outside expert with review
 *   access). Until then the obligation and its checks stay as they are.
 * Records are never removed: overdue checks become "missed" and stay in reports.
 */
export async function overrideNotApplicable(tx: Tx, p: Principal, companyId: string, obligationId: string, reason: string) {
  if (reason.trim().length < 10) throw invalid('"Uygulanmıyor" kararı en az bir cümlelik gerekçe ister.');
  const o = (await tx.query(`SELECT o.*, rv.kind AS rule_kind, rv.obligation_title FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id
     WHERE o.id = $1 AND o.company_id = $2`, [obligationId, companyId])).rows[0];
  if (!o) throw notFound('Yükümlülük');
  if (!can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok) throw forbidden();
  await assertCurrent(tx, companyId, o);
  if (o.decision === 'not_applicable') throw conflict('ALREADY_NOT_APPLICABLE', 'Bu yükümlülük zaten "uygulanmaz".');
  if (o.rule_kind !== 'good_practice') {
    if ((await tx.query(`SELECT 1 FROM obligation_override_requests WHERE obligation_id = $1 AND status = 'pending'`, [o.id])).rowCount) {
      throw conflict('REVIEW_PENDING', 'Bu yükümlülük için bekleyen bir inceleme isteği var.');
    }
    const r = (await tx.query<{ id: string }>(`INSERT INTO obligation_override_requests (company_id, site_id, obligation_id, reason, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, o.site_id, o.id, reason.trim(), p.userId])).rows[0]!;
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_requested', entityType: 'obligation', entityId: o.id,
      payload: { requestId: r.id, reason: reason.trim(), current: o.decision } });
    await notify(tx, { companyId, siteId: o.site_id, userIds: await reviewers(tx, companyId), except: p.userId, kind: 'obligation_review_requested',
      entityType: 'obligation', entityId: o.id, dedupeKey: `obligation_review:${r.id}`, title: '"Uygulanmaz" isteği incelemeni bekliyor', body: `${o.obligation_title} · ${reason.trim()}` });
    return { status: 'pending_review' as const, requestId: r.id, id: o.id as string };
  }
  const id = await applyNotApplicable(tx, companyId, o, p.userId, reason.trim(), null);
  return { status: 'applied' as const, id };
}

async function assertCurrent(tx: Tx, companyId: string, o: any) {
  const current = (await currentObligations(tx, companyId, o.site_id)).find(x => x.rule_id === o.rule_id);
  if (!current || current.id !== o.id) throw new AppError(409, 'NOT_CURRENT', 'Bu karar artık geçerli karar değil; güncel kararı aç.');
}

async function applyNotApplicable(tx: Tx, companyId: string, o: any, decidedBy: string, reason: string, reviewer: { id: string; requestId: string } | null) {
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO obligations (company_id, site_id, rule_id, rule_version_id, decision, decided_by, reason, trace, facts_snapshot, missing_facts)
     VALUES ($1,$2,$3,$4,'not_applicable',$5,$6,$7,$8,'{}') RETURNING id`,
    [companyId, o.site_id, o.rule_id, o.rule_version_id, decidedBy, reason, JSON.stringify(o.trace), JSON.stringify(o.facts_snapshot)]);
  const t = await cancelOpenTasks(tx, companyId, o.id, 'Yetkili kişi "uygulanmıyor" kararı verdi', 'override');
  await appendAudit(tx, { companyId, actorId: reviewer?.id ?? decidedBy, eventType: 'obligation.overridden', entityType: 'obligation', entityId: ins.rows[0]!.id,
    payload: { previous: o.decision, decision: 'not_applicable', reason, requestedBy: decidedBy, reviewedBy: reviewer?.id ?? null, requestId: reviewer?.requestId ?? null, ...t } });
  return ins.rows[0]!.id;
}

/** Who may review: owners/HQ managers (membership) and outside experts holding review access. */
async function reviewers(tx: Tx, companyId: string): Promise<string[]> {
  return (await tx.query<{ user_id: string }>(
    `SELECT user_id FROM memberships WHERE company_id = $1 AND status = 'active' AND site_id IS NULL AND role IN ('owner','hq_manager')
     UNION SELECT user_id FROM access_grants WHERE company_id = $1 AND revoked_at IS NULL AND expires_at > now() AND 'obligation_review' = ANY(scopes)`,
    [companyId])).rows.map(r => r.user_id);
}

/** The reviewer (not the requester) approves or rejects a pending "does not apply" request. */
export async function reviewOverride(tx: Tx, p: Principal, companyId: string, requestId: string, b: { decision: 'approved' | 'rejected'; notes: string }) {
  const r = (await tx.query(`SELECT * FROM obligation_override_requests WHERE id = $1 AND company_id = $2 FOR UPDATE`, [requestId, companyId])).rows[0];
  if (!r) throw notFound('İnceleme isteği');
  if (!can(p, 'obligation.review', { companyId, siteId: r.site_id }).ok) throw forbidden('İnceleme yetkin yok.');
  if (r.requested_by === p.userId) throw forbidden('Kendi isteğini inceleyemezsin; başka bir yetkili ya da uzman incelemeli.');
  if (r.status !== 'pending') throw conflict('NOT_PENDING', 'Bu istek artık beklemede değil.');
  if (b.notes.trim().length < 5) throw invalid('İnceleme notu yaz.');
  const o = (await tx.query(`SELECT * FROM obligations WHERE id = $1`, [r.obligation_id])).rows[0];
  if (b.decision === 'approved') await assertCurrent(tx, companyId, o);
  await tx.query(`UPDATE obligation_override_requests SET status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(), review_notes = $4 WHERE id = $1`,
    [requestId, b.decision, p.userId, b.notes.trim()]);
  let newId: string | null = null;
  if (b.decision === 'approved') {
    newId = await applyNotApplicable(tx, companyId, o, r.requested_by, `${r.reason} (İnceleme: ${b.notes.trim()})`, { id: p.userId, requestId });
  } else {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_rejected', entityType: 'obligation', entityId: o.id,
      payload: { requestId, notes: b.notes.trim() } });
  }
  await notify(tx, { companyId, siteId: r.site_id, userIds: [r.requested_by], kind: 'obligation_review_done', entityType: 'obligation', entityId: newId ?? o.id,
    dedupeKey: `obligation_review_done:${requestId}`, title: b.decision === 'approved' ? '"Uygulanmaz" isteğin onaylandı' : '"Uygulanmaz" isteğin reddedildi', body: b.notes.trim() });
  return { status: b.decision, obligationId: (newId ?? o.id) as string };
}

/** The requester (or another authorised person) withdraws a pending request. */
export async function withdrawOverrideRequest(tx: Tx, p: Principal, companyId: string, requestId: string) {
  const r = (await tx.query(`SELECT * FROM obligation_override_requests WHERE id = $1 AND company_id = $2 FOR UPDATE`, [requestId, companyId])).rows[0];
  if (!r) throw notFound('İnceleme isteği');
  if (!can(p, 'obligation.override', { companyId, siteId: r.site_id }).ok) throw forbidden();
  if (r.status !== 'pending') throw conflict('NOT_PENDING', 'Bu istek artık beklemede değil.');
  await tx.query(`UPDATE obligation_override_requests SET status = 'withdrawn' WHERE id = $1`, [requestId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_request_withdrawn', entityType: 'obligation', entityId: r.obligation_id, payload: { requestId } });
}

/**
 * Withdraws a manual "does not apply" decision: the rule engine decides again from the
 * current facts. Nothing is deleted; the manual decision stays in the history.
 */
export async function revertOverride(tx: Tx, p: Principal, companyId: string, obligationId: string) {
  const o = (await tx.query(`SELECT * FROM obligations WHERE id = $1 AND company_id = $2`, [obligationId, companyId])).rows[0];
  if (!o) throw notFound('Yükümlülük');
  if (!can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok) throw forbidden();
  const current = (await currentObligations(tx, companyId, o.site_id)).find(x => x.rule_id === o.rule_id);
  if (!current || current.id !== o.id) throw new AppError(409, 'NOT_CURRENT', 'Bu karar artık geçerli karar değil; güncel kararı aç.');
  if (o.decided_by === 'engine') throw new AppError(409, 'NOT_MANUAL', 'Bu karar kural motorunundur; geri alınacak elle verilmiş bir karar yok.');
  await recomputeSite(tx, companyId, o.site_id, p.userId, new Date(), o.rule_id);
  const now = (await currentObligations(tx, companyId, o.site_id)).find(x => x.rule_id === o.rule_id)!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_withdrawn', entityType: 'obligation', entityId: now.id,
    payload: { withdrawn: o.id, decision: now.decision } });
  return { id: now.id as string, decision: now.decision as string, siteId: o.site_id as string };
}
