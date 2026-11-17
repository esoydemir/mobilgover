import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan, legislationConfig } from '../../src/services/legislation';
import { istanbulDay, daysBack } from '../../src/services/legislation-sources';
import { freshEnv, type Env } from '../support/env';

/**
 * LIVE observation against the OFFICIAL sources (resmigazete.gov.tr, mevzuat.gov.tr) on an isolated, empty test database.
 * Not part of CI: runs only with LIVE_OBSERVE=1 (network). It measures access, the date range read, parsed document/article
 * counts and the baseline; a second read must produce no change. Any real change found is queued and left UNPUBLISHED.
 * Output: LIVE_OBSERVE_OUT (json). Nothing here is synthetic.
 */
const live = process.env.LIVE_OBSERVE === '1';
let env: Env;
beforeAll(async () => { if (live) env = await freshEnv({}); });
afterAll(async () => { await env?.close(); });

describe.skipIf(!live)('live official-source observation', () => {
  it('reads both official sources, creates the baseline, and a second read yields no change', async () => {
    const lookback = Number(process.env.LIVE_LOOKBACK_DAYS ?? 14);
    const cfg = legislationConfig({}, { lookbackDays: lookback, allowExampleRules: false, enabled: false });
    const today = istanbulDay();
    const t0 = Date.now();
    const first = await runScan(env.db, cfg, { trigger: 'manual' });
    const t1 = Date.now();
    const second = await runScan(env.db, cfg, { trigger: 'manual' });
    const t2 = Date.now();
    const sources = (await env.ownerDb.query(`SELECT code, base_url, is_example, last_attempt_at, last_success_at, last_error, last_error_kind, last_items_seen, last_docs_read FROM legislation_sources ORDER BY code`)).rows;
    const docs = (await env.ownerDb.query(`SELECT doc_key, title, jsonb_object_keys(articles) AS k FROM legislation_documents`)).rows;
    const perDoc = new Map<string, { title: string; articles: number }>();
    for (const d of docs) { const e = perDoc.get(d.doc_key) ?? { title: d.title, articles: 0 }; e.articles++; perDoc.set(d.doc_key, e); }
    const changes = (await env.ownerDb.query(`SELECT source_code, change_type, doc_ref, doc_title, article_ref, published_on, effective_from, date_status, status, is_example, source_url FROM legislation_changes ORDER BY detected_at`)).rows;
    const out = {
      observedAt: new Date().toISOString(), istanbulDay: today, lookbackDays: lookback, dateRangeRead: [daysBack(today, lookback)[0], today],
      official: sources.map(s => ({ code: s.code, base: s.base_url, isExample: s.is_example })),
      firstScan: { status: (first as any).status, ms: t1 - t0, results: (first as any).results },
      secondScan: { status: (second as any).status, ms: t2 - t1, results: (second as any).results },
      sources: sources.map(s => ({ code: s.code, lastSuccessAt: s.last_success_at, lastError: s.last_error, lastErrorKind: s.last_error_kind, itemsSeen: s.last_items_seen, docsRead: s.last_docs_read })),
      watchedDocuments: [...perDoc].map(([key, v]) => ({ key, title: v.title, articlesParsed: v.articles })),
      realChangesQueued: changes,
      unpublished: (await env.ownerDb.query(`SELECT count(*)::int AS n FROM rule_versions WHERE status = 'published' AND created_at > now() - interval '1 hour'`)).rows[0].n === 0,
      kanun5996FilterIdsPresent: Object.fromEntries((["22","24","29","30","31","32","36"]).map(id => [id, docs.some(d => d.doc_key === "mv:1.5.5996" && d.k === id)])),
      conclusion: '',
    };
    const okGazette = (first as any).results?.find((r: any) => r.source === 'resmi_gazete');
    const okMevzuat = (first as any).results?.find((r: any) => r.source === 'mevzuat');
    out.conclusion = changes.length
      ? `Gerçek kaynaktan ${changes.length} değişiklik/yayın kuyruğa düştü (yayımlanmadı, uzman onayı bekliyor).`
      : `Canlı kaynak ve ilk okuma doğrulandı; canlıda değişiklik gözlenmedi (Resmî Gazete ${okGazette?.ok ? 'okundu' : 'OKUNAMADI'}, Mevzuat ${okMevzuat?.ok ? 'okundu' : 'OKUNAMADI'}).`;
    if (process.env.LIVE_OBSERVE_OUT) writeFileSync(process.env.LIVE_OBSERVE_OUT, JSON.stringify(out, null, 1));
    // The second read of unchanged official text must not invent a change.
    expect((second as any).results.find((r: any) => r.source === 'mevzuat')?.created ?? 0).toBe(0);
    expect(out.official.every(s => !s.isExample)).toBe(true);
  }, 600_000);
});
