import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { daysInMonth, monthlyNotes, monthlyTargetDay, occurrences } from '../../src/domain/schedule';
import { ensureFoodScopeRevision, ensureSectorGateRevisions, ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { legislationTick, retryPlan, runScan } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { createSession } from '../../src/services/principal';
import { topUpSite } from '../../src/services/tasks';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Masaüstü mevzuat masası: dosya ataması ≠ rol ≠ alan yetkisi; iade; "neden kullanılamıyor" gerekçeleri.
 * Zamanlama: aylık sıklıkta ayın günü olmayan ay (31 → 30/28/29) ve okunamayan yayın için yeniden deneme aralığı. Her şey SENTETİK / ÖRNEKTİR.
 */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay();
const author = () => client(env, platform.author.token); const reviewer = () => client(env, platform.reviewer.token); const specialist = () => client(env, platform.specialist.token); const admin = () => client(env, platform.admin.token);
const cnt = async (sql: string, a: unknown[] = []) => Number((await env.ownerDb.query(sql, a)).rows[0].n);
let seq = 0; let companyA: string, siteA: string; let areaReviewer: { id: string; c: ReturnType<typeof client> }; let plain: { id: string; c: ReturnType<typeof client> };
const user = async (name: string) => { const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `gh17-${++seq}@test.invalid`])).rows[0].id as string; return { id, token: await env.db.system(tx => createSession(tx, id, 24)) }; };
const pub = (n: number, title: string, text: string) => src.publish(today, { id: `${today.replaceAll('-', '')}-${n}`, category: 'YÖNETMELİKLER', title, sayi: 99200 + n, articles: [text, 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
const idOf = async (title: string) => (await env.ownerDb.query(`SELECT id FROM legislation_changes WHERE doc_title = $1`, [title])).rows[0].id as string;
const TA = 'Sentetik Taşınmaz Aracılık Dosya Düzeni Yönetmeliği (ÖRNEK)', TB = 'Sentetik Taşınmaz Ticareti Aylık Kontrol Yönetmeliği (ÖRNEK)';
const prop = (code: string, recurrence: any, areas = ['consumer']) => ({ code, title: `${code} (ÖRNEK)`, kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null, condition: { fact: 'activity.brokerage', op: 'eq', value: true },
  obligationTitle: 'Dosya kontrolü (ÖRNEK)', obligationSummary: 'Sentetik örnek kural.', effectiveFrom: today, effectiveTo: null, changeReason: 'Sentetik resmî yayın', requiredReviewAreas: areas,
  templates: [{ code: 'dosya', title: 'Dosya kontrolü (ÖRNEK)', instructions: 'Dosyaları kontrol et.', recurrence, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'hygiene', emergencyInstruction: 'Sorun varsa yöneticiye bildir.' }] });

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db); await ensureSectorRules(env.db); await ensureFoodScopeRevision(env.db); await ensureSectorGateRevisions(env.db);
  const o = await user('Emlak Sahibi'); const oc = client(env, o.token);
  const r = await oc.post('/companies', { name: 'Güven Emlak', siteName: 'Emlak A' }); companyA = r.body.companyId; siteA = r.body.siteId;
  await oc.post(`/companies/${companyA}/activity`, { naceCodes: ['68.31'], confirmed: true });
  pub(61, TA, 'Aracılık dosyaları düzenli tutulur.'); pub(62, TB, 'Taşınmaz ticareti dosyaları kontrol edilir.');
  await runScan(env.db, src.config(), { trigger: 'manual' });
  const a = await user('Tüketici inceleyici'); await env.ownerDb.query(`INSERT INTO platform_roles VALUES ($1,'rule_reviewer')`, [a.id]); areaReviewer = { id: a.id, c: client(env, a.token) };
  const b = await user('Rolsüz kişi'); plain = { id: b.id, c: client(env, b.token) };
});
afterAll(async () => { await env?.close(); });

describe('GH-17 atama, alan yetkisi, iade', () => {
  it('atama kişiye rol/alan VERMEZ: rolsüz kişi ve alanı olmayan inceleyici reddedilir; hiçbir yetki sessizce yükselmez', async () => {
    const id = await idOf(TA);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G17-A', { freq: 'once', on: today, at: '10:00' }))).status).toBe(200);
    const roles = () => cnt(`SELECT count(*)::int AS n FROM platform_roles`); const areas = () => cnt(`SELECT count(*)::int AS n FROM reviewer_areas`);
    const before = [await roles(), await areas()];
    const noRole = await admin().post(`/admin/legislation/changes/${id}/assign`, { userId: plain.id, reason: 'Deneme: rolsüz kişi' }); expect(noRole.body.error.code).toBe('NOT_A_REVIEWER');
    const noArea = await admin().post(`/admin/legislation/changes/${id}/assign`, { userId: areaReviewer.id, reason: 'Deneme: alanı yok' }); expect(noArea.body.error.code).toBe('AREA_NOT_COVERED');
    expect([await roles(), await areas()]).toEqual(before);
    const cand = (await admin().get(`/admin/legislation/changes/${id}/assignees`)).body;
    expect(cand.needAreas).toEqual(['consumer']); expect(cand.candidates.find((x: any) => x.id === areaReviewer.id)).toMatchObject({ eligible: false, covers: [] });
    expect((await author().post(`/admin/legislation/changes/${id}/assign`, { userId: areaReviewer.id, reason: 'Yetkisiz deneme' })).status).toBe(403);
  });

  it('alan yetkisi AYRI işlem: yalnız platform yöneticisi, kişi zaten inceleyici olmalı, gerekçeli ve denetim kaydında veren/alan/kapsam/gerekçe var', async () => {
    const id = await idOf(TA);
    const g = { userId: areaReviewer.id, area: 'consumer', grant: true, reason: 'Tüketici alanı inceleyicisi olarak görevlendirildi.', changeId: id };
    expect((await specialist().post('/admin/reviewer-areas', g)).status).toBe(403);
    expect((await admin().post('/admin/reviewer-areas', { ...g, userId: plain.id })).body.error.code).toBe('REVIEWER_ROLE_REQUIRED');
    expect((await admin().post('/admin/reviewer-areas', { ...g, reason: 'kısa' })).status).toBe(422);
    expect((await admin().post('/admin/reviewer-areas', g)).body).toEqual({ changed: true });
    expect((await admin().post('/admin/reviewer-areas', g)).body).toEqual({ changed: false });
    const ev = (await env.ownerDb.query(`SELECT actor_id, payload FROM audit_events WHERE event_type = 'platform.area_granted' ORDER BY seq DESC LIMIT 1`)).rows[0];
    expect(ev.actor_id).toBe(platform.admin.id); expect(ev.payload).toMatchObject({ area: 'consumer', reason: g.reason, changeId: id }); expect(ev.payload.scope).toMatch(/Aracılık Dosya/);
    expect(await cnt(`SELECT count(*)::int AS n FROM platform_roles WHERE user_id = $1`, [areaReviewer.id])).toBe(1); // rol sayısı değişmedi
    const cand = (await admin().get(`/admin/legislation/changes/${id}/assignees`)).body; expect(cand.candidates.find((x: any) => x.id === areaReviewer.id)).toMatchObject({ eligible: true, covers: ['consumer'] });
  });

  it('uygun kişiye atama yapılır; gerekçe zorunlu; liste "bana atanan" süzer; denetim kaydında atayan/atanan/gerekçe', async () => {
    const id = await idOf(TA);
    expect((await admin().post(`/admin/legislation/changes/${id}/assign`, { userId: areaReviewer.id, reason: '' })).status).toBe(422);
    expect((await admin().post(`/admin/legislation/changes/${id}/assign`, { userId: areaReviewer.id, reason: 'Tüketici alanı, emlak yayını.' })).status).toBe(200);
    const mine = (await areaReviewer.c.get('/admin/legislation/changes?status=pending&assignee=me')).body as any[]; expect(mine.map(x => x.doc_title)).toEqual([TA]); expect(mine[0].assignee_name).toBe('Tüketici inceleyici');
    expect(((await admin().get('/admin/legislation/changes?status=pending&assignee=me')).body as any[])).toHaveLength(0);
    const ev = (await env.ownerDb.query(`SELECT actor_id, payload FROM audit_events WHERE event_type = 'legislation.assigned' ORDER BY seq DESC LIMIT 1`)).rows[0];
    expect(ev.actor_id).toBe(platform.admin.id); expect(ev.payload).toMatchObject({ assigneeId: areaReviewer.id, coveredAreas: ['consumer'], reason: 'Tüketici alanı, emlak yayını.' });
    const d = (await admin().get(`/admin/legislation/changes/${id}`)).body; expect(d.assignment).toMatchObject({ name: 'Tüketici inceleyici' }); expect(d.nextInLine).toMatch(/kural yazarında/); expect(d.compare.hasOld).toBe(false); expect(d.compare.note).toMatch(/Yeni yayın/);
  });

  it('inceleyici bulunmayan alan: kayıt "bekleyen" süzgecinde gerekçesiyle görünür; "eşleşmesi belirsiz" süzgeci; pasif işlemin nedeni yazılıdır', async () => {
    const id = await idOf(TB);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G17-B', { freq: 'monthly', day: 31, at: '10:00', basis: 'example_scenario' }, ['environment']))).status).toBe(200);
    const w = (await admin().get('/admin/legislation/changes?status=pending&waiting=1')).body as any[]; expect(w.map(x => x.doc_title)).toEqual([TB]); expect(w[0].waiting_reason).toMatch(/environment/);
    expect(((await admin().get('/admin/legislation/changes?status=pending&match=uncertain')).body as any[])).toHaveLength(0);
    const asReviewer = (await reviewer().get(`/admin/legislation/changes/${id}`)).body.cannot; expect(asReviewer.prepare).toMatch(/kural yazarı/); expect(asReviewer.approve).toMatch(/Önce kural taslağı/); expect(asReviewer.assign).toMatch(/platform yöneticisi/);
    const asAdmin = (await admin().get(`/admin/legislation/changes/${id}`)).body.cannot; expect(asAdmin.assign).toBeNull();
    const asAuthor = (await author().get(`/admin/legislation/changes/${id}`)).body.cannot; expect(asAuthor.prepare).toBeNull(); expect(asAuthor.approve).toMatch(/onaylayıcı rolü yok/);
  });

  it('gerekçeli iade: hazırlanmış taslak öneri aşamasına döner, hiçbir şey işletmeye ulaşmaz; yeniden taslak hazırlanabilir', async () => {
    const id = await idOf(TA); const tasks = await cnt(`SELECT count(*)::int AS n FROM tasks`);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`); expect(prep.status).toBe(200);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/return`, { reason: '' })).status).toBe(422);
    expect((await author().post(`/admin/legislation/changes/${id}/return`, { reason: 'Yetkisiz' })).status).toBe(403);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/return`, { reason: 'Talimat metni eksik; yazar düzeltsin.' })).status).toBe(200);
    expect((await env.ownerDb.query(`SELECT status, rule_version_id FROM legislation_changes WHERE id = $1`, [id])).rows[0]).toEqual({ status: 'pending', rule_version_id: null });
    expect(await cnt(`SELECT count(*)::int AS n FROM tasks`)).toBe(tasks);
    const again = await author().post(`/admin/legislation/changes/${id}/prepare`); expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await cnt(`SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'legislation.returned'`)).toBe(1);
  });
});

describe('GH-17 aylık sıklık: ayın günü olmayan ay', () => {
  const cal = { timezone: 'Europe/Istanbul', openingDays: [1, 2, 3, 4, 5, 6, 7], closures: [] as string[] };
  it('ayın 31\'i: kısa ayda ayın son günü; şubat (artık yıl dahil) ve 30 günlük aylar', () => {
    const days = (from: string, to: string, day: number) => occurrences({ freq: 'monthly', day, at: '10:00' }, cal, from, to).map(o => o.periodKey + '@' + o.dueAt.toISOString().slice(0, 10));
    expect(days('2027-01-01', '2027-06-30', 31)).toEqual(['M:2027-01@2027-01-31', 'M:2027-02@2027-02-28', 'M:2027-03@2027-03-31', 'M:2027-04@2027-04-30', 'M:2027-05@2027-05-31', 'M:2027-06@2027-06-30']);
    expect(days('2028-02-01', '2028-02-29', 30)).toEqual(['M:2028-02@2028-02-29']); // artık yıl
    expect(days('2027-02-01', '2027-02-28', 15)).toEqual(['M:2027-02@2027-02-15']);
    expect(daysInMonth('2027-02-10')).toBe(28); expect(monthlyTargetDay(31, '2027-04-01')).toBe(30);
  });
  it('kapalı gün: o ay görev açılmaz ve önizleme bunu söyler (üretimle aynı kural)', () => {
    const closedSun = { ...cal, openingDays: [1, 2, 3, 4, 5, 6] }; // 2027-02-28 Pazar
    expect(occurrences({ freq: 'monthly', day: 31, at: '10:00' }, closedSun, '2027-02-01', '2027-02-28')).toEqual([]);
    expect(monthlyNotes({ day: 31 }, closedSun, '2027-02-01', '2027-03-31')).toEqual([{ month: '2027-02', day: '2027-02-28', clamped: true, closed: true }, { month: '2027-03', day: '2027-03-31', clamped: false, closed: false }]);
  });
  it('onay önizlemesi ile üretilen görevler AYNI tarihler; tekrar üretim ikinci görev eklemez; önizleme kısa ay notunu yazar', async () => {
    const id = await idOf(TB);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G17-MONTHLY', { freq: 'monthly', day: 31, at: '10:00', basis: 'example_scenario' }))).status).toBe(200);
    const d = (await author().get(`/admin/legislation/changes/${id}`)).body; const site = d.impact.sites.find((s: any) => s.siteId === siteA);
    expect(site.plannedText).toMatch(/Aylık takvim \(6 ay\)/); expect(site.plannedText).toMatch(/ayın 31\. günü yok, ayın son günü/); expect(site.plannedText).toMatch(/hukuki zorunluluk değildir/);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`); expect(prep.status).toBe(200);
    await env.ownerDb.query(`INSERT INTO reviewer_areas VALUES ($1,'consumer') ON CONFLICT DO NOTHING`, [areaReviewer.id]);
    expect((await areaReviewer.c.post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'consumer', decision: 'approved', notes: 'Aylık kural uygun (sentetik).' })).status).toBe(200);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Aylık sıklık yönetici seçimi (sentetik).' })).status).toBe(200);
    const list = async () => (await env.ownerDb.query(`SELECT t.due_at FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE r.code = 'EX-G17-MONTHLY' AND t.site_id = $1 ORDER BY t.due_at`, [siteA])).rows.map(r => new Date(r.due_at).toISOString());
    const now = new Date();
    await env.db.system(tx => topUpSite(tx, companyA, siteA, 190, null, now)); const made = await list();
    const wanted = site.plannedTasks[0].upcoming as string[];
    expect(made.slice(0, wanted.length)).toEqual(wanted); expect(made.length).toBeGreaterThanOrEqual(wanted.length);
    await env.db.system(tx => topUpSite(tx, companyA, siteA, 190, null, now)); await env.db.system(tx => topUpSite(tx, companyA, siteA, 190, null, new Date(now.getTime() + 3600_000)));
    expect((await list()).length).toBe(made.length);
  });
});

describe('GH-17 okunamayan yayın: yeniden deneme aralığı', () => {
  it('aralık: 30 dk, 1 sa, 2 sa, 4 sa; günde en çok 5 deneme; sonraki deneme zamanı hesaplanır', () => {
    const t0 = new Date('2026-12-01T10:00:00+03:00'); const at = (m: number) => new Date(t0.getTime() + m * 60_000);
    expect(retryPlan(0, null, t0)).toMatchObject({ due: true });
    expect(retryPlan(1, t0, at(29)).due).toBe(false); expect(retryPlan(1, t0, at(30)).due).toBe(true); expect(retryPlan(1, t0, at(5)).nextAttemptAt).toBe(at(30).toISOString());
    expect(retryPlan(2, t0, at(59)).due).toBe(false); expect(retryPlan(2, t0, at(60)).due).toBe(true);
    expect(retryPlan(4, t0, at(239)).due).toBe(false); expect(retryPlan(4, t0, at(240)).due).toBe(true);
    expect(retryPlan(5, t0, at(10_000))).toEqual({ due: false, nextAttemptAt: null, exhausted: true });
  });
  it('zamanlayıcı: okunamayan yayın yüzünden aynı gün kısa aralıkla tekrar tekrar gitmez; sağlıklı yayın bir kez kuyruğa girer; okunabilince eksik yayın bir kez girer', async () => {
    const day = '2026-12-07'; const t = (hm: string) => new Date(`${day}T${hm}:00+03:00`);
    const s2 = new SyntheticSource(); const id = (n: number) => `${day.replaceAll('-', '')}-${n}`;
    const e2 = await freshEnv({ legislation: s2.config({ enabled: true, scanHour: 6 }) });
    try {
      await seedPlatform(e2.db);
      s2.publish(day, { id: id(1), category: 'YÖNETMELİKLER', title: 'Sentetik Taşınmaz Aracılık Güvence Yönetmeliği (ÖRNEK)', sayi: 99301, articles: ['Taşınmaz aracılık güvencesi.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
      s2.publish(day, { id: id(2), category: 'YÖNETMELİKLER', title: 'Sentetik Taşınmaz Ticareti Kayıt Yönetmeliği (ÖRNEK)', sayi: 99302, articles: ['Taşınmaz ticareti kayıtları.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
      s2.unreadable.add(id(2));
      const cfg = s2.config({ enabled: true, scanHour: 6 }); const calls = () => s2.calls.filter(c => /eskiler/.test(c)).length;
      const runs = () => Number((e2.ownerDb.query(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`) as any) && 0);
      const n = async () => Number((await e2.ownerDb.query(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).rows[0].n);
      const q = async () => Number((await e2.ownerDb.query(`SELECT count(*)::int AS n FROM legislation_changes`)).rows[0].n);
      void runs;
      await legislationTick(e2.db, cfg, t('05:00')); expect(await n()).toBe(0);               // tarama saatinden önce
      await legislationTick(e2.db, cfg, t('06:00')); expect(await n()).toBe(1); expect(await q()).toBe(1); // sağlıklı yayın kuyrukta, okunamayan yok
      const c1 = calls();
      for (const hm of ['06:05', '06:10', '06:20', '06:29']) await legislationTick(e2.db, cfg, t(hm)); // 30 dk dolmadan hiç yeni deneme yok
      expect(await n()).toBe(1); expect(calls()).toBe(c1);
      await legislationTick(e2.db, cfg, t('06:31')); expect(await n()).toBe(2);                 // 1. bekleme: 30 dk
      await legislationTick(e2.db, cfg, t('07:00')); expect(await n()).toBe(2);                 // 2. bekleme: 60 dk (06:31 + 60 = 07:31)
      await legislationTick(e2.db, cfg, t('07:32')); expect(await n()).toBe(3);
      const ov = (await client(e2, (await seedPlatformAdminToken(e2))).get('/admin/legislation/overview')).body; void ov;
      expect(await q()).toBe(1);                                                                 // okunamayan yayın hâlâ kuyrukta DEĞİL, sağlıklı olan çoğalmadı
      s2.unreadable.delete(id(2));                                                               // erişim geri geldi
      await legislationTick(e2.db, cfg, t('09:40')); expect(await q()).toBe(2);                 // 3. bekleme 2 sa → eksik yayın bir kez kuyruğa girdi
      await legislationTick(e2.db, cfg, t('23:00')); expect(await q()).toBe(2);                 // tekrar kuyruğa girmez
    } finally { await e2.close(); }
  });
});
async function seedPlatformAdminToken(e: Env) { const id = (await e.ownerDb.query(`SELECT user_id AS id FROM platform_roles WHERE role = 'platform_admin' LIMIT 1`)).rows[0].id as string; return e.db.system(tx => createSession(tx, id, 24)); }
