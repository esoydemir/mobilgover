import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * GH-02: profil yanıtından açıklanabilir yükümlülüğe. Kullanıcı diliyle gerekçe, kuralın tanımı, inceleme durumu,
 * kaynak sürümü değişince eski dayanağın korunması, eksik/onaysız yanıtın uygunluk vermemesi. Kurallar ÖRNEKTİR.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const admin = () => client(env, platform.admin.token);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const obligations = async () => (await owner().get(`${C()}/obligations?siteId=${demo.siteId}`)).body as any[];
const byRule = async (code: string) => (await obligations()).find(o => o.rule === code);

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 14);
});
afterAll(async () => { await env?.close(); });

describe('kullanıcı diliyle gerekçe', () => {
  it('"uygulanır" kararı, kullanıcının verdiği yanıtları kendi cümleleriyle söyler; yanıtın kaynağı ve kural sürümü açılır', async () => {
    const o = await byRule('EX-COLD-CHAIN');
    expect(o.decision).toBe('applies');
    expect(o.reasonText).toContain('Bu şubede soğukta saklanan ürün olduğunu belirttiniz.');
    expect(o.reasonText).toContain('yemek veya içecek hazırladığınızı belirttiniz');
    const e = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    expect(e.reasonText).toBe(o.reasonText);
    expect(e.matchedFacts['storage.cold']).toBeTruthy();
    expect(e.conditionFacts.find((f: any) => f.key === 'storage.cold')).toMatchObject({ current: true });
    expect(e.rule.version).toBe(1);
  });

  it('kuralın tanımı: koşul, sıklık, kanıt, yürürlük, etiket; sorumlu rol modelde yok ve uydurulmaz', async () => {
    const o = await byRule('EX-COLD-CHAIN');
    const d = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body.definition;
    expect(d.label).toBe('Örnek kural (hukuki dayanağı doğrulanmadı)');
    expect(d.appliesWhen.join(' ')).toMatch(/Soğuk depolama/);
    expect(d.notApplicableWhen).toMatch(/uygulanmaz/);
    expect(d.checks.length).toBeGreaterThan(0);
    expect(d.checks[0].frequency).toMatch(/Her gün|Haftalık|Aylık|Saatlik|Yıllık/);
    expect(d.checks[0].evidence).toEqual(expect.arrayContaining(['ölçüm', 'fotoğraf']));
    expect(d.effectiveFrom).toBeTruthy();
    expect(d.responsibleRole).toBeNull();
    const glove = await byRule('EX-GLOVE');
    expect((await owner().get(`${C()}/obligations/${glove.id}/explanation`)).body.definition.label).toBe('Örnek iyi uygulama (mevzuat hükmü değil)');
  });

  it('görev ekranı aynı gerekçeyi ve yükümlülük bağlantısını taşır', async () => {
    const t = ((await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[]).find(x => x.equipment_id === demo.fridgeId)!;
    const d = (await owner().get(`${C()}/tasks/${t.id}`)).body;
    expect(d.why.text).toContain('soğukta saklanan ürün');
    expect(d.why.obligationId).toBeTruthy();
    expect((await owner().get(`${C()}/obligations/${d.why.obligationId}/explanation`)).status).toBe(200);
  });
});

describe('eksik ve onaysız yanıt uygunluk vermez', () => {
  it('yanıtlanmamış alan "bilgi eksik" olur, görev üretmez, "uygulanmaz" sayılmaz; sebep söylenir', async () => {
    const o = await byRule('EX-ISG-THRESHOLD');
    expect(o.decision).toBe('needs_info');
    expect(o.reasonText).toContain('Çalışan sayısı bilgisini henüz vermediniz.');
    expect(o.reasonText).toMatch(/uygunluk verilmez/);
    const e = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    expect(e.reviewStatus.state).toBe('needs_info');
    expect(e.missingStatements.length).toBe(1);
    const n = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-ISG-THRESHOLD'`, [demo.siteId])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe('gerekçeli düzeltme isteği ve inceleme durumu', () => {
  it('zorunlu yükümlülükte düzeltme isteği incelemeye gider; bu sürede yükümlülük geçerli ve görevler devam eder, durum açıkça yazılır', async () => {
    const o = await byRule('EX-COLD-CHAIN');
    const open = async () => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-COLD-CHAIN' AND t.status = 'open'`, [demo.siteId])).rows[0].n as number;
    const before = await open();
    const r = await owner().post(`${C()}/obligations/${o.id}/not-applicable`, {
      reason: 'Soğutucu yalnızca kapalı olduğu dönemde kullanıldı, şimdi kaldırıldı.', basis: 'Ekipman kaldırma tutanağı, 3 Kasım.',
      disputedFacts: [{ key: 'storage.cold', proposed: false }] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending_review');
    expect((await byRule('EX-COLD-CHAIN')).reviewPending).toBe(true);
    const e = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    expect(e.reviewStatus).toMatchObject({ state: 'in_review' });
    expect(e.reviewStatus.text).toMatch(/İnceleme sürüyor.*geçerli/);
    expect(e.obligation.decision).toBe('applies');
    expect(await open()).toBe(before);
  });
});

describe('kaynak (kural) sürümü değişince eski dayanak açılabilir', () => {
  let taskId: string;
  it('tamamlanan iş, kural yeni sürüme geçse de açıldığı dayanağı korur; yeni sürüm ayrıca gösterilir', async () => {
    const t = ((await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body as any[]).filter(x => x.equipment_id === demo.fridgeId && x.status === 'open')[0]!;
    taskId = t.id;
    const photo = fakeJpeg('gh02-foto');
    expect((await owner().post(`${C()}/tasks/${taskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId })).status).toBe(201);
    const reg = await owner().post(`${C()}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    expect((await owner().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg')).body.status).toBe('stored');
    expect((await owner().post(`${C()}/tasks/${taskId}/complete`)).status).toBe(200);
    const before = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(before.basis).toMatchObject({ ruleVersion: 1, newerVersion: null, note: null });

    // Yeni sürüm: aynı kural kodu, yazar → inceleme → alan onayı → onay → yayın.
    const draft = await author().post('/admin/rule-versions', {
      code: 'EX-COLD-CHAIN', title: 'Soğuk muhafaza sıcaklık kaydı (örnek, 2. sürüm)', kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null,
      condition: { all: [{ fact: 'activity.food_preparation', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] },
      obligationTitle: 'Soğuk muhafaza kaydı', obligationSummary: 'İkinci sürüm (test).', effectiveFrom: '2026-01-01', effectiveTo: null,
      changeReason: 'Kaynak sürümü değişti (test).', requiredReviewAreas: ['food_safety'],
      templates: [{ code: 'cold_v2_check', title: 'Soğuk kontrolü v2', instructions: 'Test.', recurrence: { freq: 'weekly', weekday: 1, at: '10:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'cleaning' }],
    });
    expect(draft.status).toBe(201);
    const id = draft.body.id as string;
    expect((await author().post(`/admin/rule-versions/${id}/submit`)).status).toBe(200);
    expect((await specialist().post(`/admin/rule-versions/${id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Uygun görüldü.' })).status).toBe(200);
    expect((await reviewer().post(`/admin/rule-versions/${id}/approve`, { reason: 'Onaylıyorum, kapsam uygun.' })).status).toBe(200);
    expect((await admin().post(`/admin/rule-versions/${id}/publish`, { reason: 'Yayımlıyorum, test.' })).status).toBe(200);

    const after = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(after.status).toBe('done');
    expect(after.rule.version).toBe(1);                       // eski dayanak yerinde
    expect(after.basis.ruleVersion).toBe(1);
    expect(after.basis.newerVersion).toMatchObject({ version: 2 });
    expect(after.basis.note).toMatch(/1\. sürümüne göre açıldı.*2\. sürüm yayımlandı/);
    expect(after.why.text).toContain('soğukta saklanan ürün');   // o günkü karar gerekçesi
  });

  it('aynı profili ve kuralı yeniden işlemek aynı dönemde ikinci görev üretmez', async () => {
    const count = async () => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1`, [demo.siteId])).rows[0].n as number;
    await topUpAllSites(env.db, 14); // yeni sürümün kendi görevleri bir kez gelir
    const n = await count();
    await topUpAllSites(env.db, 14);
    await topUpAllSites(env.db, 14);
    expect(await count()).toBe(n);
  });
});

describe('onaysız (OCR) yanıt çelişince uygunluk verilmez', () => {
  it('önce onaylı LPG yanıtı, sonra doğrulanmamış OCR değeri: karar "bilgi eksik" olur; "uygulanmaz" olmaz ve neden söylenir', async () => {
    const fact = (value: boolean, source: string, verification: string) =>
      owner().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'utility.lpg', value, source, verification });
    expect((await fact(true, 'user_declared', 'user_confirmed')).status).toBeLessThan(300);
    expect((await byRule('EX-LPG-CHECK')).decision).toBe('applies');
    const ocr = await fact(false, 'ocr', 'unverified');
    expect(ocr.status).toBeLessThan(300);
    const o = await byRule('EX-LPG-CHECK');
    expect(o.decision).toBe('needs_info');
    expect(o.reasonText).toMatch(/LPG \/ tüp gaz kullanımı yanıtınız henüz onaylanmadı/);
    expect(o.reasonText).toMatch(/uygunluk verilmez/);
  });
});
