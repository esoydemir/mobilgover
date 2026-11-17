import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { recordFact } from '../../src/services/profile';
import { recomputeSite } from '../../src/services/obligations';
import { legislationTick, runScan, startLegislationScheduler } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Readiness for the live rollout, on a real PostgreSQL with a SYNTHETIC official-looking source:
 * the scheduler runs by itself (controlled clock), source health tells failure kinds apart, an unreadable source is never
 * "no change" and never damages the last good baseline, the same change is never queued twice (restart, overlap, recovery),
 * and a past-dated change applies at approval with the approval-time preview kept separate from the actual result.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const src = new SyntheticSource();
const cfg = () => src.config();
const today = istanbulDay();
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const admin = () => client(env, platform.admin.token);
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const cnt = async (sql: string, args: unknown[] = []) => Number((await env.ownerDb.query(sql, args)).rows[0].n);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const articles = (n: number, over: Record<string, string> = {}) => ({ ...Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), `Madde ${i + 1}: gıda işletmesi yükümlülüğü ${i + 1}.`])), ...over });
const mevzuat = async () => (await admin().get('/admin/legislation/overview')).body.sources.find((s: any) => s.code === 'mevzuat');
const docHash = async () => (await env.ownerDb.query(`SELECT content_sha256 FROM legislation_documents WHERE doc_key = 'mv:1.5.9001'`)).rows[0]?.content_sha256 ?? null;

beforeAll(async () => {
  src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: articles(8) });
  env = await freshEnv({ legislation: cfg() });
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  const siteB = await env.db.system(async tx => (await tx.query<{ id: string }>(`INSERT INTO sites (company_id, name) VALUES ($1, 'Beşiktaş (LPG yok)') RETURNING id`, [demo.companyId])).rows[0]!.id);
  await env.db.tenant(demo.companyId, async tx => {
    for (const [key, value] of [['activity.food_preparation', true], ['storage.cold', false], ['utility.lpg', false], ['site.province', 'İstanbul']] as const) {
      await recordFact(tx, 'system', demo.companyId, { siteId: siteB, key, value, source: 'user_declared', verification: 'user_confirmed' });
    }
    await recomputeSite(tx, demo.companyId, siteB, null);
  });
});
afterAll(async () => { await env?.close(); });

describe('the daily scan runs by itself (timer, controlled clock) and records source health', () => {
  it('the scheduler fires on its own at the scan hour (Istanbul), runs once for the day, and the first read is only a baseline', async () => {
    const clock = () => new Date(`${today}T06:10:00+03:00`);
    const lines: Record<string, unknown>[] = [];
    const stop = startLegislationScheduler(env.db, cfg(), l => lines.push(l), 25, { firstMs: 5, clock });
    for (let i = 0; i < 200 && !(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule' AND status = 'ok'`)); i++) await sleep(50);
    await sleep(400); // many more ticks: still one run for the day
    stop();
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).toBe(1);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule' AND status = 'ok' AND run_date = $1`, [today])).toBe(1);
    expect(lines.filter(l => l.event === 'legislation_scan')).toHaveLength(1);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(0); // baseline only
    const m = await mevzuat();
    expect(m).toMatchObject({ last_error: null, last_error_kind: null, failures_in_row: 0, last_docs_read: 1, last_items_seen: 8, queue_total: 0, queue_open: 0 });
    expect(m.last_attempt_at).toBeTruthy();
    expect(m.last_success_at).toBeTruthy();
  });

  it('before the scan hour the timer does nothing', async () => {
    const before = await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs`);
    await env.ownerDb.query(`DELETE FROM legislation_scan_runs WHERE trigger = 'schedule'`);
    const stop = startLegislationScheduler(env.db, cfg(), () => {}, 20, { firstMs: 5, clock: () => new Date(`${today}T05:10:00+03:00`) });
    await sleep(250);
    stop();
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).toBe(0);
    expect(before).toBeGreaterThan(0);
  });
});

describe('source health: failure kinds, last good baseline kept, never "no change"', () => {
  it.each([
    ['timeout', 'timeout'], ['blocked', 'blocked'], ['empty', 'empty'], ['pdf', 'unexpected_format'], ['robot', 'blocked'],
  ] as const)('%s is reported as %s; baseline, rule versions and tasks are untouched', async (mode, kind) => {
    const hash = await docHash();
    const ok1 = (await mevzuat()).last_success_at;
    const base = { tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) };
    src.fail = mode;
    const r = await admin().post('/admin/legislation/scan');
    src.fail = null;
    expect(r.body.status).toBe('failed');
    expect(r.body.results.find((x: any) => x.source === 'mevzuat')).toMatchObject({ ok: false, errorKind: kind });
    const m = await mevzuat();
    expect(m).toMatchObject({ last_error_kind: kind, queue_total: 0 });
    expect(m.last_error).toMatch(/^\[|: \[/);
    expect(m.failures_in_row).toBeGreaterThanOrEqual(1);
    expect(m.last_success_at).toBe(ok1);
    expect(m.last_items_seen).toBe(8); // a failed read does not overwrite the last good counts
    expect(await docHash()).toBe(hash);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(0);
    expect({ tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) }).toEqual(base);
  });

  it('a truncated consolidated text is "corrupt": the baseline is kept and no article is called repealed', async () => {
    const hash = await docHash();
    src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: articles(2) });
    const r = await admin().post('/admin/legislation/scan');
    expect(r.body.results.find((x: any) => x.source === 'mevzuat')).toMatchObject({ ok: false, errorKind: 'corrupt', docsRead: 0 });
    expect(await mevzuat()).toMatchObject({ last_error_kind: 'corrupt' });
    expect(await docHash()).toBe(hash);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(0);
  });

  it('recovery: the healthy source clears the error; one real edit becomes exactly one record, also under restart/overlap/rescan', async () => {
    src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: articles(8, { '3': 'Madde 3: gıda işletmesi yükümlülüğü 3, her gün kontrol edilir.' }) });
    const first = await admin().post('/admin/legislation/scan');
    expect(first.body.results.find((x: any) => x.source === 'mevzuat')).toMatchObject({ ok: true, created: 1, docsRead: 1, errorKind: null });
    expect(await mevzuat()).toMatchObject({ last_error: null, last_error_kind: null, failures_in_row: 0, queue_total: 1, queue_open: 1 });
    // scheduled tick + two manual scans overlapping, then a restart-like re-run: no second record.
    const day = new Date(`${today}T06:30:00+03:00`);
    await env.ownerDb.query(`DELETE FROM legislation_scan_runs WHERE trigger = 'schedule'`);
    await Promise.all([legislationTick(env.db, cfg(), day), runScan(env.db, cfg(), { trigger: 'manual' }), runScan(env.db, cfg(), { trigger: 'manual' })]);
    await legislationTick(env.db, cfg(), new Date(`${today}T08:00:00+03:00`));
    await runScan(env.db, cfg(), { trigger: 'manual' });
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(1);
    const c = (await env.ownerDb.query(`SELECT * FROM legislation_changes`)).rows[0];
    expect(c).toMatchObject({ change_type: 'article_amendment', article_ref: '3', status: 'pending', date_status: 'unclear', is_example: true });
    expect(c.old_text).toContain('yükümlülüğü 3.');
    expect(c.new_text).toContain('her gün kontrol edilir');
    expect(await cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_type = 'legislation_change'`)).toBe(0);
  });
});

describe('a past-dated change applies at approval; approval-time preview and the actual result are recorded separately', () => {
  let id: string;
  const proposal = () => ({
    code: 'EX-LEG-GECMIS', title: 'Sentetik gaz kontrolü (ÖRNEK)', kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null,
    condition: { all: [{ fact: 'utility.lpg', op: 'eq', value: true }, { fact: 'activity.food_preparation', op: 'eq', value: true }] },
    obligationTitle: 'Gaz bağlantıları kontrol edilir (ÖRNEK)', obligationSummary: 'Sentetik düzenleme.', effectiveFrom: addDays(today, -40), effectiveTo: null,
    changeReason: 'Sentetik resmî yayın', requiredReviewAreas: ['food_safety'],
    templates: [{ code: 'gaz_gunluk', title: 'Gaz bağlantı kontrolü', instructions: 'Bağlantıları kontrol et.', recurrence: { freq: 'daily', at: '09:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'major', hazardType: 'gas' }],
  });

  it('is found with a known, past effective date', async () => {
    const day = addDays(today, -2);
    src.publish(day, { id: `${day.replaceAll('-', '')}-7`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri Gaz Güvenliği Yönetmeliği', sayi: 99007, articles: ['Gıda işletmelerinde gaz bağlantıları günlük kontrol edilir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
    await admin().post('/admin/legislation/scan');
    const row = (await env.ownerDb.query(`SELECT id, effective_from, date_status FROM legislation_changes WHERE doc_title ILIKE '%Gaz Güvenliği%'`)).rows[0];
    expect(row.date_status).toBe('known');
    expect(String(row.effective_from.toISOString?.().slice(0, 10) ?? row.effective_from).slice(0, 10)).toBe(day);
    id = row.id;
  });

  it('applies immediately on approval, only on the matching site, once; the audit trail holds preview (approval) and actual (apply)', async () => {
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, proposal())).status).toBe(200);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`);
    expect(prep.status).toBe(200);
    expect((await specialist().post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Uygun (sentetik).' })).status).toBe(200);
    expect(await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-LEG-GECMIS'`)).toBe(0);
    const ok = await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Kaynak okundu; yürürlük geçmiş tarihli, kapsam gaz kullanan gıda işletmeleri.' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'applied', applyOn: addDays(today, -2) });
    const tasks = await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-LEG-GECMIS' AND t.site_id = $1`, [demo.siteId]);
    expect(tasks).toBeGreaterThan(0);
    expect(await cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND site_id = $2`, [id, demo.siteId])).toBeGreaterThan(0);
    expect(await cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND site_id <> $2`, [id, demo.siteId])).toBe(0);
    await Promise.all([legislationTick(env.db, cfg()), legislationTick(env.db, cfg())]);
    expect(await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-LEG-GECMIS' AND t.site_id = $1`, [demo.siteId])).toBe(tasks);
    const audit = (await env.ownerDb.query(`SELECT event_type, payload FROM audit_events WHERE entity_id = $1 AND company_id IS NULL ORDER BY id`, [id])).rows;
    const approved = audit.find(a => a.event_type === 'legislation.approved')!.payload;
    const applied = audit.find(a => a.event_type === 'legislation.applied')!.payload;
    expect(approved.previewAtApproval).toMatchObject({ affectedSites: 1, outOfScopeSites: expect.any(Number) });
    expect(approved.previewAtApproval.sites[0]).toMatchObject({ siteId: demo.siteId, effect: 'new_obligation' });
    expect(approved.reason).toContain('geçmiş tarihli');
    expect(applied.summary).toMatchObject({ sites: 1, tasksCreated: tasks, notified: expect.any(Number) });
    expect(applied.approvedBy).toBeTruthy();
  });
});

describe('machine off / process down: the missed interval is caught up on the next scan', () => {
  it('a publication from 5 days ago (older than the 2-day look-back) is found after a 6-day gap; a 40-day gap warns', async () => {
    const day = addDays(today, -5);
    src.publish(day, { id: `${day.replaceAll('-', '')}-9`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda Hijyeni Kaçırılan Gün Yönetmeliği', sayi: 99009, articles: ['Gıda işletmelerinde hijyen kuralları belirlenir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
    // Scan with the configured 2-day look-back right after a healthy read: not seen.
    await env.ownerDb.query(`UPDATE legislation_sources SET last_success_at = now() WHERE code = 'resmi_gazete'`);
    await admin().post('/admin/legislation/scan');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE doc_title ILIKE '%Kaçırılan Gün%'`)).toBe(0);
    // The machine was off for 6 days: the last healthy read is 6 days old.
    await env.ownerDb.query(`UPDATE legislation_sources SET last_success_at = now() - interval '6 days' WHERE code = 'resmi_gazete'`);
    const r = await admin().post('/admin/legislation/scan');
    const rg = r.body.results.find((x: any) => x.source === 'resmi_gazete');
    expect(rg).toMatchObject({ ok: true, created: 1 });
    expect(rg.notes.join(' ')).toContain('Kaçırılan aralık telafi edildi');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE doc_title ILIKE '%Kaçırılan Gün%'`)).toBe(1);
    // Again: no duplicate.
    await admin().post('/admin/legislation/scan');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE doc_title ILIKE '%Kaçırılan Gün%'`)).toBe(1);
    // A gap beyond 30 days is read as far as the window allows and says so.
    await env.ownerDb.query(`UPDATE legislation_sources SET last_success_at = now() - interval '40 days' WHERE code = 'resmi_gazete'`);
    const w = await admin().post('/admin/legislation/scan');
    expect(w.body.results.find((x: any) => x.source === 'resmi_gazete').notes.join(' ')).toContain('UYARI');
  });
});
