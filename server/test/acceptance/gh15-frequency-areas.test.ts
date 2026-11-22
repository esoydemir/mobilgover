import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFoodScopeRevision, ensureSectorGateRevisions, ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { applyDue, runScan } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { createSession } from '../../src/services/principal';
import { topUpSite } from '../../src/services/tasks';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Kuralın işletmede ne sıklıkla görev doğuracağını YÖNETİCİ seçer (tek seferlik ya da günlük/haftalık/aylık); inceleme alanı sektörden yalnız ÖNERİLİR,
 * inceleme yetkisi ayrıca tanımlı inceleyiciye bağlıdır. Tüm yayınlar ve kurallar SENTETİK/ÖRNEKTİR.
 */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay();
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const author = () => client(env, platform.author.token); const reviewer = () => client(env, platform.reviewer.token); const specialist = () => client(env, platform.specialist.token); const admin = () => client(env, platform.admin.token);
const cnt = async (sql: string, a: unknown[] = []) => Number((await env.ownerDb.query(sql, a)).rows[0].n);
let seq = 0; let siteA: string, companyA: string, siteMarket: string; let consumerReviewer: ReturnType<typeof client>; let consumerId: string;
const user = async (name: string) => { const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `gh15-${++seq}@test.invalid`])).rows[0].id as string; return { id, token: await env.db.system(tx => createSession(tx, id, 24)) }; };
const pub = (n: number, title: string, text: string) => src.publish(today, { id: `${today.replaceAll('-', '')}-${n}`, category: 'YÖNETMELİKLER', title, sayi: 99100 + n, articles: [text, 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
const changeId = async (title: string) => (await env.ownerDb.query(`SELECT id FROM legislation_changes WHERE doc_title = $1`, [title])).rows[0].id as string;
const T1 = 'Sentetik Taşınmaz Ticareti Dosya Kontrol Yönetmeliği (ÖRNEK)', T2 = 'Sentetik Taşınmaz Aracılık Haftalık Kontrol Yönetmeliği (ÖRNEK)', T3 = 'Sentetik Taşınmaz Sözleşme Arşiv Yönetmeliği (ÖRNEK)';
const tpl = (recurrence: any) => ({ code: 'dosya', title: 'Yetki sözleşmesi dosya kontrolü (ÖRNEK)', instructions: 'Dosyaların varlığını teyit et.', recurrence, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'hygiene', emergencyInstruction: 'Sorun varsa yöneticiye bildir.' });
const prop = (code: string, recurrence: any, areas = ['consumer']) => ({ code, title: `${code} (ÖRNEK)`, kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null,
  condition: { fact: 'activity.brokerage', op: 'eq', value: true }, obligationTitle: 'Dosya kontrolü (ÖRNEK)', obligationSummary: 'Sentetik örnek kural.', effectiveFrom: today, effectiveTo: null, changeReason: 'Sentetik resmî yayın', requiredReviewAreas: areas, templates: [tpl(recurrence)] });

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db); await ensureSectorRules(env.db); await ensureFoodScopeRevision(env.db); await ensureSectorGateRevisions(env.db);
  const o = await user('Emlak Sahibi'); const oc = client(env, o.token);
  const r = await oc.post('/companies', { name: 'Güven Emlak', siteName: 'Emlak A' }); companyA = r.body.companyId; siteA = r.body.siteId;
  await oc.post(`/companies/${companyA}/activity`, { naceCodes: ['68.31'], confirmed: true });
  const m = await user('Market Sahibi'); const mc = client(env, m.token);
  const mr = await mc.post('/companies', { name: 'Örnek Market', siteName: 'Market' }); siteMarket = mr.body.siteId;
  await mc.post(`/companies/${mr.body.companyId}/activity`, { naceCodes: ['47.11'], confirmed: true });
  pub(51, T1, 'Sözleşme dosyaları her ay kontrol edilir.'); pub(52, T2, 'Yetki sözleşmesi dosyalarının varlığı kontrol edilir.'); pub(53, T3, 'Arşiv düzenlenir.');
  await runScan(env.db, src.config(), { trigger: 'manual' });
  const c = await user('Tüketici alanı uzmanı'); consumerId = c.id; await env.ownerDb.query(`INSERT INTO platform_roles VALUES ($1,'rule_reviewer')`, [c.id]); await env.ownerDb.query(`INSERT INTO reviewer_areas VALUES ($1,'consumer')`, [c.id]); consumerReviewer = client(env, c.token);
});
afterAll(async () => { await env?.close(); });

describe('GH-15 sıklığı yönetici seçer, alanı yetkili inceler', () => {
  it('öneri taslağı sıklığı BELİRLENMEMİŞ bırakır, alanı sektörden önerir (gıda değil), kaynağın sıklık cümlesini gösterir', async () => {
    const id = await changeId(T1);
    const sug = (await author().get(`/admin/legislation/changes/${id}/suggest`)).body;
    expect(sug.templates[0].recurrence.freq).toBe('unset');
    expect(sug.requiredReviewAreas).toEqual(['consumer']); expect(sug.requiredReviewAreas).not.toContain('food_safety');
    const d = (await author().get(`/admin/legislation/changes/${id}`)).body;
    expect(d.frequency.sourceHint).toMatchObject({ freq: 'monthly', supported: true }); expect(d.frequency.sourceSays).toMatch(/her ay/);
    const none = (await author().get(`/admin/legislation/changes/${await changeId(T2)}`)).body;
    expect(none.frequency.sourceHint).toBeNull(); expect(none.frequency.sourceSays).toMatch(/söylemiyor/);
  });

  it('sıklık belirsiz taslak KAYDEDİLİR ama yayına geçemez; ön izleme "görev açılamaz" der; işletme etkilenmez', async () => {
    const id = await changeId(T1); const before = await cnt(`SELECT count(*)::int AS n FROM tasks`);
    { const r = await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G15-UNSET', { freq: 'unset' })); expect(r.status, JSON.stringify(r.body)).toBe(200); }
    const d = (await author().get(`/admin/legislation/changes/${id}`)).body;
    expect(d.blockers.join(' ')).toMatch(/sıklığı belirlenmedi/i); expect(d.frequency.checks[0]).toMatchObject({ unset: true });
    expect(d.impact.sites.find((s: any) => s.siteId === siteA).plannedText).toMatch(/belirlenmedi/);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`); expect(prep.status).toBe(200);
    expect((await consumerReviewer.post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'consumer', decision: 'approved', notes: 'Alan incelemesi tamam (sentetik).' })).status).toBe(200);
    const ap = await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Sıklık seçilmeden onay denemesi.' });
    expect(ap.status).toBe(409); expect(ap.body.error.code).toBe('FREQUENCY_UNSET');
    expect(await cnt(`SELECT count(*)::int AS n FROM tasks`)).toBe(before);
    expect((await reviewer().post(`/admin/legislation/changes/${id}/reject`, { reason: 'Sıklık belirlenmedi; yeni öneri açılır (sentetik).' })).status).toBe(200);
  });

  it('TEK SEFERLİK: önizleme tek vade yazar; onay öncesi etki 0; onaydan sonra Emlak A\'da tam 1 görev + 1 bildirim, diğer şubede 0; tekrarlar sayıyı artırmaz', async () => {
    const id = await changeId(T3); const due = addDays(today, 3);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G15-ONCE', { freq: 'once', on: due, at: '10:00', basis: 'example_scenario', basisNote: 'ÖRNEK senaryo' }))).status).toBe(200);
    const d = (await author().get(`/admin/legislation/changes/${id}`)).body;
    const s = d.impact.sites.find((x: any) => x.siteId === siteA);
    expect(s.plannedTasks[0].dueAt).toHaveLength(1); expect(s.plannedText).toMatch(/Bu kuralla Emlak A şubesinde .* tarihlerinde görev açılacak/);
    expect(d.frequency.checks[0].basisLabel).toMatch(/ÖRNEK/);
    expect(d.impact.sites.find((x: any) => x.siteId === siteMarket)?.plannedTasks ?? []).toEqual([]);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`);
    await consumerReviewer.post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'consumer', decision: 'approved', notes: 'Tek seferlik kural uygun (sentetik).' });
    const tasks = (sid: string) => cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-G15-ONCE' AND t.site_id = $1`, [sid]);
    const notifs = (sid: string) => cnt(`SELECT count(*)::int AS n FROM notifications WHERE entity_type = 'legislation_change' AND entity_id = $1 AND site_id = $2`, [id, sid]);
    expect([await tasks(siteA), await notifs(siteA)]).toEqual([0, 0]);
    const ok = await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'Kaynak okundu; tek seferlik sıklık yönetici seçimi (sentetik).' }); expect(ok.status).toBe(200);
    const after = [await tasks(siteA), await notifs(siteA), await tasks(siteMarket), await notifs(siteMarket)]; expect(after).toEqual([1, 1, 0, 0]);
    await runScan(env.db, src.config(), { trigger: 'manual' }); await applyDue(env.db, { allowExampleRules: true }); await env.db.system(tx => topUpSite(tx, companyA, siteA, 14, null, new Date(Date.now() + 5 * 86_400_000)));
    expect([await tasks(siteA), await notifs(siteA), await tasks(siteMarket), await notifs(siteMarket)]).toEqual(after);
    const row = (await env.ownerDb.query(`SELECT t.due_at FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-G15-ONCE'`)).rows;
    expect(row).toHaveLength(1); expect(new Date(row[0].due_at).toISOString().slice(0, 10)).toBe(due);
  });

  it('uygun inceleyici tanımlı değilse kayıt gerekçesiyle kuyrukta bekler; yetkisiz hesap inceleyemez, onay engellenir', async () => {
    const id = await changeId(T2);
    expect((await author().putJson(`/admin/legislation/changes/${id}/proposal`, prop('EX-G15-WEEKLY', { freq: 'weekly', weekday: 1, at: '10:00', basis: 'admin_choice' }, ['environment']))).status).toBe(200);
    const asNone = (await specialist().get(`/admin/legislation/changes/${id}`)).body.reviewAreas.required[0];
    const asOther = (await consumerReviewer.get(`/admin/legislation/changes/${id}`)).body.reviewAreas.required[0];
    expect(asNone).toMatchObject({ area: 'environment', reviewers: 0, canIReview: false }); expect(asNone.waiting).toMatch(/tanımlı inceleyici yok/);
    expect(asOther.canIReview).toBe(false);
    expect((await author().get(`/admin/legislation/changes/${id}`)).body.frequency.checks[0].text).toBe('Haftalık · her Pazartesi 10:00');
    expect((await author().get(`/admin/legislation/changes/${id}`)).body.blockers.join(' ')).toMatch(/tanımlı inceleyici yok/);
    const prep = await author().post(`/admin/legislation/changes/${id}/prepare`);
    expect((await specialist().post(`/admin/rule-versions/${prep.body.ruleVersionId}/area-review`, { area: 'environment', decision: 'approved', notes: 'Yetkim yok (deneme).' })).status).toBe(403);
    const ap = await reviewer().post(`/admin/legislation/changes/${id}/approve`, { reason: 'İnceleyici yokken onay denemesi.' }); expect(ap.body.error.code).toBe('AREA_REVIEW_MISSING');
    const list = (await admin().get('/admin/legislation/changes?status=drafted')).body as any[];
    expect(list.find(x => x.doc_title === T2).waiting_reason).toMatch(/environment/);
    expect(await cnt(`SELECT count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-G15-WEEKLY'`)).toBe(0);
  });
});
