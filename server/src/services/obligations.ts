import type { Tx } from '../db/pool';
import { decide } from '../domain/applicability';
import type { Facts } from '../domain/conditions';
import { AppError, forbidden, invalid, notFound } from '../domain/errors';
import { canonical } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
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
      result.cancelledTasks += await cancelOpenTasks(tx, companyId, prev.id, `Yükümlülük kararı değişti: ${d.decision}`);
    } else if (prev && prev.rule_version_id !== rv.id) {
      // New rule version, still applies: open tasks stay valid but are flagged so a person checks them.
      await tx.query(`UPDATE tasks SET review_flag = 'RULE_VERSION_CHANGED' WHERE obligation_id = $1 AND status = 'open'`, [prev.id]);
    }
  }
  return result;
}

async function cancelOpenTasks(tx: Tx, companyId: string, obligationId: string, reason: string) {
  const r = await tx.query(`UPDATE tasks SET status = 'cancelled', status_reason = $3 WHERE company_id = $1 AND obligation_id = $2 AND status = 'open'`,
    [companyId, obligationId, reason]);
  return r.rowCount ?? 0;
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
  const manualName = o.decided_by !== 'engine'
    ? (await tx.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id::text = $1`, [o.decided_by])).rows[0]?.display_name ?? null : null;
  return {
    obligation: { id: o.id, decision: o.decision, reason: o.reason, decidedBy: o.decided_by, decidedByName: manualName, decidedAt: o.decided_at, missingFacts: o.missing_facts,
      isCurrent: latest?.id === o.id, currentId: latest?.id ?? o.id, manual: o.decided_by !== 'engine',
      canOverride: can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok },
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

/** A person decides "does not apply"; the reason and the decider are kept. */
export async function overrideNotApplicable(tx: Tx, p: Principal, companyId: string, obligationId: string, reason: string) {
  if (reason.trim().length < 10) throw invalid('"Uygulanmıyor" kararı en az bir cümlelik gerekçe ister.');
  const o = (await tx.query(`SELECT * FROM obligations WHERE id = $1 AND company_id = $2`, [obligationId, companyId])).rows[0];
  if (!o) throw notFound('Yükümlülük');
  if (!can(p, 'obligation.override', { companyId, siteId: o.site_id }).ok) throw forbidden();
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO obligations (company_id, site_id, rule_id, rule_version_id, decision, decided_by, reason, trace, facts_snapshot, missing_facts)
     VALUES ($1,$2,$3,$4,'not_applicable',$5,$6,$7,$8,'{}') RETURNING id`,
    [companyId, o.site_id, o.rule_id, o.rule_version_id, p.userId, reason, JSON.stringify(o.trace), JSON.stringify(o.facts_snapshot)]);
  await cancelOpenTasks(tx, companyId, o.id, 'Yetkili kişi "uygulanmıyor" kararı verdi');
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'obligation.overridden', entityType: 'obligation', entityId: ins.rows[0]!.id,
    payload: { previous: o.decision, decision: 'not_applicable', reason } });
  return ins.rows[0]!.id;
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
