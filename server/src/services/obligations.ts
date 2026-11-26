import type { Tx } from '../db/pool';
import { decide } from '../domain/applicability';
import type { Facts } from '../domain/conditions';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { canonical } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify } from './notifications';
import { relatedCourses } from './training';
import { currentFacts, recordFact } from './profile';
import { describeCondition, frequencyText, reasonLines } from '../domain/explain-text';
import { evidenceLabels } from './task-assignment';
import { FACTS, isFactKey, matchesType, type FactKey } from '../domain/facts';

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
    `SELECT DISTINCT ON (o.site_id, o.rule_id) o.*, rv.version AS rule_version, rv.kind, rv.is_example, rv.obligation_title, rv.status AS rule_status, r.code AS rule_code,
            EXISTS (SELECT 1 FROM obligation_override_requests q WHERE q.obligation_id = o.id AND q.status = 'pending') AS review_pending
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
export async function recomputeSite(tx: Tx, companyId: string, siteId: string, actorId: string | null, now = new Date(), forceRuleId: string | null = null, onDateOverride: string | null = null): Promise<RecomputeResult> {
  const onDate = onDateOverride ?? today(now);
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
    let d = decide({ ruleVersionId: rv.id, condition: rv.condition, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to, ambiguityNote: rv.ambiguity_note }, facts, onDate);
    if (!d && rv.effective_to && rv.effective_to < onDate && prev && prev.decision !== 'not_applicable') {
      // The rule's end date has passed (a repeal, or a rule that was bounded in time): it stops applying. The old
      // decision and the work done under it stay as history; only open work is closed (see cancelOpenTasks).
      d = { decision: 'not_applicable', trace: { result: 'false', note: 'expired' } as never, missingFacts: [], reason: `Kuralın yürürlük süresi ${rv.effective_to} tarihinde sona erdi (yürürlükten kaldırıldı).` };
    }
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
  const reviews = (await tx.query(`SELECT r.id, r.status, r.reason, r.basis, r.disputed_facts, r.engine_outcome, r.requested_at, r.reviewed_at, r.review_notes, ru.display_name AS requested_by_name, vu.display_name AS reviewed_by_name
     FROM obligation_override_requests r JOIN obligations ob ON ob.id = r.obligation_id JOIN users ru ON ru.id = r.requested_by LEFT JOIN users vu ON vu.id = r.reviewed_by
    WHERE r.company_id = $1 AND ob.site_id = $2 AND ob.rule_id = $3 ORDER BY r.requested_at`, [companyId, o.site_id, o.rule_id])).rows;
  const pending = (await tx.query(`SELECT r.*, u.display_name AS requested_by_name FROM obligation_override_requests r JOIN users u ON u.id = r.requested_by
     WHERE r.obligation_id = $1 AND r.status = 'pending'`, [o.id])).rows[0];
  const siteFacts = await currentFacts(tx, companyId, o.site_id);
  const manualName = o.decided_by !== 'engine'
    ? (await tx.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id::text = $1`, [o.decided_by])).rows[0]?.display_name ?? null : null;
  const siteName = (await tx.query<{ name: string }>(`SELECT name FROM sites WHERE id = $1`, [o.site_id])).rows[0]?.name ?? null;
  return {
    obligation: { id: o.id, siteId: o.site_id as string, siteName, decision: o.decision, reason: o.reason, decidedBy: o.decided_by, decidedByName: manualName, decidedAt: o.decided_at, missingFacts: o.missing_facts,
      isCurrent: latest?.id === o.id, currentId: latest?.id ?? o.id, manual: o.decided_by !== 'engine',
      canOverride: can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok,
      mandatory: rv.kind !== 'good_practice' },
    pendingReview: pending ? { id: pending.id, reason: pending.reason, basis: pending.basis, disputedFacts: pending.disputed_facts, requestedBy: pending.requested_by, requestedByName: pending.requested_by_name, requestedAt: pending.requested_at,
      canReview: can(p, 'obligation.review', { companyId, siteId: o.site_id }).ok && pending.requested_by !== p.userId } : null,
    reviews: reviews,
    rule: {
      code: rv.code, version: rv.version, status: rv.status, kind: rv.kind, isExample: rv.is_example,
      title: rv.obligation_title, summary: rv.obligation_summary, effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to,
      ambiguityNote: rv.ambiguity_note,
      label: rv.is_example ? 'ÖRNEK KURAL — hukuki dayanağı doğrulanmadı' : rv.kind === 'good_practice' ? 'İyi uygulama önerisi — mevzuat hükmü değil' : 'Mevzuat yükümlülüğü',
    },
    provisions,
    // The rule's conditions with today's values: what a "does not apply" request has to dispute.
    conditionFacts: (rv.required_facts as string[]).filter(isFactKey).map(k => {
      const f = siteFacts[k];
      return { key: k, label: FACTS[k].label, type: FACTS[k].type, current: f?.value ?? null, source: f?.source ?? null, verification: f?.verification ?? null };
    }),
    relatedTraining: await relatedCourses(tx, companyId, { ruleCode: rv.code }),
    matchedFacts: o.facts_snapshot,
    // Where each matched answer came from (e.g. derived from the confirmed activity code), so the "why" can be traced to its source.
    factOrigins: Object.fromEntries((await tx.query<{ key: string; source_ref: string | null; note: string | null }>(
      `SELECT DISTINCT ON (key) key, source_ref, note FROM profile_facts
        WHERE company_id = $1 AND (site_id IS NULL OR site_id = $2) AND key = ANY($3) AND verification <> 'rejected'
        ORDER BY key, (site_id IS NULL), recorded_at DESC`, [companyId, o.site_id, Object.keys(o.facts_snapshot ?? {})])).rows.map(r => [r.key, { sourceRef: r.source_ref, note: r.note }])),
    trace: o.trace,
    // GH-02: the decision in the person's own words, and what the rule itself requires.
    ...(await explanationExtras(tx, o, rv, pending)),
    history,
  };
}

/** Wording for the person (why, in their answers), the rule's definition and the review status. Pure reading; decides nothing. */
async function explanationExtras(tx: Tx, o: any, rv: any, pending: any) {
  const lines = reasonLines(o.decision, o.trace);
  const templates = (await tx.query(`SELECT code, title, recurrence, evidence FROM task_templates WHERE rule_version_id = $1 ORDER BY code`, [rv.id])).rows;
  // Two separate labels on purpose: an internal good practice is never presented as a legal duty, and an example is never presented as verified.
  const label = `${rv.is_example ? 'Örnek ' : ''}${rv.kind === 'good_practice' ? 'iyi uygulama (mevzuat hükmü değil)' : 'kural (hukuki dayanağı doğrulanmadı)'}`.replace(/^./, c => c.toLocaleUpperCase('tr'));
  return {
    reasonText: lines.text, matchedStatements: lines.matched, missingStatements: lines.missing,
    // While a "does not apply" request is under review the obligation is still in force; say so in plain words.
    reviewStatus: pending
      ? { state: 'in_review', text: 'İnceleme sürüyor: bu yükümlülük incelemenin sonucuna kadar geçerli; görevler devam ediyor.' }
      : o.decision === 'needs_info' ? { state: 'needs_info', text: 'Bilgi bekleniyor: eksik yanıt gelene kadar yükümlülük “uygulanmaz” sayılmaz ve uygunluk verilmez.' }
      : { state: 'none', text: null },
    definition: {
      label, kind: rv.kind, scope: rv.scope ?? {}, appliesWhen: describeCondition(rv.condition),
      notApplicableWhen: 'Yukarıdaki koşullardan biri sağlanmazsa uygulanmaz. Yanlış yanıtı gerekçeyle düzeltmeyi isteyebilirsiniz; zorunlu yükümlülüklerde karar ikinci bir kişiye gider.',
      effectiveFrom: rv.effective_from, effectiveTo: rv.effective_to,
      // The rule model does not hold a responsible role yet: assignment is made by a manager per task. Stated, not invented.
      responsibleRole: null,
      checks: templates.map(t => ({ code: t.code, title: t.title, frequency: frequencyText(t.recurrence), evidence: evidenceLabels(t.evidence) })),
    },
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
export type DisputedFact = { key: string; proposed: unknown };

export async function overrideNotApplicable(tx: Tx, p: Principal, companyId: string, obligationId: string, reason: string,
  claim: { disputedFacts?: DisputedFact[]; basis?: string } = {}) {
  if (reason.trim().length < 10) throw invalid('"Uygulanmıyor" kararı en az bir cümlelik gerekçe ister.');
  const o = (await tx.query(`SELECT o.*, rv.kind AS rule_kind, rv.obligation_title, rv.condition, rv.required_facts, rv.effective_from, rv.effective_to, rv.ambiguity_note
       FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id
     WHERE o.id = $1 AND o.company_id = $2`, [obligationId, companyId])).rows[0];
  if (!o) throw notFound('Yükümlülük');
  if (!can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok) throw forbidden();
  await assertCurrent(tx, companyId, o);
  if (o.decision === 'not_applicable') throw conflict('ALREADY_NOT_APPLICABLE', 'Bu yükümlülük zaten "uygulanmaz".');
  if (o.rule_kind !== 'good_practice') {
    if ((await tx.query(`SELECT 1 FROM obligation_override_requests WHERE obligation_id = $1 AND status = 'pending'`, [o.id])).rowCount) {
      throw conflict('REVIEW_PENDING', 'Bu yükümlülük için bekleyen bir inceleme isteği var.');
    }
    // A mandatory obligation follows from the business facts. "Does not apply" therefore has to say
    // which of the rule's conditions does not hold (the disputed facts, with the correct value) and
    // on what basis; the rule engine, not the people, then decides with the corrected facts.
    const basis = (claim.basis ?? '').trim();
    const disputed = normalizeDisputed(o, claim.disputedFacts ?? []);
    if (basis.length < 10) throw invalid('Dayanağı yaz: hangi belge, gözlem ya da kayıt bu bilgileri gösteriyor?');
    const outcome = await engineWith(tx, companyId, o, disputed);
    if (outcome.decision === 'applies') {
      throw new AppError(422, 'RULE_STILL_APPLIES', 'Önerdiğin bilgilerle kuralın koşulları hâlâ karşılanıyor; yükümlülük devreden çıkamaz. Hangi koşulun sağlanmadığını seç.', { outcome: outcome.decision });
    }
    const r = (await tx.query<{ id: string }>(`INSERT INTO obligation_override_requests (company_id, site_id, obligation_id, reason, requested_by, disputed_facts, basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [companyId, o.site_id, o.id, reason.trim(), p.userId, JSON.stringify(disputed), basis])).rows[0]!;
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_requested', entityType: 'obligation', entityId: o.id,
      payload: { requestId: r.id, reason: reason.trim(), current: o.decision, disputedFacts: disputed, basis, expectedOutcome: outcome.decision } });
    await notify(tx, { companyId, siteId: o.site_id, userIds: await reviewers(tx, companyId), except: p.userId, kind: 'obligation_review_requested',
      entityType: 'obligation', entityId: o.id, dedupeKey: `obligation_review:${r.id}`, title: '"Uygulanmaz" isteği incelemeni bekliyor', body: `${o.obligation_title} · ${reason.trim()}` });
    return { status: 'pending_review' as const, requestId: r.id, id: o.id as string };
  }
  const id = await applyNotApplicable(tx, companyId, o, p.userId, reason.trim(), null);
  return { status: 'applied' as const, id };
}

/** Disputed facts must be conditions of this rule, each with a value of the right type. */
function normalizeDisputed(o: any, xs: DisputedFact[]): { key: FactKey; proposed: unknown }[] {
  if (!xs.length) throw invalid('Kuralın hangi koşulunun sizin için geçerli olmadığını seç (en az bir bilgi).');
  const seen = new Set<string>();
  return xs.map(x => {
    if (!(o.required_facts as string[]).includes(x.key) || !isFactKey(x.key)) throw invalid(`"${x.key}" bu kuralın koşullarından biri değil.`);
    if (seen.has(x.key)) throw invalid('Aynı bilgi iki kez seçilmiş.');
    seen.add(x.key);
    if (!matchesType(FACTS[x.key].type, x.proposed)) throw invalid(`${FACTS[x.key].label} için değer tipi ${FACTS[x.key].type} olmalı.`);
    return { key: x.key, proposed: x.proposed };
  });
}

/** What the rule engine would decide if the disputed facts held (confirmed) on top of the current ones. */
async function engineWith(tx: Tx, companyId: string, o: any, disputed: { key: FactKey; proposed: unknown }[]) {
  const facts = { ...(await currentFacts(tx, companyId, o.site_id)) };
  const now = new Date().toISOString();
  for (const d of disputed) {
    facts[d.key] = { id: 'proposed', key: d.key, value: d.proposed, source: 'user_declared', verification: 'user_confirmed', validFrom: null, validTo: null, recordedAt: now };
  }
  return decide({ ruleVersionId: o.rule_version_id, condition: o.condition, effectiveFrom: '0000-01-01', effectiveTo: null, ambiguityNote: o.ambiguity_note }, facts, today())
    ?? { decision: 'not_applicable' as const };
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
  const o = (await tx.query(`SELECT o.*, rv.condition, rv.required_facts, rv.ambiguity_note FROM obligations o JOIN rule_versions rv ON rv.id = o.rule_version_id
     WHERE o.id = $1`, [r.obligation_id])).rows[0];
  if (b.decision === 'approved') await assertCurrent(tx, companyId, o);
  let newId: string | null = null;
  let engineOutcome: string | null = null;
  if (b.decision === 'approved') {
    // Two signatures are not the decision. Approving means the reviewer confirms the disputed facts;
    // they are recorded as reviewed profile facts and the rule engine decides again from them.
    if (!r.disputed_facts) throw new AppError(422, 'CLAIM_INCOMPLETE', 'Bu istek hangi koşulun sağlanmadığını belirtmiyor; reddet ve gerekçeli yeni istek açılsın.');
    const expert = can(p, 'profile.verify', { companyId, siteId: r.site_id }).ok;
    if (!expert && !can(p, 'profile.write', { companyId, siteId: r.site_id }).ok) throw forbidden('Bilgileri doğrulama yetkin yok; inceleme için profil doğrulama yetkisi gerekir.');
    for (const d of r.disputed_facts as { key: FactKey; proposed: unknown }[]) {
      await recordFact(tx, p, companyId, { siteId: FACTS[d.key].level === 'site' ? r.site_id : null, key: d.key, value: d.proposed,
        source: expert ? 'expert' : 'user_declared', verification: expert ? 'expert_verified' : 'user_confirmed',
        sourceRef: `override_request:${requestId}`, note: `İnceleme: ${b.notes.trim()} · Dayanak: ${r.basis}` });
    }
    await recomputeSite(tx, companyId, r.site_id, p.userId, new Date(), o.rule_id);
    const now = (await currentObligations(tx, companyId, r.site_id)).find(x => x.rule_id === o.rule_id)!;
    engineOutcome = now.decision;
    if (now.decision !== 'not_applicable') {
      // Rolled back with the transaction: the facts still meet the rule, so it stays in force.
      throw new AppError(422, 'RULE_STILL_APPLIES', now.decision === 'applies'
        ? 'Doğrulanan bilgilerle kuralın koşulları hâlâ karşılanıyor; yükümlülük devreden çıkmaz. İsteği reddet ya da bilgileri düzelt.'
        : `Kural motoru bu bilgilerle "uygulanmaz" sonucuna varmadı (sonuç: ${now.decision}); yükümlülük devreden çıkmaz.`, { outcome: now.decision });
    }
    newId = now.id;
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.override_approved', entityType: 'obligation', entityId: now.id,
      payload: { requestId, requestedBy: r.requested_by, reviewedBy: p.userId, disputedFacts: r.disputed_facts, basis: r.basis, engineOutcome, notes: b.notes.trim() } });
  }
  await tx.query(`UPDATE obligation_override_requests SET status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(), review_notes = $4, engine_outcome = $5 WHERE id = $1`,
    [requestId, b.decision, p.userId, b.notes.trim(), engineOutcome]);
  if (b.decision !== 'approved') {
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
