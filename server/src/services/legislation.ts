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
import { approve as approveRuleVersion, insertDraft, publishVersion, validateDraftInput, needReason, FREQUENCY_BASES, type DraftInput } from './rules';
import { plannedOccurrences } from './tasks';
import { topUpSite } from './tasks';
import {
  OFFICIAL_HOSTS, defaultFetcher, errorKindOf, istanbulDay, parseWatchList, scanConsolidated, scanGazette, trDate,
  type DetectedChange, type Fetcher, type ScanOutcome, type SourceCode, type WatchDoc,
  type PdfReader,
} from './legislation-sources';
import { readGazettePdf } from './filetext';

/*
 * Daily legislation watch → review queue → admin approval → scheduled application.
 *  - Detection only proposes. Nothing reaches a business before a reviewer approves with a reason.
 *  - Content that reaches businesses (conditions, tasks, periods) comes from the approved RULE VERSION, never from the detected text.
 *  - Applying uses the existing machinery: rule version publish, per-site re-evaluation, task generation, in-app notifications.
 */

export type LegislationConfig = {
  rgBase: string; mevzuatBase: string; watch: WatchDoc[]; lookbackDays: number; fetcher: Fetcher; allowExampleRules: boolean;
  sleep?: (ms: number) => Promise<void>; scanHour: number; enabled: boolean; readPdf?: PdfReader;
};
export function legislationConfig(env: Record<string, string | undefined> = process.env, over: Partial<LegislationConfig> = {}): LegislationConfig {
  return {
    rgBase: env.LEGISLATION_RG_BASE?.trim() || 'https://www.resmigazete.gov.tr',
    mevzuatBase: env.LEGISLATION_MEVZUAT_BASE?.trim() || 'https://www.mevzuat.gov.tr',
    watch: parseWatchList(env.LEGISLATION_MEVZUAT_WATCH), lookbackDays: Math.min(Math.max(Number(env.LEGISLATION_LOOKBACK_DAYS ?? 3) || 3, 0), 30),
    fetcher: defaultFetcher, readPdf: readGazettePdf, allowExampleRules: env.DEMO_MODE === 'true', scanHour: Number(env.LEGISLATION_SCAN_HOUR ?? 6),
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

export type SourceResult = { source: SourceCode; ok: boolean; seen: number; /** matched a supported sector */ selected: number; /** a person must classify */ uncertain: number; /** left out, with the reason */ skipped: { key: string; url: string; title: string; why: string }[]; /** text could not be read; retried by the next scan */ unreadable: { key: string; url: string; title: string; error: string }[]; docsRead: number; /** new candidates put in the approval queue (already known ones are not counted again) */ created: number; errors: string[]; errorKind: string | null; notes: string[] };

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
    const run = (await tx.query<{ id: string }>(`INSERT INTO legislation_scan_runs (trigger, actor_id, run_date, started_at) VALUES ($1,$2,$3,$4) RETURNING id`, [o.trigger, o.actorId ?? null, today, now])).rows[0]!;
    const prev = new Map<string, Record<string, string>>();
    for (const r of (await tx.query(`SELECT doc_key, articles FROM legislation_documents WHERE source_code = 'mevzuat'`)).rows) prev.set(r.doc_key, r.articles);
    const lastRgOk = (await tx.query<{ t: Date | null }>(`SELECT last_success_at AS t FROM legislation_sources WHERE code = 'resmi_gazete'`)).rows[0]?.t ?? null;
    // Days that could not be verified since the last healthy read stay inside the window until a scan reads them.
    const pending = (await tx.query<{ results: SourceResult[] | null }>(`SELECT results FROM legislation_scan_runs WHERE status IN ('partial','failed') AND ($1::timestamptz IS NULL OR started_at > $1) AND run_date >= $2::date - 30`, [lastRgOk, today])).rows;
    return { runId: run.id, prev, lastRgOk, oldestUnread: oldestUnverifiedDay(pending.flatMap(r => Array.isArray(r.results) ? r.results : [])) };
  });
  if (!start) return { skipped: 'already_running' as const };

  // Catch-up: the gazette window always reaches back to the last fully healthy read (machine off, process down, source outage),
  // never shorter than the configured look-back and never longer than 30 days.
  const gapDays = start.lastRgOk ? Math.ceil((now.getTime() - new Date(start.lastRgOk).getTime()) / 86_400_000) : 0;
  const unreadAge = start.oldestUnread ? Math.round((Date.parse(today) - Date.parse(start.oldestUnread)) / 86_400_000) : 0;
  const wanted = Math.max(cfg.lookbackDays, gapDays + 1, unreadAge);
  const lookbackDays = Math.min(wanted, 30);

  // Phase 2 (no transaction): network.
  const outcomes: Partial<Record<SourceCode, ScanOutcome>> = {};
  const thrown: Partial<Record<SourceCode, string>> = {};
  try {
    outcomes.resmi_gazete = await scanGazette({ baseUrl: cfg.rgBase, today, lookbackDays, fetcher: cfg.fetcher, readPdf: cfg.readPdf, sleep: cfg.sleep });
    if (lookbackDays > cfg.lookbackDays) outcomes.resmi_gazete.notes.push(start.oldestUnread && unreadAge >= lookbackDays ? `${start.oldestUnread} gününden kalan okunamamış yayın için ${lookbackDays + 1} günlük pencere okundu.` : `Kaçırılan aralık telafi edildi: son sağlıklı okumadan ${gapDays} gün geçmişti, ${lookbackDays + 1} günlük pencere okundu.`);
    if (wanted > 30) outcomes.resmi_gazete.notes.push(`UYARI: ${Math.max(gapDays, unreadAge)} gün geriye gitmek gerekiyor; pencere en çok 30 gün okunur, daha eski günler Resmî Gazete'den elle kontrol edilmeli.`);
  } catch (e) { thrown.resmi_gazete = (e as Error).message; }
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
      const errorKind = errors.length ? (errors.map(e => errorKindOf(e.slice(Math.max(e.indexOf('['), 0)))).find(Boolean) ?? 'unknown') : null;
      await tx.query(
        `UPDATE legislation_sources SET last_attempt_at = now(), last_items_seen = CASE WHEN $3 THEN $2 ELSE last_items_seen END,
           last_success_at = CASE WHEN $3 THEN now() ELSE last_success_at END,
           last_error_kind = CASE WHEN $3 THEN NULL ELSE $5 END, last_docs_read = CASE WHEN $3 THEN $6 ELSE last_docs_read END,
           last_error = CASE WHEN $3 THEN NULL ELSE $4 END, last_error_at = CASE WHEN $3 THEN last_error_at ELSE now() END,
           failures_in_row = CASE WHEN $3 THEN 0 ELSE failures_in_row + 1 END WHERE code = $1`,
        [code, out?.seen ?? 0, ok, errors.join(' | ').slice(0, 1500), errorKind, out?.docsRead ?? 0]);
      results.push({ source: code, ok, seen: out?.seen ?? 0, selected: out?.selected ?? 0, uncertain: out?.uncertain ?? 0, skipped: (out?.skipped ?? []).slice(0, 800), unreadable: (out?.unreadable ?? []).slice(0, 200), docsRead: out?.docsRead ?? 0, created, errors, errorKind, notes: out?.notes ?? [], ...(out?.awaitingToday ? { awaitingToday: true } : {}) });
    }
    const status = results.every(r => r.ok) ? 'ok' : results.some(r => r.ok) ? 'partial' : 'failed';
    await tx.query(`UPDATE legislation_scan_runs SET finished_at = now(), status = $2, results = $3 WHERE id = $1`, [start.runId, status, JSON.stringify(results)]);
    await appendAudit(tx, { companyId: null, actorId: o.actorId ?? null, eventType: 'legislation.scanned', entityType: 'legislation_scan', entityId: start.runId,
      payload: { trigger: o.trigger, status, results: results.map(r => ({ source: r.source, ok: r.ok, seen: r.seen, selected: r.selected, uncertain: r.uncertain, skipped: r.skipped.length, unreadable: r.unreadable.length, docsRead: r.docsRead, created: r.created, errorKind: r.errorKind, errors: r.errors.slice(0, 3) })) } });
    return { runId: start.runId, status, results };
  });
}

/** The earliest publication day that some recorded run could not read (a day list, or one publication). */
export function oldestUnverifiedDay(results: { source?: string; code?: string; errors?: string[]; unreadable?: { key: string }[] }[]): string | null {
  const days = results.flatMap(r => [
    ...(r.errors ?? []).map(e => /^(\d{4}-\d{2}-\d{2}):/.exec(e)?.[1]),
    ...(r.unreadable ?? []).map(u => { const m = /^rg:(?:ilan-)?(\d{4})(\d{2})(\d{2})/.exec(u.key); return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined; }),
  ]).filter((d): d is string => !!d).sort();
  return days[0] ?? null;
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

/** Next planned daily run (Europe/Istanbul is a fixed UTC+3). Null when the scheduler is off. Only a successful SCHEDULED run counts for the day (a manual scan does not skip it). */
/**
 * Retry policy for the daily scan when a day's run did not finish cleanly (a publication could not be read, the source was down):
 * wait 30 min, 1 h, 2 h, 4 h between attempts, at most 5 attempts a day. Healthy publications are processed in every attempt (keys make that idempotent);
 * an unreadable one is queued ONCE, in the attempt where it first becomes readable. The next attempt time is shown to the administrator.
 */
export const RETRY_BASE_MIN = 30; export const RETRY_MAX_ATTEMPTS = 5;
export function retryPlan(attempts: number, lastStartedAt: Date | null, now: Date): { due: boolean; nextAttemptAt: string | null; exhausted: boolean } {
  if (attempts === 0 || !lastStartedAt) return { due: true, nextAttemptAt: null, exhausted: false };
  if (attempts >= RETRY_MAX_ATTEMPTS) return { due: false, nextAttemptAt: null, exhausted: true };
  const at = new Date(lastStartedAt.getTime() + RETRY_BASE_MIN * 60_000 * 2 ** (attempts - 1));
  return { due: at.getTime() <= now.getTime(), nextAttemptAt: at.toISOString(), exhausted: false };
}

export function nextScheduledRun(cfg: LegislationConfig | undefined, scheduledOkToday: boolean, now = new Date()): string | null {
  if (!cfg?.enabled) return null;
  const OFFSET = 3 * 3_600_000;
  const local = new Date(now.getTime() + OFFSET);
  let slot = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), cfg.scanHour) - OFFSET;
  if (scheduledOkToday) slot += 24 * 3_600_000;                        // today's scheduled run is done → tomorrow's slot
  else if (now.getTime() > slot) return now.toISOString();            // slot passed, not done: due at the next tick
  return new Date(slot).toISOString();
}

/** Days (Istanbul, before today) since the first successful scheduled run on which NO scheduled run succeeded, e.g. the machine/Docker was off at 06:00. */
export function missedScheduledDays(okDays: string[], today: string): string[] {
  if (!okDays.length) return [];
  const have = new Set(okDays);
  const out: string[] = [];
  for (let t = Date.parse([...have].sort()[0]! + 'T00:00:00Z'); t < Date.parse(today + 'T00:00:00Z'); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!have.has(d)) out.push(d);
  }
  return out;
}

export async function adminOverview(tx: Tx, p: Principal, cfg?: LegislationConfig) {
  if (!canView(p)) throw forbidden();
  if (cfg) await ensureSources(tx, cfg);
  const sources = (await tx.query(`SELECT code, name, base_url, is_example, enabled, last_attempt_at, last_success_at, last_error, last_error_at, last_error_kind, failures_in_row, last_items_seen, last_docs_read,
      (SELECT count(*)::int FROM legislation_changes c WHERE c.source_code = legislation_sources.code) AS queue_total,
      (SELECT count(*)::int FROM legislation_changes c WHERE c.source_code = legislation_sources.code AND c.status IN ('pending','drafted')) AS queue_open
      FROM legislation_sources ORDER BY code`)).rows;
  const counts = Object.fromEntries((await tx.query(`SELECT status, count(*)::int AS n FROM legislation_changes GROUP BY status`)).rows.map(r => [r.status, r.n]));
  const lastOk = (await tx.query(`SELECT finished_at, trigger FROM legislation_scan_runs WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`)).rows[0] ?? null;
  const lastRun = (await tx.query(`SELECT id, trigger, status, started_at, finished_at, results FROM legislation_scan_runs ORDER BY started_at DESC LIMIT 1`)).rows[0] ?? null;
  const unclear = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM legislation_changes WHERE status IN ('pending','drafted') AND date_status = 'unclear'`)).rows[0]!.n;
  // Publications the scan left OUT of the queue (no supported sector in title or text). They never reach the queue, so this list is the only place a person can notice a missed one.
  type Seen = { key: string; url: string | null; title: string; status: 'out_of_scope' | 'unreadable'; why: string; firstDay: string; lastDay: string; scans: number };
  const skippedMap = new Map<string, Seen>();
  for (const r of (await tx.query<{ run_date: string; results: SourceResult[] | null }>(`SELECT to_char(run_date, 'YYYY-MM-DD') AS run_date, results FROM legislation_scan_runs WHERE started_at > now() - interval '14 days' AND status IN ('ok','partial','failed') ORDER BY started_at`)).rows) {
    for (const res of Array.isArray(r.results) ? r.results : []) {
      const add = (k: { key?: string; url?: string; title: string }, status: Seen['status'], why: string) => {
        const id = `${k.key ?? k.title}`.replace(/\.pdf$/i, ''); const e = skippedMap.get(id);
        if (e) { e.lastDay = r.run_date; e.scans += 1; e.status = status; e.why = why; } else skippedMap.set(id, { key: k.key ?? k.title, url: k.url ?? null, title: k.title, status, why, firstDay: r.run_date, lastDay: r.run_date, scans: 1 });
      };
      for (const k of res.skipped ?? []) add(k, 'out_of_scope', k.why);
      for (const k of res.unreadable ?? []) add(k, 'unreadable', `Metni okunamadı: ${k.error}. Sonraki taramada yeniden denenir; okunana kadar sınıflandırılamaz.`);
    }
  }
  // A publication that has since been read and queued is no longer "unreadable" or "left out".
  const queued = new Set((await tx.query<{ k: string }>(`SELECT external_key AS k FROM legislation_changes WHERE external_key = ANY($1::text[])`, [[...skippedMap.keys()]])).rows.map(r => r.k));
  const recentSkipped = [...skippedMap].filter(([id]) => !queued.has(id)).map(([, e]) => e).sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.key.localeCompare(b.key)).slice(0, 100);
  const okDays = (await tx.query<{ d: string }>(`SELECT DISTINCT to_char(run_date, 'YYYY-MM-DD') AS d FROM legislation_scan_runs WHERE trigger = 'schedule' AND status = 'ok'`)).rows.map(r => r.d);
  const schedOkToday = ((await tx.query(`SELECT 1 FROM legislation_scan_runs WHERE run_date = $1 AND ${SCHEDULE_DONE}`, [istanbulDay()])).rowCount ?? 0) > 0;
  const retry = await retryInfo(tx, cfg);
  return {
    sources, lastSuccessfulScan: lastOk, lastRun, recentSkipped,
    pendingReview: (counts.pending ?? 0) + (counts.drafted ?? 0), counts: { pending: counts.pending ?? 0, drafted: counts.drafted ?? 0, scheduled: counts.scheduled ?? 0, applied: counts.applied ?? 0, rejected: counts.rejected ?? 0 },
    unclearDates: unclear,
    schedule: { retry, enabled: cfg?.enabled ?? false, timezone: 'Europe/Istanbul', dailyAtHour: cfg?.scanHour ?? 6, nextRunAt: nextScheduledRun(cfg, schedOkToday || !!retry?.exhausted), missedDays: cfg?.enabled ? missedScheduledDays(okDays, istanbulDay()) : [] },
    baselineNote: 'İlk okuma yalnız TABAN kaydeder: o gün mevcut metinler "değişiklik" sayılmaz, kuyruğa kayıt düşmez. Kuyruğa yalnız sonraki okumalardaki farklar ve yeni yayınlar girer.',
    canScan: has(p, 'platform_admin') || has(p, 'rule_reviewer'),
    exampleNote: 'Örnek/sentetik kaynaktan gelen kayıtlar ÖRNEKTİR; gerçek veya uzman onaylı mevzuat olarak yayımlanamaz.',
  };
}

async function retryInfo(tx: Tx, cfg?: LegislationConfig) {
  if (!cfg?.enabled) return null;
  const today = istanbulDay();
  const okToday = ((await tx.query(`SELECT 1 FROM legislation_scan_runs WHERE run_date = $1 AND ${SCHEDULE_DONE}`, [today])).rowCount ?? 0) > 0;
  if (okToday) return null;
  const a = (await tx.query<{ n: number; last: Date | null; res: any }>(`SELECT count(*)::int AS n, max(started_at) AS last, (array_agg(results ORDER BY started_at DESC))[1] AS res FROM legislation_scan_runs WHERE run_date = $1 AND trigger = 'schedule'`, [today])).rows[0]!;
  if (!a.n) return null;
  const plan = retryPlan(a.n, a.last ? new Date(a.last) : null, new Date());
  const errs = (Array.isArray(a.res) ? a.res : []).flatMap((r: any) => [...(r.errors ?? []), ...(r.error ? [r.error] : [])]).slice(0, 3);
  const awaitingToday = errs.length === 0 && (Array.isArray(a.res) ? a.res : []).some((r: any) => r.awaitingToday);
  return { attempts: a.n, awaitingToday, maxAttempts: RETRY_MAX_ATTEMPTS, nextAttemptAt: plan.nextAttemptAt, exhausted: plan.exhausted, lastErrors: errs };
}

export type ChangeFilter = { status?: string; source?: string; area?: string; q?: string; dateStatus?: 'known' | 'unclear'; effectiveFrom?: string; effectiveTo?: string; reviewer?: string; assignee?: string; waiting?: boolean; match?: 'uncertain' };

/** Review queue with the filters the desk needs: source, sector, status, effective-date window, free text and the person who drafted or decided. */
export async function listChanges(tx: Tx, p: Principal, f: ChangeFilter | string = {}) {
  if (!canView(p)) throw forbidden();
  const q: ChangeFilter = typeof f === 'string' ? { status: f } : f;
  const rows = (await tx.query(
    `SELECT c.id, c.source_code, c.change_type, c.scope_area, c.doc_ref, c.doc_title, c.article_ref, c.published_on, c.effective_from, c.date_status, c.status, c.is_example, c.apply_on, c.detected_at,
            c.rule_version_id, (c.proposal IS NOT NULL) AS has_proposal, c.drafted_by, c.approved_by, c.rejected_by,
            c.suggestion->>'matchLevel' AS match_level, c.suggestion->'sectors' AS sectors, c.suggestion->'bodySectors' AS body_sectors,
            c.assigned_to, c.assigned_at, au.display_name AS assignee_name, c.proposal->'requiredReviewAreas' AS proposal_areas
       FROM legislation_changes c LEFT JOIN users au ON au.id = c.assigned_to
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::text IS NULL OR c.source_code = $2)
        AND ($3::text IS NULL OR c.scope_area = $3)
        AND ($4::text IS NULL OR c.doc_ref ILIKE '%' || $4 || '%' OR c.doc_title ILIKE '%' || $4 || '%' OR COALESCE(c.article_ref, '') ILIKE '%' || $4 || '%')
        AND ($5::text IS NULL OR c.date_status = $5)
        AND ($6::date IS NULL OR c.effective_from >= $6)
        AND ($7::date IS NULL OR c.effective_from <= $7)
        AND ($8::uuid IS NULL OR c.drafted_by = $8 OR c.approved_by = $8 OR c.rejected_by = $8)
        AND ($9::uuid IS NULL OR c.assigned_to = $9)
        AND ($10::text IS NULL OR c.suggestion->>'matchLevel' = $10)
      ORDER BY c.detected_at DESC, c.id LIMIT 200`,
    [q.status ?? null, q.source ?? null, q.area ?? null, q.q?.trim() || null, q.dateStatus ?? null, q.effectiveFrom ?? null, q.effectiveTo ?? null, q.reviewer ?? null, q.assignee === 'me' ? p.userId : q.assignee ?? null, q.match ?? null])).rows;
  const out = [];
  for (const r of rows) {
    let waiting: string | null = null; let areas: string[] = [];
    // Dosya ataması ayrı bir şeydir: sıradaki adım karar zincirinde kimin beklendiğini söyler.
    let next: 'author' | 'area' | 'approver' | null = r.status === 'pending' ? 'author' : null;
    if (r.status === 'drafted' && r.rule_version_id) areas = (await tx.query<{ required_review_areas: string[] }>(`SELECT required_review_areas FROM rule_versions WHERE id = $1`, [r.rule_version_id])).rows[0]?.required_review_areas ?? [];
    else if (r.status === 'pending') areas = (r.proposal_areas as string[] | null) ?? [...new Set([...(r.sectors ?? []), ...(r.body_sectors ?? [])].map((k: string) => AREA_BY_SECTOR[k]?.area).filter(Boolean) as string[])];
    if (areas.length && ['pending', 'drafted'].includes(r.status)) {
      const none = (await areaCoverage(tx, areas)).filter(x => x.reviewers === 0).map(x => x.area);
      if (none.length) waiting = `Bekliyor: "${none.join(', ')}" alanında tanımlı inceleyici yok.`;
    }
    if (r.status === 'drafted') {
      const ok = new Set(r.rule_version_id ? (await tx.query<{ area: string; decision: string }>(`SELECT DISTINCT ON (area) area, decision FROM rule_area_reviews WHERE rule_version_id = $1 ORDER BY area, created_at DESC`, [r.rule_version_id])).rows.filter(x => x.decision === 'approved').map(x => x.area) : []);
      next = areas.some(a => !ok.has(a)) ? 'area' : 'approver';
    }
    if (q.waiting && !waiting) continue;
    const { proposal_areas: _pa, ...rest } = r;
    out.push({ ...rest, review_areas: areas, waiting_reason: waiting, next_step: next, typeLabel: CHANGE_TYPE_TR[r.change_type as keyof typeof CHANGE_TYPE_TR] });
  }
  return out;
}

// ───────────── Assignment, return ─────────────

/** Who could review this record: platform reviewers, with the areas they cover and whether that covers what the record needs. Granting nothing. */
export async function assigneeCandidates(tx: Tx, p: Principal, id: string) {
  if (!canView(p)) throw forbidden();
  const c = await loadChange(tx, id);
  const need: string[] = c.rule_version_id ? (await tx.query<{ r: string[] }>(`SELECT required_review_areas AS r FROM rule_versions WHERE id = $1`, [c.rule_version_id])).rows[0]?.r ?? [] : c.proposal?.requiredReviewAreas ?? [];
  const rows = (await tx.query<{ id: string; name: string; email: string | null; areas: string[] }>(
    `SELECT u.id, u.display_name AS name, u.email, COALESCE((SELECT array_agg(a.area ORDER BY a.area) FROM reviewer_areas a WHERE a.user_id = u.id), '{}') AS areas
       FROM users u JOIN platform_roles r ON r.user_id = u.id AND r.role = 'rule_reviewer' ORDER BY u.display_name`)).rows;
  return { needAreas: need, assignedTo: c.assigned_to as string | null, candidates: rows.map(r => ({ ...r, covers: need.filter(a => r.areas.includes(a)), eligible: need.length === 0 ? false : need.some(a => r.areas.includes(a)) })),
    note: need.length === 0 ? 'Önce kayıt için inceleme alanı seçilmeli; alan seçilmeden uygun inceleyici belirlenemez.' : null };
}

/** Assigns the FILE to a person. Never changes anyone's role or area: the person must already be a platform reviewer covering one of the needed areas. */
export async function assignChange(tx: Tx, p: Principal, id: string, b: { userId: string | null; reason: string }) {
  if (!has(p, 'platform_admin')) throw forbidden('Atamayı yalnız platform yöneticisi yapar.');
  const c = await loadChange(tx, id, true);
  if (!['pending', 'drafted'].includes(c.status)) throw conflict('INVALID_STATE', `Kayıt ${c.status} durumunda; atama yapılamaz.`);
  const why = (b.reason ?? '').trim(); if (why.length < 5) throw invalid('Atama gerekçesini yaz (en az 5 karakter).');
  let name: string | null = null; let areas: string[] = [];
  if (b.userId) {
    const cand = await assigneeCandidates(tx, p, id);
    const u = cand.candidates.find(x => x.id === b.userId);
    if (!u) throw conflict('NOT_A_REVIEWER', 'Bu kişi platform inceleyicisi değil. Dosya atamak rol vermez; rol ayrı bir işlemdir.');
    if (!u.eligible) throw conflict('AREA_NOT_COVERED', cand.needAreas.length ? `Bu kişi kaydın alanlarından hiçbirinde (${cand.needAreas.join(', ')}) yetkili değil. Alan yetkisi ayrı bir işlemdir; dosya atamak onu vermez.` : 'Önce inceleme alanı seçilmeli.');
    name = u.name; areas = u.covers;
  }
  await tx.query(`UPDATE legislation_changes SET assigned_to = $2, assigned_by = $3, assigned_at = now(), assign_note = $4 WHERE id = $1`, [id, b.userId, p.userId, why]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: b.userId ? 'legislation.assigned' : 'legislation.unassigned', entityType: 'legislation_change', entityId: id,
    payload: { assigneeId: b.userId, assigneeName: name, coveredAreas: areas, previousAssignee: c.assigned_to, reason: why, docRef: c.doc_ref } });
  return { assignedTo: b.userId };
}

/** Sends a prepared draft back to the proposal stage with a reason. The draft rule version stays as a draft (history), nothing reaches a business. */
export async function returnChange(tx: Tx, p: Principal, id: string, reason: string | null | undefined) {
  if (!has(p, 'rule_reviewer') && !has(p, 'platform_admin')) throw forbidden('İade yetkin yok.');
  const c = await loadChange(tx, id, true);
  if (c.status !== 'drafted') throw conflict('INVALID_STATE', 'İade yalnız hazırlanmış taslak için yapılır.');
  const why = needReason(reason, 'İade');
  if (c.rule_version_id) await tx.query(`UPDATE rule_versions SET status = 'draft' WHERE id = $1 AND status = 'in_review'`, [c.rule_version_id]);
  await tx.query(`UPDATE legislation_changes SET status = 'pending', rule_version_id = NULL, drafted_by = NULL, drafted_at = NULL WHERE id = $1`, [id]);
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.returned', entityType: 'legislation_change', entityId: id, payload: { docRef: c.doc_ref, reason: why, returnedRuleVersionId: c.rule_version_id } });
  return { status: 'pending' };
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
  const outSample: { company: string; site: string; reason: string }[] = [];
  let outOfScope = 0;
  for (const s of sites) {
    const prev = prevBySite.get(s.id);
    const facts = await currentFacts(tx, s.company_id, s.id);
    const next = nextDecision(spec, facts, onDate);
    const prevIn = !!prev && IN_SCOPE.has(prev.decision);
    const nextIn = IN_SCOPE.has(next.decision);
    const versionChange = !!prev && !!spec.ruleVersionId && prev.rule_version_id !== spec.ruleVersionId;
    const ended = prevIn && next.decision === 'not_applicable';
    if (!nextIn && !ended) { outOfScope++; if (outSample.length < 6) outSample.push({ company: s.company, site: s.name, reason: next.reason }); continue; }
    const open = prev ? openBy.get(prev.id) ?? 0 : 0;
    const effect = ended ? 'ended' : next.decision === 'needs_info' ? 'needs_info' : prev?.decision === 'applies' && next.decision === 'applies' ? (versionChange || !spec.ruleVersionId ? 'version_change' : 'unchanged') : 'new_obligation';
    if (effect === 'unchanged') { outOfScope++; continue; }
    out.push({
      companyId: s.company_id, company: s.company, siteId: s.id, site: s.name, from: prev?.decision ?? null, to: next.decision, effect, reason: next.reason, missingFacts: next.missing, missingQuestions: next.missing.map(k => ({ key: k, label: (FACTS as Record<string, { label: string }>)[k]?.label ?? k })),
      openTasks: open,
      openTaskEffect: ended ? `${open} açık görev kapanır (süresi geçmişse "kaçırıldı", ilerideyse "iptal"); tamamlanmış görev, ölçüm ve kanıtlar eski kural sürümüne bağlı kalır.`
        : effect === 'version_change' ? `${open} açık görev kalır, "kural sürümü değişti" işaretiyle kontrol edilir; yeni görevler yeni sürümden üretilir.` : effect === 'new_obligation' ? 'Yeni yükümlülük; görevler yeni sürümden üretilir.' : 'Profil bilgisi eksik; görev üretilmez, bilgi istenir.',
      notify: next.decision === 'applies' || next.decision === 'needs_review' || ended,
    });
  }
  return { onDate, sites: out, affectedSites: out.length, notifiedSites: out.filter(x => x.notify).length, outOfScopeSites: outOfScope, outOfScopeSample: outSample, openTasksAffected: out.reduce((a, x) => a + (x.effect === 'ended' || x.effect === 'version_change' ? x.openTasks : 0), 0) };
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


// ───────────── Frequency and review areas of a proposed rule ─────────────

const FREQ_WORDS: { re: RegExp; freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once' }[] = [
  { re: /her\s+g[üu]n|g[üu]nl[üu]k|g[üu]nde\s+bir/i, freq: 'daily' }, { re: /her\s+hafta|haftal[ıi]k|haftada\s+bir/i, freq: 'weekly' },
  { re: /her\s+ay(?![a-zçğıöşü])|ayl[ıi]k|ayda\s+bir/i, freq: 'monthly' }, { re: /her\s+y[ıi]l|y[ıi]ll[ıi]k|y[ıi]lda\s+bir/i, freq: 'yearly' },
  { re: /bir\s+kez|tek\s+seferlik|bir\s+defa/i, freq: 'once' },
];
/** Does the source text itself say how often? Only a hint with the sentence it came from: the administrator decides. `yearly` is not a frequency the system supports. */
export function sourceFrequencyHint(text: string | null | undefined): { freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once'; quote: string; supported: boolean } | null {
  for (const sentence of (text ?? '').split(/(?<=[.;])\s+|\s*MADDE\s+\d+\s*[–-]\s*/)) for (const w of FREQ_WORDS) {
    const m = w.re.exec(sentence); if (m) return { freq: w.freq, quote: sentence.trim().slice(0, 240), supported: w.freq !== 'yearly' };
  }
  return null;
}
/** A SUGGESTION of which specialist area fits a sector. It does not grant or require anything: who may review is decided by reviewer_areas. */
export const AREA_BY_SECTOR: Record<string, { area: string; why: string }> = {
  food: { area: 'food_safety', why: 'Gıda işletmesi kuralı.' }, electrical: { area: 'occupational_safety', why: 'Elektrik tesisatı güvenliği (iş sağlığı ve güvenliği alanına en yakın).' },
  estate: { area: 'consumer', why: 'Müşteri ve mülk sahibiyle sözleşme/yetki belgesi (tüketici alanına en yakın).' },
};
async function areaCoverage(tx: Tx, areas: string[]) {
  const out: { area: string; reviewers: number; names: string[] }[] = [];
  for (const area of areas) {
    const r = (await tx.query<{ n: string }>(`SELECT u.display_name AS n FROM reviewer_areas a JOIN users u ON u.id = a.user_id WHERE a.area = $1 ORDER BY u.display_name`, [area])).rows.map(x => x.n);
    out.push({ area, reviewers: r.length, names: r });
  }
  return out;
}
const fmtFreq = (r: any) => !r ? '—' : r.freq === 'unset' ? 'Belirlenmedi' : r.freq === 'once' ? `Tek seferlik · ${r.on} ${r.at}` : r.freq === 'daily' ? `Her gün ${r.at}` : r.freq === 'weekly' ? `Haftalık · her ${['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'][(Number(r.weekday) || 1) - 1]} ${r.at}` : `Aylık · her ayın ${r.day}. günü ${r.at}${r.day > 28 ? ' (ayda o gün yoksa ayın son günü)' : ''}`;
export const BASIS_TR: Record<string, string> = { source: 'Kaynak metin', admin_choice: 'Yönetici seçimi', business_plan: 'İşletme planı', example_scenario: 'ÖRNEK senaryo' };

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
  const templates: any[] = c.rule_version_id ? (await tx.query(`SELECT code, title, recurrence FROM task_templates WHERE rule_version_id = $1 ORDER BY code`, [c.rule_version_id])).rows : (c.proposal?.templates ?? []);
  const applyD = c.apply_on ? String(c.apply_on).slice(0, 10) : applyDay((c.proposal?.effectiveFrom ?? c.effective_from) ? String(c.proposal?.effectiveFrom ?? c.effective_from).slice(0, 10) : null, today);
  const sourceHint = sourceFrequencyHint(c.new_text ?? c.old_text);
  const frequency = {
    effectiveFrom: c.proposal?.effectiveFrom ?? c.effective_from, applyOn: applyD,
    sourceHint: sourceHint ?? null, sourceSays: sourceHint ? `Kaynak metin sıklık söylüyor: "${sourceHint.quote}"${sourceHint.supported ? '' : ' (sistem yıllık sıklığı desteklemiyor)'}` : 'Kaynak metin bir tekrar sıklığı söylemiyor; sıklığı yönetici belirler.',
    checks: templates.map(t => ({ code: t.code, title: t.title, recurrence: t.recurrence, text: fmtFreq(t.recurrence), unset: t.recurrence?.freq === 'unset', basis: t.recurrence?.basis ?? null,
      basisLabel: t.recurrence?.basis ? BASIS_TR[t.recurrence.basis] : (c.is_example ? 'ÖRNEK senaryo (dayanak belirtilmemiş)' : 'Dayanak belirtilmemiş'), basisNote: t.recurrence?.basisNote ?? null })),
    bases: FREQUENCY_BASES.map(b => ({ key: b, label: BASIS_TR[b] })),
  };
  // "This rule would open these tasks at this branch on these dates": from the same calendar the task generator uses (production window: today..+14 days).
  if (impact) for (const site of impact.sites as any[]) {
    if (site.to !== 'applies' || site.effect === 'ended') continue;
    const windowEnd = new Date(Date.parse(applyD + 'T12:00:00Z') + 14 * 86_400_000).toISOString().slice(0, 10);
    const plan = await plannedOccurrences(tx, site.companyId, site.siteId, templates, applyD, windowEnd);
    site.plannedTasks = plan.map(x => ({ code: x.code, title: x.title, dueAt: x.dueAt, firstDue: x.firstDue, unset: x.unset, notes: x.notes, upcoming: x.upcoming }));
    site.plannedText = plan.map(x => x.unset ? `${x.title}: tekrar sıklığı belirlenmedi; görev açılamaz.` : x.dueAt.length ? `Bu kuralla ${site.site} şubesinde ${x.dueAt.map(d => new Date(d).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })).join(', ')} tarihlerinde görev açılacak.`
      : `${x.title}: ${applyD} – ${windowEnd} penceresinde görev yok${x.firstDue ? `; ilk görev vadesi ${new Date(x.firstDue).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}` : ''}.`).join(' ')
      + plan.filter(x => x.upcoming.length).map(x => ` Aylık takvim (6 ay): ${x.upcoming.map(d => new Date(d).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })).join(', ')}.`).join('')
      + plan.filter(x => x.notes.length).map(x => ` Not: ${x.notes.join('; ')}. (Bu bir zamanlama seçimidir, hukuki zorunluluk değildir.)`).join('');
  }
  const asg = c.assigned_to ? (await tx.query(`SELECT u.display_name AS name FROM users u WHERE u.id = $1`, [c.assigned_to])).rows[0] : null;
  const reqAreas: string[] = (rule?.required_review_areas ?? c.proposal?.requiredReviewAreas ?? []) as string[];
  const coverage = await areaCoverage(tx, reqAreas);
  const mine = (await tx.query<{ area: string }>(`SELECT area FROM reviewer_areas WHERE user_id = $1`, [p.userId])).rows.map(r => r.area);
  const sectors: string[] = [...((c.suggestion?.sectors as string[] | undefined) ?? []), ...((c.suggestion?.bodySectors as string[] | undefined) ?? [])];
  const reviewAreas = {
    suggestion: [...new Set(sectors)].map(k => ({ sector: k, ...AREA_BY_SECTOR[k] })).filter(x => x.area),
    suggestionNote: 'Sektör alanı yalnız ÖNERİDİR; kuralı kimin inceleyebileceği ayrıca tanımlı inceleyici yetkisine (alan atamasına) bağlıdır.',
    required: coverage.map(x => ({ ...x, approved: approvedAreas.has(x.area), canIReview: mine.includes(x.area),
      waiting: x.reviewers === 0 ? `"${x.area}" alanında tanımlı inceleyici yok; kayıt, bir inceleyici atanana kadar gerekçesiyle kuyrukta bekler.` : null,
      myAccess: mine.includes(x.area) ? 'Bu alanda inceleme yetkin var.' : `Bu alanda inceleme yetkin yok${x.reviewers ? `; yetkili: ${x.names.join(', ')}` : '; alanda yetkili inceleyici de tanımlı değil — bir platform yöneticisi alan ataması yapmalı'}.` })),
  };
  if (c.date_status === 'unclear') blockers.push('Yürürlük tarihi belirsiz: bir yönetici tarihi çözene kadar uygulanamaz.');
  if (!c.source_url) blockers.push('Resmî kaynak bağlantısı yok.');
  if (!c.proposal && !c.rule_version_id) blockers.push('Önerilen kural değişikliği henüz yazılmadı.');
  if (templates.some(t => t.recurrence?.freq === 'unset')) blockers.push('Tekrar sıklığı belirlenmedi: taslak kaydedilebilir, ama görev üreten kural sıklık seçilmeden onaylanamaz ve yayımlanamaz.');
  if (c.proposal && !(reqAreas.length)) blockers.push('İnceleme alanı seçilmedi: taslak hazırlanamaz.');
  for (const a of reviewAreas.required) if (a.waiting && !a.approved) blockers.push(a.waiting);
  return {
    id: c.id, status: c.status, sourceCode: c.source_code, changeType: c.change_type, typeLabel: CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR], scopeArea: c.scope_area,
    docRef: c.doc_ref, docTitle: c.doc_title, articleRef: c.article_ref, sourceUrl: c.source_url, publishedOn: c.published_on, effectiveFrom: c.effective_from,
    dateStatus: c.date_status, dateNote: c.date_note, oldText: c.old_text, newText: c.new_text, suggestion: c.suggestion, isExample: c.is_example,
    proposal: c.proposal, proposalBy: c.proposal_by, rule, missingAreaReviews: missingAreas,
    approveReason: c.approve_reason, rejectReason: c.reject_reason, applyOn: c.apply_on, appliedAt: c.applied_at, applyResult: c.apply_result, detectedAt: c.detected_at,
    impact, impactNote, history, publishedRules: published, blockers, frequency, reviewAreas,
    // Set only when the machine could not read the publication reliably: who declared having read the official file.
    sourceCheck: ['not_read', 'ocr_pdf'].includes(c.suggestion?.readMethod) ? { method: c.suggestion.readMethod as string,
      checked: history.filter(h => h.event_type === 'legislation.source_checked').map(h => ({ by: h.actor as string | null, at: h.occurred_at })).at(-1) ?? null } : null,
    assignment: c.assigned_to ? { userId: c.assigned_to, name: asg?.name ?? null, at: c.assigned_at, note: c.assign_note } : null,
    compare: { hasOld: !!c.old_text, note: c.old_text ? null : c.change_type === 'new_publication' ? 'Yeni yayın: karşılaştırılacak bir eski metin yok; metin olduğu gibi okunur.' : 'Eski metin yok: bu kaynak ilk okumada yalnız karşılaştırma TABANI olarak kaydedildi; sonraki okumadaki farklar bu tabana göre gösterilir.' },
    cannot: cannotReasons(p, c, rule, blockers, reviewAreas.required),
    nextInLine: nextInLine(c, rule, reviewAreas.required, asg?.name ?? null),
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

/** Why an action is unavailable, in words, so the person reads the missing condition next to the button. */
function cannotReasons(p: Principal, c: any, rule: any, blockers: string[], areas: { area: string; approved: boolean; waiting: string | null }[]) {
  const r: Record<string, string | null> = { prepare: null, approve: null, reject: null, return: null, assign: null };
  if (!has(p, 'rule_author')) r.prepare = 'Taslağı yalnız kural yazarı hazırlar; bu hesabın kural yazarı rolü yok.';
  else if (c.status !== 'pending') r.prepare = c.status === 'drafted' ? 'Taslak zaten hazırlanmış.' : `Kayıt "${c.status}" durumunda.`;
  else if (c.date_status === 'unclear') r.prepare = 'Yürürlük tarihi belirsiz: önce bir yönetici tarihi çözmeli.';
  else if (!c.proposal) r.prepare = 'Önce önerilen kural değişikliğini yazıp kaydet.';
  else if (!(c.proposal.requiredReviewAreas ?? []).length) r.prepare = 'İnceleme alanı seçilmedi.';
  if (!has(p, 'rule_reviewer')) r.approve = 'Onayı yalnız kural onaylayıcısı verir; bu hesabın onaylayıcı rolü yok.';
  else if (c.status !== 'drafted') r.approve = c.status === 'pending' ? 'Önce kural taslağı hazırlanıp inceleme alanı onayını almalı.' : `Kayıt "${c.status}" durumunda.`;
  else if (rule && rule.author_id === p.userId) r.approve = 'Taslağı sen yazdın; onayı başka bir onaylayıcı verir.';
  else if (areas.some(a => !a.approved)) r.approve = `Alan incelemesi bekleniyor: ${areas.filter(a => !a.approved).map(a => a.area).join(', ')}${areas.some(a => !a.approved && a.waiting) ? ' (tanımlı inceleyici yok)' : ''}.`;
  else if (c.date_status === 'unclear') r.approve = 'Yürürlük tarihi belirsiz.';
  else if (blockers.some(b => /sıklığı belirlenmedi/.test(b))) r.approve = 'Tekrar sıklığı belirlenmedi: sıklık seçilmeden onaylanamaz.';
  if (!has(p, 'rule_reviewer') && !has(p, 'platform_admin')) r.reject = 'Reddetme yetkin yok.';
  else if (!['pending', 'drafted'].includes(c.status)) r.reject = `Kayıt "${c.status}" durumunda.`;
  if (!has(p, 'rule_reviewer') && !has(p, 'platform_admin')) r.return = 'İade yetkin yok.';
  else if (c.status !== 'drafted') r.return = 'İade yalnız hazırlanmış taslak için.';
  if (!has(p, 'platform_admin')) r.assign = 'Atamayı yalnız platform yöneticisi yapar.';
  else if (!['pending', 'drafted'].includes(c.status)) r.assign = `Kayıt "${c.status}" durumunda; atama yapılamaz.`;
  return r;
}
function nextInLine(c: any, rule: any, areas: { area: string; approved: boolean; waiting: string | null; names: string[] }[], assignee: string | null): string {
  const who = assignee ? ` Atanan: ${assignee}.` : '';
  if (c.status === 'pending') return `Sıra: kural yazarında (öneri ve taslak).${who}`;
  if (c.status === 'drafted') { const w = areas.filter(a => !a.approved); return w.length ? `Sıra: alan incelemesinde (${w.map(a => `${a.area}: ${a.waiting ? 'inceleyici tanımlı değil' : a.names.join(', ')}`).join('; ')}); sonra kural onaylayıcısında.${who}` : `Sıra: kural onaylayıcısında (yazar dışında biri).${who}`; }
  if (c.status === 'scheduled') return `Sıra: sistemde — ${String(c.apply_on).slice(0, 10)} günü kendiliğinden uygulanır.`;
  if (c.status === 'applied') return 'Tamamlandı: uygulandı.'; return 'Kapandı: reddedildi.';
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
  // Neither the review area nor the frequency is guessed: a sector SUGGESTS an area (shown as a suggestion), the frequency stays undecided until the administrator picks it.
  const sectors: string[] = [...((c.suggestion?.sectors as string[] | undefined) ?? []), ...((c.suggestion?.bodySectors as string[] | undefined) ?? [])];
  const skeleton = { areas: [...new Set(sectors.map(k => AREA_BY_SECTOR[k]?.area).filter(Boolean) as string[])],
    condition: sectors.includes('estate') ? { fact: 'activity.brokerage', op: 'eq', value: true } : sectors.includes('electrical') ? { fact: 'activity.installation_business', op: 'eq', value: true } : { fact: 'activity.food_preparation', op: 'eq', value: true } };
  return {
    targetRuleCode: null, code: `LEG-${sha(c.external_key).slice(0, 8).toUpperCase()}`, title: c.doc_title.slice(0, 120), kind: 'legal_requirement', isExample: c.is_example, provisionIds: [], ambiguityNote: null,
    condition: skeleton.condition,
    obligationTitle: c.doc_title.slice(0, 120), obligationSummary: (c.new_text ?? c.old_text ?? c.doc_title).replace(/\s+/g, ' ').slice(0, 400),
    effectiveFrom: eff, effectiveTo: null, changeReason: `${CHANGE_TYPE_TR[c.change_type as keyof typeof CHANGE_TYPE_TR]}: ${c.doc_ref}`, requiredReviewAreas: skeleton.areas,
    templates: [{ code: 'kontrol', title: 'Yeni düzenleme kontrolü', instructions: 'Uzman bu görevi düzenlemeye göre yazar (taslak yer tutucu).', recurrence: { freq: 'unset' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'food_safety' }],
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
  if (!(c.proposal.requiredReviewAreas ?? []).length) throw conflict('AREA_REQUIRED', 'İnceleme alanı seçilmedi: kuralı hangi alanın uzmanının inceleyeceğini seç (sektör yalnız öneridir).');
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
  await approveRuleVersion(tx, p, c.rule_version_id, why, { dateSetByLegislationFlow: true });
  const eff = String(c.effective_from).slice(0, 10);
  // A repeal takes effect on the day after the old version's last day; its rule version carries that last day.
  const apply = c.change_type === 'repeal' && rv.effective_to ? addDays(String(rv.effective_to).slice(0, 10), 1) : eff;
  await tx.query(`UPDATE legislation_changes SET status = 'scheduled', approved_by = $2, approved_at = now(), approve_reason = $3, apply_on = $4 WHERE id = $1`, [id, p.userId, why, apply]);
  // What the approver was shown: the preview AS OF APPROVAL. The actual effect on the effective day is recorded separately by 'legislation.applied'.
  const pv = await previewImpact(tx, await specFromRuleVersion(tx, c.rule_version_id), apply > istanbulDay(now) ? apply : istanbulDay(now));
  await appendAudit(tx, { companyId: null, actorId: p.userId, eventType: 'legislation.approved', entityType: 'legislation_change', entityId: id,
    payload: { docRef: c.doc_ref, article: c.article_ref, sourceUrl: c.source_url, reason: why, applyOn: apply, ruleVersionId: c.rule_version_id, example: c.is_example,
      previewAtApproval: { asOf: pv.onDate, affectedSites: pv.affectedSites, notifiedSites: pv.notifiedSites, outOfScopeSites: pv.outOfScopeSites, openTasksAffected: pv.openTasksAffected, sites: pv.sites.map(s => ({ siteId: s.siteId, site: s.site, from: s.from, to: s.to, effect: s.effect, openTasks: s.openTasks })) } } });
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
  const rvRow = await publishVersion(tx, c.approved_by, c.rule_version_id, { allowExampleRules: cfg.allowExampleRules, reason: c.approve_reason, dateSetByLegislationFlow: true,
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

/** A scheduled run finishes its day only when the sources answered AND that day's list was out. A late issue keeps the retries running. */
const SCHEDULE_DONE = `trigger = 'schedule' AND status = 'ok' AND NOT results @> '[{"awaitingToday": true}]'::jsonb`;

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
      const okToday = (await tx.query(`SELECT 1 FROM legislation_scan_runs WHERE run_date = $1 AND ${SCHEDULE_DONE}`, [today])).rowCount;
      if (okToday) return false;
      const attempts = (await tx.query<{ n: number; last: string | null }>(`SELECT count(*)::int AS n, max(started_at) AS last FROM legislation_scan_runs WHERE run_date = $1 AND trigger = 'schedule'`, [today])).rows[0]!;
      return retryPlan(attempts.n, attempts.last ? new Date(attempts.last) : null, now).due;
    });
    if (due) { out.scan = await runScan(db, cfg, { trigger: 'schedule', now }); log({ level: 'info', event: 'legislation_scan', ...(out.scan as object) }); }
  }
  return out;
}

export function startLegislationScheduler(db: Db, cfg: LegislationConfig, log: (l: Record<string, unknown>) => void, everyMs = 10 * 60_000, o: { firstMs?: number; clock?: () => Date } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await legislationTick(db, cfg, (o.clock ?? (() => new Date()))(), log); } catch (e) { log({ level: 'error', event: 'legislation_tick_failed', error: (e as Error).message }); } finally { running = false; }
  };
  setTimeout(() => void tick(), o.firstMs ?? 30_000).unref();
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
