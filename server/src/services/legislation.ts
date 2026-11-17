import { createHash } from 'node:crypto';
import type { Db, Tx } from '../db/pool';
import { decide } from '../domain/applicability';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { isFactKey, FACTS } from '../domain/facts';
import { appendAudit } from './audit';
import { notify } from './notifications';
import { currentObligations, recomputeSite } from './obligations';
import { currentFacts } from './profile';
import { approve as approveRuleVersion, insertDraft, publishVersion, validateDraftInput, needReason, type DraftInput } from './rules';
import { topUpSite } from './tasks';
import {
  OFFICIAL_HOSTS, defaultFetcher, istanbulDay, parseWatchList, scanConsolidated, scanGazette, trDate,
  type DetectedChange, type Fetcher, type ScanOutcome, type SourceCode, type WatchDoc,
} from './legislation-sources';

/*
 * Daily legislation watch → review queue → admin approval → scheduled application.
 *  - Detection only proposes. Nothing reaches a business before a reviewer approves with a reason.
 *  - Content that reaches businesses (conditions, tasks, periods) comes from the approved RULE VERSION, never from the detected text.
 *  - Applying uses the existing machinery: rule version publish, per-site re-evaluation, task generation, in-app notifications.
 */

export type LegislationConfig = {
  rgBase: string; mevzuatBase: string; watch: WatchDoc[]; lookbackDays: number; fetcher: Fetcher; allowExampleRules: boolean;
  sleep?: (ms: number) => Promise<void>; scanHour: number; enabled: boolean;
};
export function legislationConfig(env: Record<string, string | undefined> = process.env, over: Partial<LegislationConfig> = {}): LegislationConfig {
  return {
    rgBase: env.LEGISLATION_RG_BASE?.trim() || 'https://www.resmigazete.gov.tr',
    mevzuatBase: env.LEGISLATION_MEVZUAT_BASE?.trim() || 'https://www.mevzuat.gov.tr',
    watch: parseWatchList(env.LEGISLATION_MEVZUAT_WATCH), lookbackDays: Math.min(Math.max(Number(env.LEGISLATION_LOOKBACK_DAYS ?? 3) || 3, 0), 30),
    fetcher: defaultFetcher, allowExampleRules: env.DEMO_MODE === 'true', scanHour: Number(env.LEGISLATION_SCAN_HOUR ?? 6),
    enabled: env.LEGISLATION_SCAN_ENABLED === '1', ...over,
  };
}

const has = (p: Principal, r: Principal['platformRoles'][number]) => p.platformRoles.includes(r);
const canView = (p: Principal) => p.platformRoles.length > 0;
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
const isOfficial = (code: SourceCode, base: string) => { const h = hostOf(base); return h === OFFICIAL_HOSTS[code] || h.endsWith('.' + OFFICIAL_HOSTS[code]); };
const SOURCE_NAMES: Record<SourceCode, string> = { resmi_gazete: 'Resmî Gazete', mevzuat: 'Mevzuat Bilgi Sistemi' };
export const CHANGE_TYPE_TR = { new_publication: 'Yeni yayın', article_amendment: 'Madde değişikliği', repeal: 'Yürürlükten kaldırma' } as const;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

// ───────────── Scanning ─────────────

export type SourceResult = { source: SourceCode; ok: boolean; seen: number; created: number; errors: string[]; notes: string[] };

async function ensureSources(tx: Tx, cfg: LegislationConfig) {
  for (const [code, base] of [['resmi_gazete', cfg.rgBase], ['mevzuat', cfg.mevzuatBase]] as const) {
    await tx.query(
      `INSERT INTO legislation_sources (code, name, base_url, is_example) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET base_url = EXCLUDED.base_url, is_example = EXCLUDED.is_example`, [code, SOURCE_NAMES[code], base, !isOfficial(code, base)]);
  }
}

/**
 * Runs one scan: reads each source, stores new proposals once, records per-source health. A source that cannot be read
 * keeps its last successful data (snapshots are only replaced after a successful read) and is retried by the scheduler.
 */
export async function runScan(db: Db, cfg: LegislationConfig, o: { trigger: 'schedule' | 'manual'; actorId?: string | null; now?: Date }) {
  const now = o.now ?? new Date();
  const today = istanbulDay(now);
  // Phase 1 (short transaction): one scan at a time.
  const start = await db.system(async tx => {
    await ensureSources(tx, cfg);
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('legislation_scan', 0))`);
    const busy = (await tx.query(`SELECT id FROM legislation_scan_runs WHERE status = 'running' AND started_at > now() - interval '20 minutes'`)).rowCount;
    if (busy) return null;
    await tx.query(`UPDATE legislation_scan_runs SET status = 'failed', finished_at = now(), results = '[{"error":"yarım kaldı"}]' WHERE status = 'running'`);
    const run = (await tx.query<{ id: string }>(`INSERT INTO legislation_scan_runs (trigger, actor_id, run_date) VALUES ($1,$2,$3) RETURNING id`, [o.trigger, o.actorId ?? null, today])).rows[0]!;
    const prev = new Map<string, Record<string, string>>();
    for (const r of (await tx.query(`SELECT doc_key, articles FROM legislation_documents WHERE source_code = 'mevzuat'`)).rows) prev.set(r.doc_key, r.articles);
    return { runId: run.id, prev };
  });
  if (!start) return { skipped: 'already_running' as const };

  // Phase 2 (no transaction): network.
  const outcomes: Partial<Record<SourceCode, ScanOutcome>> = {};
  const thrown: Partial<Record<SourceCode, string>> = {};
  try { outcomes.resmi_gazete = await scanGazette({ baseUrl: cfg.rgBase, today, lookbackDays: cfg.lookbackDays, fetcher: cfg.fetcher, sleep: cfg.sleep }); } catch (e) { thrown.resmi_gazete = (e as Error).message; }
  try { outcomes.mevzuat = await scanConsolidated({ baseUrl: cfg.mevzuatBase, watch: cfg.watch, previous: start.prev, fetcher: cfg.fetcher, today, sleep: cfg.sleep }); } catch (e) { thrown.mevzuat = (e as Error).message; }

  // Phase 3: persist.
  return db.system(async tx => {
    const results: SourceResult[] = [];
    for (const code of ['resmi_gazete', 'mevzuat'] as const) {
      const out = outcomes[code];
      const errors = out ? out.errors : [thrown[code] ?? 'okunamadı'];
      let created = 0;
      for (const c of out?.changes ?? []) created += await storeChange(tx, c, !isOfficial(code, code === 'resmi_gazete' ? cfg.rgBase : cfg.mevzuatBase));
      for (const s of out?.snapshots ?? []) {
        await tx.query(`INSERT INTO legislation_documents (source_code, doc_key, title, url, articles, content_sha256) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (source_code, doc_key) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, articles = EXCLUDED.articles, content_sha256 = EXCLUDED.content_sha256, retrieved_at = now()`,
          [code, s.docKey, s.title, s.url, JSON.stringify(s.articles), sha(JSON.stringify(s.articles))]);
      }
      const ok = errors.length === 0;
      await tx.query(
        `UPDATE legislation_sources SET last_attempt_at = now(), last_items_seen = $2,
           last_success_at = CASE WHEN $3 THEN now() ELSE last_success_at END,
           last_error = CASE WHEN $3 THEN NULL ELSE $4 END, last_error_at = CASE WHEN $3 THEN last_error_at ELSE now() END,
           failures_in_row = CASE WHEN $3 THEN 0 ELSE failures_in_row + 1 END WHERE code = $1`,
        [code, out?.seen ?? 0, ok, errors.join(' | ').slice(0, 1500)]);
      results.push({ source: code, ok, seen: out?.seen ?? 0, created, errors, notes: out?.notes ?? [] });
    }
    const status = results.every(r => r.ok) ? 'ok' : results.some(r => r.ok) ? 'partial' : 'failed';
    await tx.query(`UPDATE legislation_scan_runs SET finished_at = now(), status = $2, results = $3 WHERE id = $1`, [start.runId, status, JSON.stringify(results)]);
    await appendAudit(tx, { companyId: null, actorId: o.actorId ?? null, eventType: 'legislation.scanned', entityType: 'legislation_scan', entityId: start.runId,
      payload: { trigger: o.trigger, status, results: results.map(r => ({ source: r.source, ok: r.ok, seen: r.seen, created: r.created, errors: r.errors.slice(0, 3) })) } });
    return { runId: start.runId, status, results };
  });
}

async function storeChange(tx: Tx, c: DetectedChange, isExample: boolean): Promise<number> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO legislation_changes (source_code, external_key, change_type, doc_ref, doc_title, article_ref, source_url, published_on, effective_from, date_status, date_note,
        old_text, new_text, suggestion, is_example)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (source_code, external_key) DO NOTHING RETURNING id`,
    [c.sourceCode, c.externalKey, c.changeType, c.docRef, c.docTitle, c.articleRef, c.sourceUrl, c.publishedOn, c.effective.date, c.effective.status, c.effective.note,
      c.oldText, c.newText, JSON.stringify(c.suggestion), isExample]);
  if (!r.rowCount) return 0;
  await appendAudit(tx, { companyId: null, actorId: null, eventType: 'legislation.detected', entityType: 'legislation_change', entityId: r.rows[0]!.id,
    payload: { source: c.sourceCode, key: c.externalKey, type: c.changeType, ref: c.docRef, title: c.docTitle, article: c.articleRef, url: c.sourceUrl, effectiveFrom: c.effective.date, dateStatus: c.effective.status, example: isExample } });
  return 1;
}

// ───────────── Admin screen data ─────────────

export async function adminOverview(tx: Tx, p: Principal, cfg?: LegislationConfig) {
  if (!canView(p)) throw forbidden();
  if (cfg) await ensureSources(tx, cfg);
  const sources = (await tx.query(`SELECT code, name, base_url, is_example, enabled, last_attempt_at, last_success_at, last_error, last_error_at, failures_in_row, last_items_seen FROM legislation_sources ORDER BY code`)).rows;
  const counts = Object.fromEntries((await tx.query(`SELECT status, count(*)::int AS n FROM legislation_changes GROUP BY status`)).rows.map(r => [r.status, r.n]));
  const lastOk = (await tx.query(`SELECT finished_at, trigger FROM legislation_scan_runs WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`)).rows[0] ?? null;
  const lastRun = (await tx.query(`SELECT id, trigger, status, started_at, finished_at, results FROM legislation_scan_runs ORDER BY started_at DESC LIMIT 1`)).rows[0] ?? null;
  const unclear = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM legislation_changes WHERE status IN ('pending','drafted') AND date_status = 'unclear'`)).rows[0]!.n;
  return {
    sources, lastSuccessfulScan: lastOk, lastRun,
    pendingReview: (counts.pending ?? 0) + (counts.drafted ?? 0), counts: { pending: counts.pending ?? 0, drafted: counts.drafted ?? 0, scheduled: counts.scheduled ?? 0, applied: counts.applied ?? 0, rejected: counts.rejected ?? 0 },
    unclearDates: unclear,
    schedule: { enabled: cfg?.enabled ?? false, timezone: 'Europe/Istanbul', dailyAtHour: cfg?.scanHour ?? 6 },
    canScan: has(p, 'platform_admin') || has(p, 'rule_reviewer'),
    exampleNote: 'Örnek/sentetik kaynaktan gelen kayıtlar ÖRNEKTİR; gerçek veya uzman onaylı mevzuat olarak yayımlanamaz.',
  };
}

export async function listChanges(tx: Tx, p: Principal, status?: string) {
  if (!canView(p)) throw forbidden();
  return (await tx.query(
    `SELECT c.id, c.source_code, c.change_type, c.doc_ref, c.doc_title, c.article_ref, c.published_on, c.effective_from, c.date_status, c.status, c.is_example, c.apply_on, c.detected_at,
            c.rule_version_id, (c.proposal IS NOT NULL) AS has_proposal
       FROM legislation_changes c WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.detected_at DESC, c.id LIMIT 200`, [status ?? null])).rows
    .map(r => ({ ...r, typeLabel: CHANGE_TYPE_TR[r.change_type as keyof typeof CHANGE_TYPE_TR] }));
}

// ───────────── Impact preview ─────────────

type ImpactSpec = { ruleId: string | null; ruleVersionId: string | null; ruleCode: string; condition: any; effectiveFrom: string; effectiveTo: string | null; ambiguityNote: string | null; obligationTitle: string };
const IN_SCOPE = new Set(['applies', 'needs_review', 'needs_info']);

function nextDecision(spec: ImpactSpec, facts: any, onDate: string): { decision: string; reason: string; missing: string[] } {
  if (spec.effectiveTo && spec.effectiveTo < onDate) return { decision: 'not_applicable', reason: 'Kuralın yürürlük süresi sona erdi (yürürlükten kaldırıldı).', missing: [] };
  const d = decide({ ruleVersionId: spec.ruleVersionId ?? 'preview', condition: spec.condition, effectiveFrom: spec.effectiveFrom, effectiveTo: spec.effectiveTo, ambiguityNote: spec.ambiguityNote }, facts, onDate);
  return d ? { decision: d.decision, reason: d.reason, missing: d.missingFacts } : { decision: 'not_in_force', reason: 'Henüz yürürlükte değil.', missing: [] };
}

/** Which sites the change would touch on the day it takes effect, with what effect on open work. Writes nothing. */
export async function previewImpact(tx: Tx, spec: ImpactSpec, onDate: string) {
  const sites = (await tx.query(`SELECT s.id, s.company_id, s.name, c.name AS company FROM sites s JOIN companies c ON c.id = s.company_id ORDER BY c.name, s.name`)).rows;
  const prevRows = spec.ruleId
    ? (await tx.query(`SELECT DISTINCT ON (o.site_id) o.id, o.site_id, o.decision, o.rule_version_id FROM obligations o WHERE o.rule_id = $1 ORDER BY o.site_id, o.decided_at DESC`, [spec.ruleId])).rows : [];
  const prevBySite = new Map(prevRows.map(r => [r.site_id, r]));
  const openBy = new Map<string, number>();
  if (prevRows.length) for (const r of (await tx.query(`SELECT obligation_id, count(*)::int AS n FROM tasks WHERE obligation_id = ANY($1) AND status = 'open' GROUP BY obligation_id`, [prevRows.map(r => r.id)])).rows) openBy.set(r.obligation_id, r.n);
  const out: any[] = [];
  let outOfScope = 0;
  for (const s of sites) {
    const prev = prevBySite.get(s.id);
    const facts = await currentFacts(tx, s.company_id, s.id);
    const next = nextDecision(spec, facts, onDate);
    const prevIn = !!prev && IN_SCOPE.has(prev.decision);
    const nextIn = IN_SCOPE.has(next.decision);
    const versionChange = !!prev && !!spec.ruleVersionId && prev.rule_version_id !== spec.ruleVersionId;
    const ended = prevIn && next.decision === 'not_applicable';
    if (!nextIn && !ended) { outOfScope++; continue; }
    const open = prev ? openBy.get(prev.id) ?? 0 : 0;
    const effect = ended ? 'ended' : next.decision === 'needs_info' ? 'needs_info' : prev?.decision === 'applies' && next.decision === 'applies' ? (versionChange || !spec.ruleVersionId ? 'version_change' : 'unchanged') : 'new_obligation';
    if (effect === 'unchanged') { outOfScope++; continue; }
    out.push({
      companyId: s.company_id, company: s.company, siteId: s.id, site: s.name, from: prev?.decision ?? null, to: next.decision, effect, reason: next.reason, missingFacts: next.missing,
      openTasks: open,
      openTaskEffect: ended ? `${open} açık görev kapanır (süresi geçmişse "kaçırıldı", ilerideyse "iptal"); tamamlanmış görev, ölçüm ve kanıtlar eski kural sürümüne bağlı kalır.`
        : effect === 'version_change' ? `${open} açık görev kalır, "kural sürümü değişti" işaretiyle kontrol edilir; yeni görevler yeni sürümden üretilir.` : effect === 'new_obligation' ? 'Yeni yükümlülük; görevler yeni sürümden üretilir.' : 'Profil bilgisi eksik; görev üretilmez, bilgi istenir.',
      notify: next.decision === 'applies' || next.decision === 'needs_review' || ended,
    });
  }
  return { onDate, sites: out, affectedSites: out.length, notifiedSites: out.filter(x => x.notify).length, outOfScopeSites: outOfScope, openTasksAffected: out.reduce((a, x) => a + (x.effect === 'ended' || x.effect === 'version_change' ? x.openTasks : 0), 0) };
}

async function specFromRuleVersion(tx: Tx, rvId: string): Promise<ImpactSpec> {
  const rv = (await tx.query(`SELECT rv.*, r.code FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1`, [rvId])).rows[0];
  return { ruleId: rv.rule_id, ruleVersionId: rv.id, ruleCode: rv.code, condition: rv.condition, effectiveFrom: String(rv.effective_from).slice(0, 10), effectiveTo: rv.effective_to ? String(rv.effective_to).slice(0, 10) : null, ambiguityNote: rv.ambiguity_note, obligationTitle: rv.obligation_title };
}
async function specFromProposal(tx: Tx, proposal: any): Promise<ImpactSpec | null> {
  const rule = (await tx.query<{ id: string }>(`SELECT id FROM rules WHERE code = $1`, [proposal.code])).rows[0];
  return { ruleId: rule?.id ?? null, ruleVersionId: null, ruleCode: proposal.code, condition: proposal.condition, effectiveFrom: proposal.effectiveFrom, effectiveTo: proposal.effectiveTo ?? null, ambiguityNote: proposal.ambiguityNote ?? null, obligationTitle: proposal.obligationTitle };
}
const applyDay = (effectiveFrom: string | null, today: string) => !effectiveFrom || effectiveFrom < today ? today : effectiveFrom;

// ───────────── One change ─────────────

async function loadChange(tx: Tx, id: string, lock = false) {
  const c = (await tx.query(`SELECT * FROM legislation_changes WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!c) throw notFound('Mevzuat değişikliği');
  return c;
}

export async function getChange(tx: Tx, p: Principal, id: string, now = new Date()) {
  if (!canView(p)) throw forbidden();
  const c = await loadChange(tx, id);
  const today = istanbulDay(now);
  let impact: Awaited<ReturnType<typeof previewImpact>> | null = null;
  let impactNote: string | null = null;
  try {
    if (c.rule_version_id && c.status !== 'rejected') impact = await previewImpact(tx, await specFromRuleVersion(tx, c.rule_version_id), c.apply_on ?? applyDay(c.effective_from, today));
    else if (c.proposal && c.status === 'pending') impact = await previewImpact(tx, (await specFromProposal(tx, c.proposal))!, applyDay(c.proposal.effectiveFrom ?? c.effective_from, today));
    else impactNote = c.status === 'rejected' ? 'Reddedildi: hiçbir işletme etkilenmedi.' : 'Önizleme için önce önerilen kural değişikliğini yaz.';
  } catch { impactNote = 'Önizleme hesaplanamadı: önerilen kural alanlarını kontrol et.'; }
  const rule = c.rule_version_id ? (await tx.query(`SELECT rv.id, rv.version, rv.status, r.code, rv.obligation_title, rv.effective_from, rv.effective_to, rv.author_id, rv.required_review_areas FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1`, [c.rule_version_id])).rows[0] : null;
  const areaRows = rule ? (await tx.query(`SELECT DISTINCT ON (area) area, decision FROM rule_area_reviews WHERE rule_version_id = $1 ORDER BY area, created_at DESC`, [rule.id])).rows : [];
  const approvedAreas = new Set(areaRows.filter(r => r.decision === 'approved').map(r => r.area));
  const missingAreas = rule && rule.status === 'in_review' ? rule.required_review_areas.filter((a: string) => !approvedAreas.has(a)) : [];
  const history = (await tx.query(
    `SELECT a.seq, a.occurred_at, a.event_type, a.payload, u.display_name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.company_id IS NULL AND a.entity_type = 'legislation_change' AND a.entity_id = $1 ORDER BY a.seq`, [id])).rows;
  const published = (await tx.query(`SELECT r.code, r.title FROM rules r WHERE EXISTS (SELECT 1 FROM rule_versions rv WHERE rv.rule_id = r.id AND rv.status = 'published') ORDER BY r.code`)).rows;
  const blockers: string[] = [];
  if (c.date_status === 'unclear') blockers.push('Yürürlük tarihi belirsiz: bir yönetici tarihi çözene kadar uygulanamaz.');
  if (!c.source_url) blockers.push('Resmî kaynak bağlantısı yok.');
  if (!c.proposal && !c.rule_version_id) blockers.push('Önerilen kural değişikliği henüz yazılmadı.');
  return {
    id: c.id, status: c.status, sourceCode: c.source_code, changeType: c.change_type, typeLabel: CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR], scopeArea: c.scope_area,
    docRef: c.doc_ref, docTitle: c.doc_title, articleRef: c.article_ref, sourceUrl: c.source_url, publishedOn: c.published_on, effectiveFrom: c.effective_from,
    dateStatus: c.date_status, dateNote: c.date_note, oldText: c.old_text, newText: c.new_text, suggestion: c.suggestion, isExample: c.is_example,
    proposal: c.proposal, proposalBy: c.proposal_by, rule, missingAreaReviews: missingAreas,
    approveReason: c.approve_reason, rejectReason: c.reject_reason, applyOn: c.apply_on, appliedAt: c.applied_at, applyResult: c.apply_result, detectedAt: c.detected_at,
    impact, impactNote, history, publishedRules: published, blockers,
    can: {
      edit: (has(p, 'rule_author') || has(p, 'platform_admin')) && c.status === 'pending',
      resolveDate: (has(p, 'platform_admin') || has(p, 'rule_reviewer')) && ['pending', 'drafted'].includes(c.status) && c.date_status === 'unclear',
      prepare: has(p, 'rule_author') && c.status === 'pending',
      approve: has(p, 'rule_reviewer') && c.status === 'drafted' && !!rule && rule.author_id !== p.userId,
      reject: (has(p, 'rule_reviewer') || has(p, 'platform_admin')) && ['pending', 'drafted'].includes(c.status),
    },
    exampleNote: c.is_example ? 'ÖRNEK / SENTETİK KAYNAK — gerçek ya da uzman onaylı mevzuat değildir; yalnız demo ortamında kural olarak yayımlanabilir.' : null,
  };
}

/** The administrator settles an unclear entry-into-force date (with the reason). Until then nothing can be approved. */
export async function resolveDate(tx: Tx, p: Principal, id: string, b: { date: string; note: string }) {
  if (!has(p, 'platform_admin') && !has(p, 'rule_reviewer')) throw forbidden('Tarihi yalnızca platform yöneticisi ya da kural inceleyici çözebilir.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date))) throw invalid('Geçerli bir yürürlük tarihi yaz (YYYY-AA-GG).');
  const note = needReason(b.note, 'Tarihi belirlemek');
  const c = await loadChange(tx, id, true);
  if (!['pending', 'drafted'].includes(c.status)) throw conflict('INVALID_STATE', 'Bu kayıt artık tarih belirlemeye açık değil.');
  if (c.status === 'drafted') throw conflict('INVALID_STATE', 'Kural taslağı hazırlandıktan sonra tarih değişemez; kaydı reddedip yeniden açın.');
  await tx.query(`UPDATE legislation_changes SET effective_from = $2, date_status = 'known', date_note = $3 WHERE id = $1`, [id, b.date, `Yönetici belirledi: ${note}`]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.date_resolved', entityType: 'legislation_change', entityId: id, payload: { was: { date: c.effective_from, status: c.date_status, note: c.date_note }, date: b.date, reason: note } });
}

/** A starting point for the proposed rule: a copy of the rule being amended/repealed, or a skeleton for a new publication. Never saved by itself. */
export async function suggestProposal(tx: Tx, p: Principal, id: string, targetRuleCode?: string | null): Promise<DraftInput & { targetRuleCode: string | null }> {
  if (!has(p, 'rule_author') && !has(p, 'platform_admin')) throw forbidden();
  const c = await loadChange(tx, id);
  const eff = c.effective_from ? String(c.effective_from).slice(0, 10) : istanbulDay();
  if (targetRuleCode) {
    const cur = (await tx.query(`SELECT rv.*, r.code, r.title AS rule_title FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND rv.status = 'published'`, [targetRuleCode])).rows[0];
    if (!cur) throw invalid('Bu koddaki yayımlanmış kural bulunamadı.');
    const tpl = (await tx.query(`SELECT code, title, instructions, recurrence, evidence, limits, severity, hazard_type, emergency_instruction FROM task_templates WHERE rule_version_id = $1 ORDER BY code`, [cur.id])).rows;
    return {
      targetRuleCode, code: cur.code, title: cur.rule_title, kind: cur.kind, isExample: c.is_example || cur.is_example, provisionIds: [], ambiguityNote: cur.ambiguity_note, condition: cur.condition,
      obligationTitle: cur.obligation_title, obligationSummary: cur.obligation_summary,
      effectiveFrom: c.change_type === 'repeal' ? String(cur.effective_from).slice(0, 10) : eff,
      effectiveTo: c.change_type === 'repeal' ? addDays(eff, -1) : null,
      changeReason: `${CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR]}: ${c.doc_ref}${c.article_ref ? ` md. ${c.article_ref}` : ''}`,
      requiredReviewAreas: cur.required_review_areas ?? [],
      templates: tpl.map(t => ({ code: t.code, title: t.title, instructions: t.instructions, recurrence: t.recurrence, evidence: t.evidence, limits: t.limits, severity: t.severity, hazardType: t.hazard_type, emergencyInstruction: t.emergency_instruction ?? undefined })),
    } as DraftInput & { targetRuleCode: string | null };
  }
  return {
    targetRuleCode: null, code: `LEG-${sha(c.external_key).slice(0, 8).toUpperCase()}`, title: c.doc_title.slice(0, 120), kind: 'legal_requirement', isExample: c.is_example, provisionIds: [], ambiguityNote: null,
    condition: { fact: 'activity.food_preparation', op: 'eq', value: true },
    obligationTitle: c.doc_title.slice(0, 120), obligationSummary: (c.new_text ?? c.old_text ?? c.doc_title).replace(/\s+/g, ' ').slice(0, 400),
    effectiveFrom: eff, effectiveTo: null, changeReason: `${CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR]}: ${c.doc_ref}`, requiredReviewAreas: ['food_safety'],
    templates: [{ code: 'kontrol', title: 'Yeni düzenleme kontrolü', instructions: 'Uzman bu görevi düzenlemeye göre yazar (taslak yer tutucu).', recurrence: { freq: 'weekly', weekday: 1, at: '10:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'food_safety' }],
  } as DraftInput & { targetRuleCode: string | null };
}

/** The author's edited proposal. Checked exactly like a rule draft, kept on the change until a draft is prepared. */
export async function saveProposal(tx: Tx, p: Principal, id: string, raw: DraftInput & { targetRuleCode?: string | null }) {
  if (!has(p, 'rule_author') && !has(p, 'platform_admin')) throw forbidden('Öneriyi yalnızca kural yazarı ya da platform yöneticisi düzenler.');
  const c = await loadChange(tx, id, true);
  if (c.status !== 'pending') throw conflict('INVALID_STATE', 'Yalnız bekleyen öneri düzenlenir.');
  const { input } = await validateDraftInput(tx, { ...raw, isExample: raw.isExample || c.is_example });
  if (c.is_example && !input.isExample) throw invalid('Örnek/sentetik kaynaktan gelen öneri gerçek kural olamaz.');
  const exists = (await tx.query(`SELECT 1 FROM rules WHERE code = $1`, [input.code])).rowCount;
  if (c.change_type !== 'new_publication' && !exists) throw invalid('Değişiklik ve yürürlükten kaldırma, var olan bir kuralın kodunu kullanmalı.');
  if (c.change_type === 'repeal' && !input.effectiveTo) throw invalid('Yürürlükten kaldırma için bitiş tarihi gerekir.');
  await tx.query(`UPDATE legislation_changes SET proposal = $2, proposal_by = $3, proposal_at = now() WHERE id = $1`, [id, JSON.stringify({ ...raw, isExample: input.isExample }), p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.proposal_saved', entityType: 'legislation_change', entityId: id, payload: { code: input.code, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null } });
}

async function upsertProvision(tx: Tx, c: any): Promise<string> {
  const code = `leg:${c.source_code}:${String(c.external_key).replace(/^(rg|mv):/, '').split(':')[0]}`;
  const kind = /kanun/i.test(c.doc_title) ? 'law' : /tebli/i.test(c.doc_title) ? 'communique' : 'regulation';
  const src = (await tx.query<{ id: string }>(
    `INSERT INTO legal_sources (code, title, issuer, kind, url, is_example) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (code) DO NOTHING RETURNING id`,
    [code, `${c.is_example ? 'ÖRNEK — ' : ''}${c.doc_title}`.slice(0, 300), (c.suggestion?.issuer as string) || SOURCE_NAMES[c.source_code as SourceCode], kind, c.source_url, c.is_example])).rows[0] ?? (await tx.query<{ id: string }>(`SELECT id FROM legal_sources WHERE code = $1`, [code])).rows[0]!;
  const label = `${c.published_on ?? 'sürüm'} · ${c.doc_ref}${c.article_ref ? ` md.${c.article_ref}` : ''} · ${sha(c.external_key).slice(0, 6)}`;
  const sv = (await tx.query<{ id: string }>(
    `INSERT INTO source_versions (source_id, version_label, published_on, effective_from, content_sha256) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (source_id, version_label) DO NOTHING RETURNING id`,
    [src.id, label, c.published_on, c.effective_from, sha(c.new_text ?? c.old_text ?? '')])).rows[0] ?? (await tx.query<{ id: string }>(`SELECT id FROM source_versions WHERE source_id = $1 AND version_label = $2`, [src.id, label])).rows[0]!;
  const prov = (await tx.query<{ id: string }>(
    `INSERT INTO provisions (source_version_id, ref, excerpt) VALUES ($1,$2,$3) ON CONFLICT (source_version_id, ref) DO NOTHING RETURNING id`,
    [sv.id, c.article_ref ? `Madde ${c.article_ref}` : 'Tümü', (c.new_text ?? c.old_text ?? c.doc_title).slice(0, 6000)])).rows[0] ?? (await tx.query<{ id: string }>(`SELECT id FROM provisions WHERE source_version_id = $1 AND ref = $2`, [sv.id, c.article_ref ? `Madde ${c.article_ref}` : 'Tümü'])).rows[0]!;
  return prov.id;
}

/** An author turns the proposal into a real rule version and sends it to review (existing area review + reviewer approval follow). */
export async function prepareDraft(tx: Tx, p: Principal, id: string) {
  if (!has(p, 'rule_author')) throw forbidden('Kural taslağını yalnızca kural yazarı hazırlar.');
  const c = await loadChange(tx, id, true);
  if (c.status !== 'pending') throw conflict('INVALID_STATE', 'Bu kayıt için taslak zaten hazırlanmış ya da kayıt kapanmış.');
  if (c.date_status === 'unclear') throw conflict('DATE_UNCLEAR', 'Yürürlük tarihi belirsiz: önce bir yönetici tarihi çözmeli.');
  if (!c.proposal) throw conflict('NO_PROPOSAL', 'Önce önerilen kural değişikliğini yaz.');
  const prov = await upsertProvision(tx, c);
  const proposal = { ...c.proposal, provisionIds: [prov], isExample: !!c.proposal.isExample || c.is_example };
  const rv = await insertDraft(tx, p.userId, proposal);
  await tx.query(`UPDATE rule_versions SET status = 'in_review' WHERE id = $1`, [rv.id]);
  await tx.query(`UPDATE legislation_changes SET status = 'drafted', rule_version_id = $2, drafted_by = $3, drafted_at = now() WHERE id = $1`, [id, rv.id, p.userId]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.drafted', entityType: 'legislation_change', entityId: id, payload: { ruleCode: proposal.code, ruleVersion: rv.version, ruleVersionId: rv.id } });
  return { ruleVersionId: rv.id, version: rv.version };
}

export async function reject(tx: Tx, p: Principal, id: string, reason: string | null | undefined) {
  if (!has(p, 'rule_reviewer') && !has(p, 'platform_admin')) throw forbidden('Reddetme yetkin yok.');
  const why = needReason(reason, 'Öneriyi reddetmek');
  const c = await loadChange(tx, id, true);
  if (!['pending', 'drafted'].includes(c.status)) throw conflict('INVALID_STATE', `Kayıt ${c.status} durumunda; reddedilemez.`);
  if (c.rule_version_id) await tx.query(`UPDATE rule_versions SET status = 'draft' WHERE id = $1 AND status = 'in_review'`, [c.rule_version_id]);
  await tx.query(`UPDATE legislation_changes SET status = 'rejected', rejected_by = $2, rejected_at = now(), reject_reason = $3 WHERE id = $1`, [id, p.userId, why]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.rejected', entityType: 'legislation_change', entityId: id, payload: { docRef: c.doc_ref, article: c.article_ref, reason: why, ruleVersionId: c.rule_version_id } });
}

/**
 * Reviewer approval (with a reason) of the prepared rule version. Needs a known date and a source. A date in the past
 * applies at once; a future date waits for that day (applyDue).
 */
export async function approveChange(tx: Tx, p: Principal, id: string, reason: string | null | undefined, cfg: Pick<LegislationConfig, 'allowExampleRules'>, now = new Date()) {
  if (!has(p, 'rule_reviewer')) throw forbidden('Onay yalnızca kural inceleyicisi tarafından verilebilir.');
  const why = needReason(reason, 'Değişikliği onaylamak');
  const c = await loadChange(tx, id, true);
  if (c.status !== 'drafted' || !c.rule_version_id) throw conflict('INVALID_STATE', 'Onay için önce kural taslağı hazırlanmış olmalı.');
  if (c.date_status !== 'known' || !c.effective_from) throw conflict('DATE_UNCLEAR', 'Yürürlük tarihi belirsiz: tarih çözülene kadar onaylanamaz ve uygulanamaz.');
  if (!c.source_url) throw conflict('NO_SOURCE', 'Resmî kaynak bağlantısı olmadan onaylanamaz.');
  const rv = (await tx.query(`SELECT effective_from, effective_to, is_example FROM rule_versions WHERE id = $1`, [c.rule_version_id])).rows[0];
  if (c.is_example && !cfg.allowExampleRules) throw forbidden('Örnek/sentetik kaynaklı kural yalnızca demo ortamında onaylanıp yayımlanabilir.');
  await approveRuleVersion(tx, p, c.rule_version_id, why);
  const eff = String(c.effective_from).slice(0, 10);
  // A repeal takes effect on the day after the old version's last day; its rule version carries that last day.
  const apply = c.change_type === 'repeal' && rv.effective_to ? addDays(String(rv.effective_to).slice(0, 10), 1) : eff;
  await tx.query(`UPDATE legislation_changes SET status = 'scheduled', approved_by = $2, approved_at = now(), approve_reason = $3, apply_on = $4 WHERE id = $1`, [id, p.userId, why, apply]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.approved', entityType: 'legislation_change', entityId: id,
    payload: { docRef: c.doc_ref, article: c.article_ref, sourceUrl: c.source_url, reason: why, applyOn: apply, ruleVersionId: c.rule_version_id, example: c.is_example } });
  const today = istanbulDay(now);
  if (apply <= today) return { status: 'applied' as const, applyOn: apply, result: await applyChange(tx, id, cfg, now) };
  return { status: 'scheduled' as const, applyOn: apply, result: null };
}

// ───────────── Application ─────────────

const NOTIFY_ROLES = `role IN ('owner','hq_manager','site_manager')`;

/** Applies one scheduled change. Idempotent: only a `scheduled` row whose day has come is applied, under a row lock. */
export async function applyChange(tx: Tx, id: string, cfg: Pick<LegislationConfig, 'allowExampleRules'>, now = new Date()) {
  const c = await loadChange(tx, id, true);
  const today = istanbulDay(now);
  if (c.status !== 'scheduled' || !c.apply_on || String(c.apply_on).slice(0, 10) > today) return null;
  const spec = await specFromRuleVersion(tx, c.rule_version_id);
  // Scope is decided BEFORE publishing, from the current state: which sites the new version touches.
  const impact = await previewImpact(tx, spec, today);
  const rvRow = await publishVersion(tx, c.approved_by, c.rule_version_id, { allowExampleRules: cfg.allowExampleRules, reason: c.approve_reason,
    extra: { viaLegislationChange: id, docRef: c.doc_ref, scheduledFor: String(c.apply_on).slice(0, 10) } });
  const sitesDone: any[] = [];
  let tasksCreated = 0, notified = 0, cancelled = 0, missed = 0;
  for (const s of impact.sites) {
    const prev = (await currentObligations(tx, s.companyId, s.siteId)).find(o => o.rule_id === rvRow.rule_id);
    const before = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.site_id = $1 AND tt.rule_version_id = $2`, [s.siteId, rvRow.id])).rows[0]!.n;
    await recomputeSite(tx, s.companyId, s.siteId, c.approved_by, now, null, today);
    await topUpSite(tx, s.companyId, s.siteId, 14, c.approved_by, now);
    const after = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.site_id = $1 AND tt.rule_version_id = $2`, [s.siteId, rvRow.id])).rows[0]!.n;
    const now_ = (await currentObligations(tx, s.companyId, s.siteId)).find(o => o.rule_id === rvRow.rule_id);
    let cx = 0, ms = 0;
    if (prev) {
      cx = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE obligation_id = $1 AND status = 'cancelled'`, [prev.id])).rows[0]!.n;
      ms = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE obligation_id = $1 AND status = 'missed'`, [prev.id])).rows[0]!.n;
    }
    let nn = 0;
    if (s.notify) {
      const recipients = (await tx.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM memberships WHERE company_id = $1 AND status = 'active' AND ${NOTIFY_ROLES} AND (site_id IS NULL OR site_id = $2)`, [s.companyId, s.siteId])).rows.map(r => r.user_id);
      nn = await notify(tx, {
        companyId: s.companyId, siteId: s.siteId, userIds: recipients, kind: 'legislation_change', entityType: 'legislation_change', entityId: id, dedupeKey: `legislation:${id}:${s.siteId}`,
        title: `${c.is_example ? 'ÖRNEK · ' : ''}Mevzuat değişti: ${spec.obligationTitle}`,
        body: s.effect === 'ended' ? `${c.doc_ref} · ${trDate(String(c.apply_on).slice(0, 10))} itibarıyla bu yükümlülük sona erdi. Neler değişti için dokun.`
          : `${c.doc_ref} · ${trDate(String(c.apply_on).slice(0, 10))} itibarıyla ${s.site} şubende uygulanıyor. Ne yapman gerektiği için dokun.`,
      });
    }
    notified += nn; tasksCreated += after - before; cancelled += cx; missed += ms;
    sitesDone.push({ companyId: s.companyId, company: s.company, siteId: s.siteId, site: s.site, from: s.from, to: now_?.decision ?? s.to, effect: s.effect, tasksCreated: after - before, openCancelled: cx, openMissed: ms, notified: nn, obligationId: now_?.id ?? null });
  }
  const result = { ruleCode: spec.ruleCode, ruleVersion: rvRow.version, sites: sitesDone, outOfScopeSites: impact.outOfScopeSites, tasksCreated, notified, openCancelled: cancelled, openMissed: missed };
  await tx.query(`UPDATE legislation_changes SET status = 'applied', applied_at = now(), apply_result = $2 WHERE id = $1`, [id, JSON.stringify(result)]);
  await appendAudit(tx, { companyId: null, actorId: c.approved_by, eventType: 'legislation.applied', entityType: 'legislation_change', entityId: id,
    payload: { docRef: c.doc_ref, article: c.article_ref, ruleCode: spec.ruleCode, ruleVersion: rvRow.version, applyOn: String(c.apply_on).slice(0, 10), approvedBy: c.approved_by, reason: c.approve_reason, summary: { sites: sitesDone.length, tasksCreated, notified, openCancelled: cancelled, openMissed: missed } } });
  for (const companyId of [...new Set(sitesDone.map(s => s.companyId))]) {
    await appendAudit(tx, { companyId, actorId: c.approved_by, eventType: 'legislation.applied_to_company', entityType: 'legislation_change', entityId: id,
      payload: { docRef: c.doc_ref, ruleCode: spec.ruleCode, ruleVersion: rvRow.version, sourceUrl: c.source_url, reason: c.approve_reason, sites: sitesDone.filter(s => s.companyId === companyId).map(({ company: _c, ...s }) => s) } });
  }
  return result;
}

/** Applies every scheduled change whose day has come (safe to run repeatedly and concurrently: each change is locked and applied once). */
export async function applyDue(db: Db, cfg: Pick<LegislationConfig, 'allowExampleRules'>, now = new Date()) {
  const today = istanbulDay(now);
  const ids = await db.system(async tx => (await tx.query<{ id: string }>(`SELECT id FROM legislation_changes WHERE status = 'scheduled' AND apply_on <= $1 ORDER BY apply_on, detected_at`, [today])).rows.map(r => r.id));
  const applied: string[] = [], failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try { const r = await db.system(tx => applyChange(tx, id, cfg, now)); if (r) applied.push(id); } catch (e) { failed.push({ id, error: (e as Error).message }); }
  }
  return { applied, failed };
}

// ───────────── Scheduler ─────────────

/** One scheduler tick: apply what is due, then run the daily scan when its hour has come and today's has not succeeded (limited retries). */
export async function legislationTick(db: Db, cfg: LegislationConfig, now = new Date(), log: (l: Record<string, unknown>) => void = () => {}) {
  const out: Record<string, unknown> = {};
  out.apply = await applyDue(db, cfg, now);
  if ((out.apply as any).failed.length) log({ level: 'error', event: 'legislation_apply_failed', failed: (out.apply as any).failed });
  if (cfg.enabled) {
    const today = istanbulDay(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }).format(now));
    const due = await db.system(async tx => {
      if (hour < cfg.scanHour) return false;
      const okToday = (await tx.query(`SELECT 1 FROM legislation_scan_runs WHERE run_date = $1 AND trigger = 'schedule' AND status = 'ok'`, [today])).rowCount;
      if (okToday) return false;
      const attempts = (await tx.query<{ n: number; last: string | null }>(`SELECT count(*)::int AS n, max(started_at) AS last FROM legislation_scan_runs WHERE run_date = $1 AND trigger = 'schedule'`, [today])).rows[0]!;
      if (attempts.n >= 6) return false;
      return !attempts.last || Date.parse(attempts.last) < now.getTime() - 30 * 60_000;
    });
    if (due) { out.scan = await runScan(db, cfg, { trigger: 'schedule', now }); log({ level: 'info', event: 'legislation_scan', ...(out.scan as object) }); }
  }
  return out;
}

export function startLegislationScheduler(db: Db, cfg: LegislationConfig, log: (l: Record<string, unknown>) => void, everyMs = 10 * 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await legislationTick(db, cfg, new Date(), log); } catch (e) { log({ level: 'error', event: 'legislation_tick_failed', error: (e as Error).message }); } finally { running = false; }
  };
  setTimeout(() => void tick(), 30_000).unref();
  const t = setInterval(() => void tick(), everyMs);
  t.unref();
  return () => clearInterval(t);
}

// ───────────── Business view ─────────────

/** One screen for a business: what changed, why it applies to my site, what to do and by when, source and rule version. */
export async function businessView(tx: Tx, p: Principal, companyId: string, id: string) {
  const c = (await tx.query(`SELECT * FROM legislation_changes WHERE id = $1 AND status = 'applied'`, [id])).rows[0];
  if (!c) throw notFound('Mevzuat değişikliği');
  const mine: any[] = ((c.apply_result?.sites ?? []) as any[]).filter(s => s.companyId === companyId && can(p, 'obligation.read', { companyId, siteId: s.siteId }).ok);
  if (!mine.length) throw notFound('Mevzuat değişikliği');
  const rv = (await tx.query(`SELECT rv.id, rv.version, rv.kind, rv.is_example, rv.obligation_title, rv.obligation_summary, rv.effective_from, rv.effective_to, rv.required_facts, r.code FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE rv.id = $1`, [c.rule_version_id])).rows[0];
  const prevVersion = (await tx.query(`SELECT version FROM rule_versions WHERE rule_id = (SELECT rule_id FROM rule_versions WHERE id = $1) AND version < $2 ORDER BY version DESC LIMIT 1`, [rv.id, rv.version])).rows[0]?.version ?? null;
  const sites = [];
  for (const s of mine) {
    const ob = s.obligationId ? (await tx.query(`SELECT id, decision, reason, facts_snapshot, decided_at FROM obligations WHERE id = $1 AND company_id = $2`, [s.obligationId, companyId])).rows[0] : null;
    const facts = await currentFacts(tx, companyId, s.siteId);
    const matched = (rv.required_facts as string[]).filter(isFactKey).map(k => ({ key: k, label: FACTS[k].label, value: facts[k]?.value ?? null }));
    const tasks = (await tx.query(
      `SELECT t.id, t.status, t.due_at, tt.title FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
        WHERE t.site_id = $1 AND tt.rule_version_id = $2 AND t.status = 'open' ORDER BY t.due_at LIMIT 8`, [s.siteId, rv.id])).rows;
    sites.push({
      siteId: s.siteId, site: s.site, effect: s.effect, decision: ob?.decision ?? s.to, why: ob?.reason ?? null, matchedFacts: matched,
      tasks: tasks.map(t => ({ id: t.id, title: t.title, dueAt: t.due_at })), nextDue: tasks[0]?.due_at ?? null, tasksCreated: s.tasksCreated, openCancelled: s.openCancelled, openMissed: s.openMissed,
    });
  }
  const eff = String(c.apply_on).slice(0, 10);
  const ended = mine.every(s => s.effect === 'ended');
  return {
    id: c.id, isExample: c.is_example,
    what: {
      type: c.change_type, typeLabel: CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR], docRef: c.doc_ref, docTitle: c.doc_title, article: c.article_ref, effectiveFrom: eff,
      oldText: c.old_text, newText: c.new_text, summary: `${CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR]}: ${c.doc_title}. Yürürlük: ${trDate(eff)}.`,
    },
    sites,
    todo: {
      summary: ended ? 'Bu yükümlülük sona erdi: bu kural için yeni görev oluşmaz. Tamamlanmış görevlerin, ölçümlerin ve kanıtların eski kural sürümüyle birlikte saklanır.'
        : 'Aşağıdaki görevler yeni kural sürümünden oluştu. Her birinin gerekçesi ve son tarihi görev detayında yazar.',
      effectiveFrom: eff,
    },
    rule: { code: rv.code, version: rv.version, previousVersion: prevVersion, title: rv.obligation_title, summary: rv.obligation_summary, label: rv.is_example ? 'ÖRNEK KURAL — hukuki dayanağı doğrulanmadı' : rv.kind === 'good_practice' ? 'İyi uygulama önerisi — mevzuat hükmü değil' : 'Mevzuat yükümlülüğü' },
    source: { url: c.source_url, ref: c.doc_ref, publishedOn: c.published_on },
    approvedAt: c.approved_at, appliedAt: c.applied_at,
  };
}
