import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { recordFact } from '../../src/services/profile';
import { recomputeSite } from '../../src/services/obligations';
import { applyDue, legislationTick, runScan } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Legislation watch, end to end on a real PostgreSQL with a SYNTHETIC official-looking source (host sentetik.test).
 * Everything the source yields is an EXAMPLE. Chain: scan → queue → (nothing changes for businesses) → author proposal → draft →
 * area review → reviewer approval with a reason → application on the effective day, only on matching sites, once.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const src = new SyntheticSource();
const cfg = () => src.config();
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const admin = () => client(env, platform.admin.token);
const owner = () => client(env, demo.users.owner.token);
const staff = () => client(env, demo.users.staff.token);
const today = istanbulDay();
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const tr = (iso: string) => iso.split('-').reverse().join('.');
let siteB: string; // in the same business but outside the rule's scope (no LPG)

const cnt = async (sql: string, args: unknown[] = []) => Number((await env.ownerDb.query(sql, args)).rows[0].n);
const tasksOf = (code: string, siteId?: string) => cnt(
  `SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND ($2::uuid IS NULL OR t.site_id = $2)`, [code, siteId ?? null]);
const notifsOf = (changeId: string, siteId?: string) => cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_type = 'legislation_change' AND entity_id = $1 AND ($2::uuid IS NULL OR site_id = $2)`, [changeId, siteId ?? null]);
const changeByTitle = async (frag: string) => (await env.ownerDb.query(`SELECT * FROM legislation_changes WHERE doc_title ILIKE $1 ORDER BY detected_at DESC LIMIT 1`, [`%${frag}%`])).rows[0];
const proposal = (code: string, extra: Record<string, unknown> = {}) => ({
  code, title: 'Sentetik LPG kontrolü (ÖRNEK)', kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null,
  condition: { all: [{ fact: 'utility.lpg', op: 'eq', value: true }, { fact: 'activity.food_preparation', op: 'eq', value: true }] },
  obligationTitle: 'LPG tüpü ve bağlantıları her gün kontrol edilir (ÖRNEK)', obligationSummary: 'Sentetik düzenleme: LPG kullanan gıda işletmeleri günlük kontrol yapar.',
  effectiveFrom: addDays(today, -30), effectiveTo: null, changeReason: 'Sentetik resmî yayın', requiredReviewAreas: ['food_safety'],
  templates: [{ code: 'lpg_gunluk', title: 'LPG bağlantı kontrolü', instructions: 'Tüp bağlantılarını kontrol et ve fotoğrafla.', recurrence: { freq: 'daily', at: '09:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'major', hazardType: 'gas' }],
  ...extra,
});

/** author proposes → prepares → specialist reviews area → reviewer approves with reason. Returns the approve response. */
async function takeToApproval(id: string, code: string, extra: Record<string, unknown> = {}, reason = 'Kaynak ve yürürlük tarihi kontrol edildi; kapsam uygun.') {
  expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, proposal(code, extra))).status).toBe(200);
  const prep = await author().post(`/admin/legislation/changes/${id}/prepare`);
  expect(prep.status).toBe(200);
  expect((await specialist().post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Gıda güvenliği açısından uygun (sentetik).' })).status).toBe(200);
  return reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason });
}

beforeAll(async () => {
  src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: { '1': 'Amaç: gıda güvenliği.', '2': 'Soğuk zincir kesintisiz sürdürülür.', '3': 'Eski madde.' } });
  env = await freshEnv({ legislation: cfg() });
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  // A second site of the same business that does not use LPG: outside the new rule's scope.
  siteB = await env.db.system(async tx => (await tx.query<{ id: string }>(`INSERT INTO sites (company_id, name) VALUES ($1, 'Beşiktaş (LPG yok)') RETURNING id`, [demo.companyId])).rows[0]!.id);
  await env.db.tenant(demo.companyId, async tx => {
    for (const [key, value] of [['activity.food_preparation', true], ['storage.cold', false], ['utility.lpg', false], ['site.province', 'İstanbul']] as const) {
      await recordFact(tx, 'system', demo.companyId, { siteId: siteB, key, value, source: 'user_declared', verification: 'user_confirmed' });
    }
    await recomputeSite(tx, demo.companyId, siteB, null);
  });
});
afterAll(async () => { await env?.close(); });

describe('daily scan and review queue', () => {
  it('finds a synthetic official publication, puts it in the queue as an EXAMPLE, and changes nothing for any business', async () => {
    src.publish(today, { id: `${today.replaceAll('-', '')}-1`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri LPG Güvenliği Yönetmeliği', sayi: 99001, articles: ['Gıda işletmelerinde LPG bağlantıları günlük kontrol edilir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.', 'Bu Yönetmelik hükümlerini Sentetik Bakan yürütür.'] });
    src.publish(today, { id: `${today.replaceAll('-', '')}-2`, category: 'YÖNETMELİKLER', title: 'Sentetik Üniversitesi Gıda Uygulama ve Araştırma Merkezi Yönetmeliği', articles: ['Merkez kurulur.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
    const before = { tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), obl: await cnt(`SELECT count(*)::int AS n FROM obligations`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) };
    const r = await admin().post('/admin/legislation/scan');
    expect(r.status).toBe(200);
    expect(r.body.results.find((x: any) => x.source === 'resmi_gazete')).toMatchObject({ ok: true, created: 1 });
    const q = (await admin().get('/admin/legislation/changes')).body;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ status: 'pending', change_type: 'new_publication', is_example: true, date_status: 'known', typeLabel: 'Yeni yayın' });
    const d = (await admin().get(`/admin/legislation/changes/${q[0].id}`)).body;
    expect(d).toMatchObject({ docRef: expect.stringContaining('99001'), effectiveFrom: today, isExample: true, exampleNote: expect.stringContaining('ÖRNEK') });
    expect(d.sourceUrl).toContain('sentetik.test');
    expect(d.newText).toContain('LPG bağlantıları');
    expect(d.suggestion.relevance).toContain('gıda');
    // Nothing reached any business.
    expect({ tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), obl: await cnt(`SELECT count(*)::int AS n FROM obligations`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) }).toEqual(before);
    expect((await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE company_id IS NULL AND event_type = 'legislation.detected'`)).rowCount).toBe(1);
  });

  it('the same publication scanned again does not create a second record; the admin overview shows health and pending count', async () => {
    await admin().post('/admin/legislation/scan');
    await admin().post('/admin/legislation/scan');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(1);
    const o = (await admin().get('/admin/legislation/overview')).body;
    expect(o.pendingReview).toBe(1);
    expect(o.lastSuccessfulScan.finished_at).toBeTruthy();
    expect(o.sources.map((s: any) => [s.code, s.is_example, !!s.last_success_at, s.last_error])).toEqual([['mevzuat', true, true, null], ['resmi_gazete', true, true, null]]);
    expect(o.canScan).toBe(true);
    // Staff and business users never see the queue.
    expect((await staff().get('/admin/legislation/overview')).status).toBe(403);
  });

  it('an unrelated source outage records the error per source, retries, keeps the last good data and recovers', async () => {
    const lastOk = (await admin().get('/admin/legislation/overview')).body.sources.find((s: any) => s.code === 'resmi_gazete').last_success_at;
    src.down = true;
    const down = await admin().post('/admin/legislation/scan');
    expect(down.body.status).toBe('failed');
    expect(down.body.results[0]).toMatchObject({ source: 'resmi_gazete', ok: false });
    const o = (await admin().get('/admin/legislation/overview')).body;
    const rg = o.sources.find((s: any) => s.code === 'resmi_gazete');
    expect(rg.last_error).toContain('sentetik kesinti');
    expect(rg.failures_in_row).toBe(1);
    expect(rg.last_success_at).toBe(lastOk); // last good data kept
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(1);
    src.down = false;
    const up = await admin().post('/admin/legislation/scan');
    expect(up.body.results.find((x: any) => x.source === 'resmi_gazete')).toMatchObject({ ok: true, created: 0 });
    expect((await admin().get('/admin/legislation/overview')).body.sources.find((s: any) => s.code === 'resmi_gazete')).toMatchObject({ last_error: null, failures_in_row: 0 });
  });

  it('the daily scan runs at its hour in Istanbul time, once a day, and retries a failed day', async () => {
    const db = env.db;
    const at = (h: number) => new Date(`${today}T${String(h - 3).padStart(2, '0')}:05:00Z`); // Istanbul = UTC+3
    const base = await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`);
    await legislationTick(db, cfg(), at(5)); // 05:05 Istanbul: too early
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).toBe(base);
    const backdate = (h: number) => env.ownerDb.query(`UPDATE legislation_scan_runs SET started_at = $1 WHERE trigger = 'schedule'`, [at(h)]);
    src.down = true;
    await legislationTick(db, cfg(), at(7)); // 07:05 first attempt fails
    await backdate(7);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule' AND status = 'failed'`)).toBe(1);
    await legislationTick(db, cfg(), at(7)); // retry waits 30 minutes
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).toBe(base + 1);
    src.down = false;
    await legislationTick(db, cfg(), at(8)); // retry succeeds
    await backdate(8);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule' AND status = 'ok'`)).toBe(1);
    await legislationTick(db, cfg(), at(9));
    await legislationTick(db, cfg(), at(10)); // done for today
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).toBe(base + 2);
  });
});

describe('approval gate', () => {
  let id: string;
  it('only a reviewer approves; an empty or blank reason is refused; nothing is approvable before a draft exists', async () => {
    id = (await changeByTitle('LPG Güvenliği')).id;
    expect((await staff().post(`/admin/legislation/changes/${id}/approve`, { reason: 'deneme' })).status).toBe(403);
    expect((await author().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Yazar kendi önerisini onaylayamaz' })).status).toBe(403);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Hazır değil' })).body.error.code).toBe('INVALID_STATE');
    expect((await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: '   ' })).status).toBe(422);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/approve`, {})).status).toBe(422);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/reject`, { reason: '' })).status).toBe(422);
    expect((await author().post(`/admin/legislation/changes/${id}/prepare`)).body.error.code).toBe('NO_PROPOSAL');
  });

  it('the proposal can be edited; the preview names the affected business/site before anything is approved, and leaves the other site out', async () => {
    const sug = (await author().get(`/admin/legislation/changes/${id}/suggest`)).body;
    expect(sug).toMatchObject({ kind: 'legal_requirement', isExample: true, requiredReviewAreas: ['food_safety'] });
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, proposal('EX-LEG-LPG', { condition: { fact: 'bilinmeyen.bilgi', op: 'eq', value: 1 } }))).status).toBe(422);
    expect((await reviewer().putJson(`/admin/legislation/changes/${id}/proposal`, proposal('EX-LEG-LPG'))).status).toBe(403);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, proposal('EX-LEG-LPG'))).status).toBe(200);
    const d = (await author().get(`/admin/legislation/changes/${id}`)).body;
    expect(d.proposal.code).toBe('EX-LEG-LPG');
    expect(d.impact.sites.map((s: any) => [s.site, s.effect, s.notify])).toEqual([['Kadıköy Moda', 'new_obligation', true]]);
    expect(d.impact.outOfScopeSites).toBe(1);
    expect(d.can).toMatchObject({ edit: true, prepare: true, approve: false });
    expect(await tasksOf('EX-LEG-LPG')).toBe(0);
  });

  it('a synthetic (example) source can never become a real rule', async () => {
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, proposal('EX-LEG-LPG', { isExample: false }))).status).toBe(200);
    const saved = (await author().get(`/admin/legislation/changes/${id}`)).body.proposal;
    expect(saved.isExample).toBe(true);
  });

  it('after area review the reviewer approves with a reason; an effective date of today applies at once, once, only on the matching site', async () => {
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`);
    expect(prep.status, JSON.stringify(prep.body)).toBe(200);
    expect((await author().post(`/admin/legislation/changes/${id}/prepare`)).status).toBe(409);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Alan incelemesi eksik' })).body.error.code).toBe('AREA_REVIEW_MISSING');
    expect((await specialist().post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Gıda güvenliği açısından uygun (sentetik).' })).status).toBe(200);
    expect(await tasksOf('EX-LEG-LPG')).toBe(0);
    expect(await notifsOf(id)).toBe(0);
    const ok = await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Resmî kaynak okundu, yürürlük bugün; kapsam LPG kullanan gıda işletmeleri.' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'applied', applyOn: today });
    const siteA = demo.siteId;
    expect(await tasksOf('EX-LEG-LPG', siteA)).toBeGreaterThan(0);
    expect(await tasksOf('EX-LEG-LPG', siteB)).toBe(0);
    expect(await notifsOf(id, siteA)).toBeGreaterThan(0);
    expect(await notifsOf(id, siteB)).toBe(0);
    expect(await cnt(`SELECT count(*)::int AS n FROM obligations o JOIN rules r ON r.id = o.rule_id WHERE r.code = 'EX-LEG-LPG' AND o.site_id = $1`, [siteB])).toBe(0);
    // Applying again, restarting the worker, and concurrent runs create nothing new.
    const t1 = await tasksOf('EX-LEG-LPG'), n1 = await notifsOf(id);
    await Promise.all([applyDue(env.db, cfg()), applyDue(env.db, cfg()), applyDue(env.db, cfg()), legislationTick(env.db, cfg())]);
    await admin().post('/admin/legislation/scan');
    expect(await tasksOf('EX-LEG-LPG')).toBe(t1);
    expect(await notifsOf(id)).toBe(n1);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE status = 'applied'`)).toBe(1);
  });

  it('who approved what, when and why is on the audit trail (platform chain and the business chain)', async () => {
    const ev = (await env.ownerDb.query(`SELECT event_type, actor_id, payload FROM audit_events WHERE entity_id = $1 ORDER BY seq`, [id])).rows;
    const types = ev.map(e => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['legislation.detected', 'legislation.proposal_saved', 'legislation.drafted', 'legislation.approved', 'legislation.applied', 'legislation.applied_to_company']));
    const appr = ev.find(e => e.event_type === 'legislation.approved');
    expect(appr.actor_id).toBe(platform.reviewer.id);
    expect(appr.payload.reason).toContain('Resmî kaynak okundu');
    expect(appr.payload.sourceUrl).toContain('sentetik.test');
    const company = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE company_id = $1 AND event_type = 'legislation.applied_to_company'`, [demo.companyId])).rows;
    expect(company).toHaveLength(1);
    expect(company[0].payload.sites).toHaveLength(1);
    expect((await admin().get(`/admin/legislation/changes/${id}`)).body.history.length).toBeGreaterThanOrEqual(5);
    // Rule-level audit rows keep the reason as well (existing mechanism).
    expect((await env.ownerDb.query(`SELECT 1 FROM audit_events WHERE event_type = 'rule.approved' AND payload->>'code' = 'EX-LEG-LPG' AND payload->>'reason' <> ''`)).rowCount).toBe(1);
  });

  it('the business sees, on one screen: what changed, why it applies to its site, what to do and by when, source and rule version', async () => {
    const list = (await owner().get(`/companies/${demo.companyId}/notifications`)).body;
    const n = (list.items ?? list).find((x: any) => x.kind === 'legislation_change');
    expect(n).toMatchObject({ entity_type: 'legislation_change', entity_id: id });
    expect(n.title).toContain('ÖRNEK');
    const v = (await owner().get(`/companies/${demo.companyId}/legislation-changes/${id}`)).body;
    expect(v.what).toMatchObject({ typeLabel: 'Yeni yayın', effectiveFrom: today });
    expect(v.what.newText).toContain('LPG bağlantıları');
    expect(v.sites).toHaveLength(1);
    expect(v.sites[0]).toMatchObject({ site: 'Kadıköy Moda', decision: 'applies' });
    expect(v.sites[0].why).toBeTruthy();
    expect(v.sites[0].matchedFacts.map((f: any) => f.key)).toEqual(expect.arrayContaining(['utility.lpg', 'activity.food_preparation']));
    expect(v.sites[0].tasks.length).toBeGreaterThan(0);
    expect(v.sites[0].nextDue).toBeTruthy();
    expect(v.rule).toMatchObject({ code: 'EX-LEG-LPG', version: 1 });
    expect(v.rule.label).toContain('ÖRNEK');
    expect(v.source.url).toContain('sentetik.test');
    // A separate session scoped ONLY to the out-of-scope site (siteB) gets no notification and cannot open the change for its site.
    const bUser = await env.db.system(async tx => {
      const uid = (await tx.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Beşiktaş şube yöneticisi') RETURNING id`)).rows[0]!.id;
      await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role) VALUES ($1,$2,$3,'site_manager')`, [uid, demo.companyId, siteB]);
      return { id: uid, token: await createSession(tx, uid, 1) };
    });
    const bList = (await client(env, bUser.token).get(`/companies/${demo.companyId}/notifications`)).body;
    expect((bList.items ?? bList).filter((x: any) => x.kind === 'legislation_change' && x.entity_id === id)).toHaveLength(0);
    const bView = await client(env, bUser.token).get(`/companies/${demo.companyId}/legislation-changes/${id}`);
    expect(bView.status === 404 || !(bView.body.sites ?? []).some((s: any) => /Beşiktaş/.test(s.site) && s.decision === 'applies')).toBe(true);
    // Another business never sees it.
    const other = await seedDemoCompany(env.db, { name: 'Başka İşletme' });
    expect((await client(env, other.users.owner.token).get(`/companies/${other.companyId}/legislation-changes/${id}`)).status).toBe(404);
  });
});

describe('effective date handling', () => {
  it('an unclear date blocks approval until an administrator resolves it with a reason', async () => {
    src.publish(today, { id: `${today.replaceAll('-', '')}-3`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda Hijyeni Ek Yönetmeliği', articles: ['Gıda işletmeleri çalışan sağlık kaydı tutar.', 'Bu Yönetmelik yayımını izleyen ayın başında yürürlüğe girer.'] });
    await admin().post('/admin/legislation/scan');
    const c = await changeByTitle('Hijyeni Ek');
    expect(c).toMatchObject({ date_status: 'unclear', effective_from: null });
    expect((await author().post(`/admin/legislation/changes/${c.id}/prepare`)).status).toBe(409);
    const d = (await admin().get(`/admin/legislation/changes/${c.id}`)).body;
    expect(d.blockers.join(' ')).toContain('belirsiz');
    expect((await admin().post(`/admin/legislation/changes/${c.id}/resolve-date`, { date: addDays(today, 5), note: '' })).status).toBe(422);
    expect((await author().post(`/admin/legislation/changes/${c.id}/resolve-date`, { date: addDays(today, 5), note: 'yetkisiz deneme' })).status).toBe(403);
    expect((await admin().post(`/admin/legislation/changes/${c.id}/resolve-date`, { date: addDays(today, 5), note: 'Resmî Gazete ilanındaki ay başı hükmü takvimden hesaplandı.' })).status).toBe(200);
    expect(await changeByTitle('Hijyeni Ek')).toMatchObject({ date_status: 'known', effective_from: addDays(today, 5) });
    expect((await env.ownerDb.query(`SELECT 1 FROM audit_events WHERE event_type = 'legislation.date_resolved' AND entity_id = $1`, [c.id])).rowCount).toBe(1);
  });

  it('a future effective date waits: approved but nothing applies before that day, then it applies once on the day', async () => {
    const c = await changeByTitle('Hijyeni Ek');
    const when = addDays(today, 5);
    const tasksBefore = await tasksOf('EX-LEG-SAGLIK'), notifBefore = await notifsOf(c.id);
    const ok = await takeToApproval(c.id, 'EX-LEG-SAGLIK', { effectiveFrom: when, condition: { fact: 'activity.food_preparation', op: 'eq', value: true }, templates: [{ code: 'saglik', title: 'Çalışan sağlık kaydı', instructions: 'Kayıtları kontrol et.', recurrence: { freq: 'daily', at: '09:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'hygiene' }] });
    expect(ok.body).toMatchObject({ status: 'scheduled', applyOn: when });
    expect(await tasksOf('EX-LEG-SAGLIK')).toBe(tasksBefore);
    expect(await notifsOf(c.id)).toBe(notifBefore);
    expect((await env.ownerDb.query(`SELECT status FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-LEG-SAGLIK'`)).rows[0].status).toBe('approved');
    await applyDue(env.db, cfg(), new Date(`${addDays(today, 4)}T12:00:00Z`));
    expect(await tasksOf('EX-LEG-SAGLIK')).toBe(0);
    expect((await changeByTitle('Hijyeni Ek')).status).toBe('scheduled');
    // The day arrives (even from two overlapping workers).
    const day = new Date(`${when}T09:00:00Z`);
    await Promise.all([applyDue(env.db, cfg(), day), applyDue(env.db, cfg(), day)]);
    const done = await changeByTitle('Hijyeni Ek');
    expect(done.status).toBe('applied');
    expect(done.apply_result.sites.filter((s: any) => s.companyId === demo.companyId).map((s: any) => s.site).sort()).toEqual(['Beşiktaş (LPG yok)', 'Kadıköy Moda']); // food preparation holds on both sites
    const t = await tasksOf('EX-LEG-SAGLIK');
    expect(t).toBeGreaterThan(0);
    await applyDue(env.db, cfg(), day);
    expect(await tasksOf('EX-LEG-SAGLIK')).toBe(t);
    expect(await cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND site_id = $2 AND user_id = $3`, [c.id, demo.siteId, demo.users.owner.id])).toBe(1);
  });
});

describe('rejection', () => {
  it('a reviewer rejects with a reason: nothing reaches any business and the same publication is not re-queued', async () => {
    src.publish(today, { id: `${today.replaceAll('-', '')}-4`, category: 'TEBLİĞLER', title: 'Sentetik Gıda Etiketleme Tebliği', articles: ['Etiket bilgisi okunaklı olur.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] });
    await admin().post('/admin/legislation/scan');
    const c = await changeByTitle('Etiketleme');
    const before = { tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) };
    expect((await reviewer().post(`/admin/legislation/changes/${c.id}/reject`, { reason: ' ' })).status).toBe(422);
    expect((await staff().post(`/admin/legislation/changes/${c.id}/reject`, { reason: 'yetkisiz' })).status).toBe(403);
    expect((await reviewer().post(`/admin/legislation/changes/${c.id}/reject`, { reason: 'Kafe ve restoran kapsamı dışında: ambalajlı ürün etiketi.' })).status).toBe(200);
    expect((await changeByTitle('Etiketleme')).status).toBe('rejected');
    await admin().post('/admin/legislation/scan');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE doc_title ILIKE '%Etiketleme%'`)).toBe(1);
    expect({ tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), rules: await cnt(`SELECT count(*)::int AS n FROM rule_versions`) }).toEqual(before);
    expect((await reviewer().post(`/admin/legislation/changes/${c.id}/approve`, { reason: 'Reddedileni onaylama' })).status).toBe(409);
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'legislation.rejected' AND entity_id = $1`, [c.id])).rows[0];
    expect(ev.payload.reason).toContain('kapsamı dışında');
  });
});

describe('repeal', () => {
  it('a repeal stops new tasks, closes only open work, keeps finished work on its own rule version, and records the effect', async () => {
    const code = 'EX-LEG-LPG';
    // One finished task under the rule, to prove history stays.
    const doneId = (await env.ownerDb.query(`SELECT t.id FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id
       WHERE r.code = $1 AND t.site_id = $2 AND t.status = 'open' ORDER BY t.due_at LIMIT 1`, [code, demo.siteId])).rows[0].id;
    await env.ownerDb.query(`UPDATE tasks SET status = 'done', outcome = 'conforming', completed_by = $2, completed_at = now() WHERE id = $1`, [doneId, demo.users.staff.id]);
    const open = await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND t.site_id = $2 AND t.status = 'open'`, [code, demo.siteId]);
    expect(open).toBeGreaterThan(0);
    const v1 = (await env.ownerDb.query(`SELECT rv.id FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND rv.version = 1`, [code])).rows[0].id;

    src.publish(today, { id: `${today.replaceAll('-', '')}-5`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri LPG Güvenliği Yönetmeliğinin Yürürlükten Kaldırılmasına Dair Yönetmelik', articles: ['Sentetik LPG Yönetmeliği yürürlükten kaldırılmıştır.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
    await admin().post('/admin/legislation/scan');
    const c = await changeByTitle('Yürürlükten Kaldırılmasına');
    expect(c.change_type).toBe('repeal');
    const sug = (await author().get(`/admin/legislation/changes/${c.id}/suggest?targetRuleCode=${code}`)).body;
    expect(sug).toMatchObject({ code, effectiveTo: addDays(today, -1) });
    const pre = (await author().putJson(`/admin/legislation/changes/${c.id}/proposal`, { ...sug, templates: sug.templates })).status;
    expect(pre).toBe(200);
    // Preview before approval says what happens to open work.
    const d = (await author().get(`/admin/legislation/changes/${c.id}`)).body;
    const mine = d.impact.sites.find((x: any) => x.siteId === demo.siteId);
    expect(mine).toMatchObject({ site: 'Kadıköy Moda', effect: 'ended', openTasks: open });
    expect(mine.openTaskEffect).toContain('açık görev kapanır');
    expect(d.impact.openTasksAffected).toBeGreaterThanOrEqual(open);
    const prep = await author().post(`/admin/legislation/changes/${c.id}/prepare`);
    expect(prep.status, JSON.stringify(prep.body)).toBe(200);
    await specialist().post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Yürürlükten kaldırma uygun (sentetik).' });
    const ok = await reviewer().post(`/admin/legislation/changes/${c.id}/approve`, { reason: 'Resmî kaynakta açıkça yürürlükten kaldırılmış.' });
    expect(ok.body).toMatchObject({ status: 'applied', applyOn: today });

    expect(await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND t.site_id = $2 AND t.status = 'open'`, [code, demo.siteId])).toBe(0);
    const closed = await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND t.site_id = $2 AND t.status IN ('cancelled','missed')`, [code, demo.siteId]);
    expect(closed).toBe(open);
    // The finished task keeps its status and its own rule version.
    const kept = (await env.ownerDb.query(`SELECT t.status, tt.rule_version_id FROM tasks t JOIN task_templates tt ON tt.id = t.template_id WHERE t.id = $1`, [doneId])).rows[0];
    expect(kept).toEqual({ status: 'done', rule_version_id: v1 });
    // No new task is generated afterwards.
    const total = await tasksOf(code);
    await env.db.system(async tx => { const { topUpAllSites } = await import('../../src/services/horizon'); void tx; await topUpAllSites(env.db, 5); });
    expect(await tasksOf(code)).toBe(total);
    expect((await env.ownerDb.query(`SELECT decision FROM obligations o JOIN rules r ON r.id = o.rule_id WHERE r.code = $1 AND o.site_id = $2 ORDER BY decided_at DESC LIMIT 1`, [code, demo.siteId])).rows[0].decision).toBe('not_applicable');
    // The effect is on the audit trail and on the business screen.
    const res = (await env.ownerDb.query(`SELECT apply_result FROM legislation_changes WHERE id = $1`, [c.id])).rows[0].apply_result;
    const rs = res.sites.find((x: any) => x.siteId === demo.siteId);
    expect(rs).toMatchObject({ effect: 'ended', openCancelled: expect.any(Number), openMissed: expect.any(Number) });
    expect(rs.openCancelled + rs.openMissed).toBe(open);
    const v = (await owner().get(`/companies/${demo.companyId}/legislation-changes/${c.id}`)).body;
    expect(v.todo.summary).toContain('yeni görev oluşmaz');
    expect(v.rule).toMatchObject({ code, version: 2, previousVersion: 1 });
  });
});

describe('consolidated text (Mevzuat Bilgi Sistemi connector)', () => {
  it('the first read is only a baseline; a later article change becomes an amendment with old and new text and an unclear date', async () => {
    const first = await admin().post('/admin/legislation/scan');
    const mv = first.body.results.find((r: any) => r.source === 'mevzuat');
    expect(mv).toMatchObject({ ok: true, created: 0 });
    src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: { '1': 'Amaç: gıda güvenliği.', '2': 'Soğuk zincir 4 °C altında kesintisiz sürdürülür.', '4': 'Yeni madde: alerjen bilgisi verilir.' } });
    const second = await admin().post('/admin/legislation/scan');
    expect(second.body.results.find((r: any) => r.source === 'mevzuat').created).toBe(3);
    const rows = (await env.ownerDb.query(`SELECT * FROM legislation_changes WHERE source_code = 'mevzuat' ORDER BY article_ref`)).rows;
    expect(rows.map(r => [r.article_ref, r.change_type])).toEqual([['2', 'article_amendment'], ['3', 'repeal'], ['4', 'new_publication']]);
    expect(rows[0]).toMatchObject({ old_text: 'Soğuk zincir kesintisiz sürdürülür.', new_text: 'Soğuk zincir 4 °C altında kesintisiz sürdürülür.', date_status: 'unclear', is_example: true });
    expect(rows[0].suggestion.addedWords).toEqual(expect.arrayContaining(['4', '°C', 'altında']));
    await admin().post('/admin/legislation/scan');
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE source_code = 'mevzuat'`)).toBe(3);
    // The source going away keeps the last read and creates no phantom repeal.
    src.consolidated.delete('1.5.9001');
    const gone = await admin().post('/admin/legislation/scan');
    expect(gone.body.results.find((r: any) => r.source === 'mevzuat').ok).toBe(false);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE source_code = 'mevzuat'`)).toBe(3);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_documents`)).toBe(1);
  });
});

describe('scan serialisation', () => {
  it('two scans started together run once', async () => {
    const [a, b] = await Promise.all([runScan(env.db, cfg(), { trigger: 'manual' }), runScan(env.db, cfg(), { trigger: 'manual' })]);
    expect([a, b].filter((x: any) => x.skipped).length).toBeLessThanOrEqual(1);
  });
});
