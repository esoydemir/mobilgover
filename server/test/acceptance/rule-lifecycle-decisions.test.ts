import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GH-03 / B-13: iade, gerekçeli ret ve yayımlanmış sürümü geri çekme ayrı işlemlerdir.
 * Hem rol/durum geçişleri hem sonuçları (görev, karar geçmişi, bildirim, kayıt) sınanır. Kurallar ÖRNEKTİR.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const admin = () => client(env, platform.admin.token);
const owner = () => client(env, demo.users.owner.token);
const C = () => `/companies/${demo.companyId}`;
const draft = (code: string) => ({
  code, title: 'Lifecycle test kuralı (örnek)', kind: 'good_practice', isExample: true, provisionIds: [], ambiguityNote: null,
  condition: { fact: 'service.delivery', op: 'eq', value: true },
  obligationTitle: 'Test yükümlülüğü', obligationSummary: 'Yaşam döngüsü sınaması için örnek kural.',
  effectiveFrom: '2026-01-01', effectiveTo: null, changeReason: 'İlk örnek taslak', requiredReviewAreas: ['food_safety'],
  templates: [{ code: "lifecycle_t", title: 'Test kontrolü', instructions: 'Test.', recurrence: { freq: 'weekly', weekday: 1, at: '10:00' },
    evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'cleaning' }],
});
const status = async (id: string) => (await admin().get(`/admin/rule-versions/${id}`)).body.status as string;

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 14);
});
afterAll(async () => { await env?.close(); });

describe('iade ve ret', () => {
  let id: string;
  it('yazar taslağı gönderir; alan uzmanı onaylar', async () => {
    id = (await author().post('/admin/rule-versions', draft('EX-LIFECYCLE'))).body.id;
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).status).toBe(200);
    expect((await specialist().post(`/admin/rule-versions/${id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Uygun görüldü.' })).status).toBe(200);
  });
  it('iade: gerekçesiz veya kısa gerekçeyle, yazar eliyle, yetkisiz kişiyle yapılamaz', async () => {
    expect((await reviewer().post(`/admin/rule-versions/${id}/return`, {})).status).toBe(422);
    expect((await reviewer().post(`/admin/rule-versions/${id}/return`, { reason: 'kısa' })).status).toBe(422);
    expect((await author().post(`/admin/rule-versions/${id}/return`, { reason: 'Kendi kuralımı geri alıyorum.' })).status).toBe(403);
    expect((await admin().post(`/admin/rule-versions/${id}/return`, { reason: 'Platform yöneticisi inceleyici değildir.' })).status).toBe(403);
  });
  it('iade sonrası sürüm taslaktır, gerekçe kayıtlıdır; eski alan onayı yeniden incelemeye zorlar', async () => {
    const r = await reviewer().post(`/admin/rule-versions/${id}/return`, { reason: 'Gerekçe metni eksik; düzeltip yeniden gönderin.' });
    expect(r.status).toBe(200);
    expect(await status(id)).toBe('draft');
    const d = (await admin().get(`/admin/rule-versions/${id}`)).body;
    expect(d.statusReason).toMatch(/Gerekçe metni eksik/);
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).status).toBe(200);
    const ap = await reviewer().post(`/admin/rule-versions/${id}/approve`, { reason: 'Onaylıyorum, kapsam uygun.' });
    expect(ap.status).toBe(409);
    expect(ap.body.error.code).toBe('AREA_REVIEW_MISSING');
  });
  it('ret: gerekçeli, terminal; reddedilen sürüm yayımlanamaz ve yeniden gönderilemez', async () => {
    expect((await reviewer().post(`/admin/rule-versions/${id}/reject`, {})).status).toBe(422);
    expect((await reviewer().post(`/admin/rule-versions/${id}/reject`, { reason: 'Kapsam örnek amacının dışında; reddedildi.' })).status).toBe(200);
    expect(await status(id)).toBe('rejected');
    expect((await admin().post(`/admin/rule-versions/${id}/publish`, { reason: 'Yayımlamayı deniyorum.' })).status).toBe(409);
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).status).toBe(409);
    expect((await reviewer().post(`/admin/rule-versions/${id}/return`, { reason: 'Reddedilmiş sürümü geri almaya çalışıyorum.' })).status).toBe(409);
    const list = (await admin().get('/admin/rule-versions?status=rejected')).body as any[];
    expect(list.some(v => v.id === id)).toBe(true);
  });
});

describe('yayımlanmış sürümü geri çekme', () => {
  let coldVersion: string, futureBefore: number, taskId: string;
  const count = async (cond: string) => (await env.ownerDb.query(
    `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-COLD-CHAIN' AND ${cond}`, [demo.siteId])).rows[0].n as number;

  it('yetkisiz kişi ve gerekçesiz istek geri çekemez', async () => {
    coldVersion = platform.ruleVersionIds['EX-COLD-CHAIN']!;
    expect(await status(coldVersion)).toBe('published');
    expect((await author().post(`/admin/rule-versions/${coldVersion}/withdraw`, { reason: 'Yazar geri çekemez, yetkisi yok.' })).status).toBe(403);
    expect((await admin().post(`/admin/rule-versions/${coldVersion}/withdraw`, {})).status).toBe(422);
    expect(await status(coldVersion)).toBe('published');
  });

  it('geri çekme: ileri tarihli işler durur, vadesi gelenler incelemeye düşer, karar ve gerekçe kayda bağlanır', async () => {
    // Bir işi vadesi geçmiş yap (testin durumu): bu görev geri çekmede silinmez, incelemeye işaretlenir.
    taskId = (await env.ownerDb.query(
      `SELECT t.id FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-COLD-CHAIN' AND t.status = 'open' ORDER BY t.due_at LIMIT 1`, [demo.siteId])).rows[0].id;
    await env.ownerDb.query(`ALTER TABLE tasks DISABLE TRIGGER USER`);
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '2 hours' WHERE id = $1`, [taskId]);
    await env.ownerDb.query(`ALTER TABLE tasks ENABLE TRIGGER USER`);
    futureBefore = await count(`t.status = 'open' AND t.due_at >= now()`);
    expect(futureBefore).toBeGreaterThan(0);
    const obsBefore = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [demo.siteId])).rows[0].n as number;

    const r = await admin().post(`/admin/rule-versions/${coldVersion}/withdraw`, { reason: 'Kaynak maddesi yanlış yorumlanmış; sürüm geri çekildi.' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ruleCode: 'EX-COLD-CHAIN', futureTasksStopped: futureBefore, dueTasksFlagged: 1 });
    expect(await status(coldVersion)).toBe('withdrawn');

    expect(await count(`t.status = 'open' AND t.due_at >= now()`)).toBe(0);
    expect(await count(`t.status = 'cancelled' AND t.status_reason LIKE 'Kural sürümü geri çekildi%'`)).toBe(futureBefore);
    expect(await count(`t.status = 'open' AND t.review_flag = 'RULE_WITHDRAWN'`)).toBe(1);

    // Geçmiş silinmez: yeni karar eklenir, eski karar yerinde durur.
    const obsAfter = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [demo.siteId])).rows[0].n as number;
    expect(obsAfter).toBe(obsBefore + 1);
    const o = ((await owner().get(`${C()}/obligations?siteId=${demo.siteId}`)).body as any[]).find(x => x.rule === 'EX-COLD-CHAIN');
    expect(o.decision).toBe('needs_review');
    expect(o.reason).toMatch(/geri çekildi/);
  });

  it('yeni görev üretilmez; kayıt, kural durumu ve gerekçeyi taşır; sahip bir kez bildirim alır', async () => {
    const before = await count(`true`);
    await topUpAllSites(env.db, 14);
    expect(await count(`true`)).toBe(before);
    const d = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(d.reviewFlag).toBe('RULE_WITHDRAWN');
    expect(d.rule).toMatchObject({ status: 'withdrawn' });
    expect(d.rule.statusReason).toMatch(/yanlış yorumlanmış/);
    const notes = (await env.ownerDb.query(`SELECT user_id, title, body FROM notifications WHERE site_id = $1 AND kind = 'rule_withdrawn'`, [demo.siteId])).rows;
    expect(notes.some(n => n.user_id === demo.users.owner.id)).toBe(true);
    expect(notes.length).toBe(new Set(notes.map(n => n.user_id)).size); // kullanıcı başına tek bildirim
    expect(notes[0].body).toMatch(/Gerekçe/);
    // Aynı sürümü ikinci kez geri çekmek geçmişi bozmaz.
    expect((await admin().post(`/admin/rule-versions/${coldVersion}/withdraw`, { reason: 'İkinci kez geri çekmeyi deniyorum.' })).status).toBe(409);
  });
});
