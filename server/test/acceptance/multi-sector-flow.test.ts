import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Çok sektörlü uyum, ilk akış: kayıt → NACE → şube cevapları → kural → görev → atama → kanıtlı tamamlama.
 * Hiçbir görev veya fact elle eklenmez; her şey public API ile gider. Kurallar ÖRNEKTİR.
 * Tek yükümlülük ölçülür: EX-COLD-CHAIN ("soğuk ürün"). Bir şubede 1 soğutucu = o gün için 1 görev.
 */
let env: Env;
let companyId: string, siteA: string, siteB: string, estateCompany: string, estateSite: string;
let ownerToken: string, workerToken: string, workerId: string, estateToken: string;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const owner = () => client(env, ownerToken);
const worker = () => client(env, workerToken);
const C = () => `/companies/${companyId}`;
const COLD = 'EX-COLD-CHAIN';

const coldTasks = async (siteId: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = $2 AND t.status <> 'cancelled'`, [siteId, COLD])).rows[0].n as number;
const coldToday = async (siteId: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = $2 AND t.status <> 'cancelled'
      AND t.due_at = (SELECT min(t2.due_at) FROM tasks t2 JOIN rules r2 ON r2.id = t2.rule_id WHERE t2.site_id = $1 AND r2.code = $2 AND t2.status <> 'cancelled')`, [siteId, COLD])).rows[0].n as number;
const coldNotifications = async (siteId: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM notifications n WHERE n.site_id = $1 AND (n.title ILIKE '%soğuk%' OR n.body ILIKE '%soğuk%' OR n.entity_id IN (SELECT t.id FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE r.code = $2))`, [siteId, COLD])).rows[0].n as number;
const newUser = async (name: string) => {
  const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `${name.replace(/\W/g, '').toLowerCase()}@test.invalid`])).rows[0].id as string;
  return { id, token: await env.db.system(tx => createSession(tx, id, 24)) };
};

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  await ensureSectorRules(env.db);
  const o = await newUser('Sahip Kafe');
  ownerToken = o.token;
});
afterAll(async () => { await env?.close(); });

describe('NACE kataloğu', () => {
  it('kod ya da faaliyet adıyla aranır; katalog kaynağı ve kısmi olduğu söylenir', async () => {
    const byCode = (await owner().get('/nace?q=56.10')).body;
    expect(byCode.items.map((i: any) => i.code)).toContain('56.10');
    expect(byCode.partial).toBe(true);
    expect(byCode.source).toMatch(/NACE/);
    expect((await owner().get('/nace?q=emlak')).body.items.map((i: any) => i.code)).toContain('68.31');
    expect((await owner().get('/nace?q=KAFE')).body.items.map((i: any) => i.code)).toContain('56.10');
  });
});

describe('kayıttan görev tamamlamaya: A şubesi (soğuk ürün var) ve B şubesi (yok)', () => {
  it('sahip normal kayıt ekranından işletmeyi açar; henüz hiçbir yükümlülük "uygulanır" değildir', async () => {
    const r = await owner().post('/companies', { name: 'Moda Kafe', siteName: 'A · Moda' });
    expect(r.status).toBe(201);
    companyId = r.body.companyId; siteA = r.body.siteId;
    const b = await owner().post(`${C()}/sites`, { name: 'B · Kadıköy' });
    expect(b.status).toBe(201);
    siteB = b.body.id;
    for (const s of [siteA, siteB]) {
      const obs = (await owner().get(`${C()}/obligations?siteId=${s}`)).body as any[];
      expect(obs.every(x => x.decision !== 'applies')).toBe(true);
    }
    expect(await coldTasks(siteA)).toBe(0);
  });

  it('faaliyet onaylanmadan kayıt yapılmaz; bozuk kod reddedilir', async () => {
    expect((await owner().post(`${C()}/activity`, { naceCodes: ['56.10'], confirmed: false })).status).toBe(422);
    expect((await owner().post(`${C()}/activity`, { naceCodes: ['abc'], confirmed: true })).status).toBe(422);
  });

  it('bilinmeyen NACE kodu tahmin edilmez: kod saklanır, inceleme istenir, hiçbir yükümlülük "uygulanmaz" olmaz', async () => {
    const r = await owner().post(`${C()}/activity`, { naceCodes: ['99.99'], confirmed: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ needsReview: true, unknown: ['99.99'] });
    const prof = (await owner().get(`${C()}/sites/${siteA}/profile`)).body;
    expect(prof['activity.nace_codes'].value).toEqual(['99.99']);
    expect(prof['activity.food_preparation']).toBeUndefined();
    const obs = (await owner().get(`${C()}/obligations?siteId=${siteA}`)).body as any[];
    expect(obs.find(o => o.rule === COLD)?.decision).not.toBe('not_applicable');
  });

  it('sahip 56.10 seçip onaylar; faaliyet iki şube için de kaynağıyla birlikte kaydedilir', async () => {
    const r = await owner().post(`${C()}/activity`, { naceCodes: ['56.10'], confirmed: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ needsReview: false, unknown: [] });
    for (const s of [siteA, siteB]) {
      const prof = (await owner().get(`${C()}/sites/${s}/profile`)).body;
      expect(prof['activity.food_preparation']).toMatchObject({ value: true, source: 'user_declared', verification: 'user_confirmed' });
    }
    const ref = (await env.ownerDb.query(`SELECT source_ref FROM profile_facts WHERE company_id = $1 AND key = 'activity.food_preparation' ORDER BY recorded_at DESC LIMIT 1`, [companyId])).rows[0].source_ref;
    expect(ref).toContain('56.10');
  });

  it('şube sorusu: A "soğuk ürün satıyorum", B "satmıyorum"', async () => {
    const a = await owner().post(`${C()}/profile/facts`, { siteId: siteA, key: 'storage.cold', value: true, source: 'user_declared', verification: 'user_confirmed' });
    const b = await owner().post(`${C()}/profile/facts`, { siteId: siteB, key: 'storage.cold', value: false, source: 'user_declared', verification: 'user_confirmed' });
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('A şubesinde soğutucu eklenince 1 görev doğar (B şubesinde 0 görev, 0 bildirim); soğutucu B\'ye eklense bile B\'de görev doğmaz', async () => {
    const eqB = await owner().post(`${C()}/equipment`, { siteId: siteB, type: 'refrigerator', name: 'B vitrin buzdolabı' });
    expect(eqB.status).toBe(201);
    const eqA = await owner().post(`${C()}/equipment`, { siteId: siteA, type: 'refrigerator', name: 'A mutfak buzdolabı' });
    expect(eqA.status).toBe(201);
    expect(await coldToday(siteA)).toBe(1);
    expect(await coldTasks(siteA)).toBeGreaterThanOrEqual(1);
    expect(await coldTasks(siteB)).toBe(0);
    expect(await coldNotifications(siteB)).toBe(0);
    const obsB = (await owner().get(`${C()}/obligations?siteId=${siteB}`)).body as any[];
    expect(obsB.find(o => o.rule === COLD)?.decision).toBe('not_applicable');
  });

  it('aynı profili yeniden kaydetmek A\'daki görev sayısını değiştirmez', async () => {
    const before = await coldTasks(siteA);
    for (let i = 0; i < 2; i++) {
      expect((await owner().post(`${C()}/activity`, { naceCodes: ['56.10'], confirmed: true })).status).toBe(201);
      expect((await owner().post(`${C()}/profile/facts`, { siteId: siteA, key: 'storage.cold', value: true, source: 'user_declared', verification: 'user_confirmed' })).status).toBe(201);
    }
    expect(await coldTasks(siteA)).toBe(before);
    expect(await coldToday(siteA)).toBe(1);
    expect(await coldTasks(siteB)).toBe(0);
  });

  let taskId: string;
  it('yönetici görevin NEDEN oluştuğunu görür: kural, özet ve dayanak olan cevaplar', async () => {
    const list = (await owner().get(`${C()}/tasks?siteId=${siteA}&status=open`)).body as any[];
    const cold = list.find(t => t.title === 'Soğutucu sıcaklık kontrolü')!;
    taskId = cold.id;
    const d = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(d.rule.title).toContain('Soğuk muhafaza');
    expect(d.rule.summary).toMatch(/soğuk depolama/i);
    expect(d.rule.isExample).toBe(true);
    const why = (await owner().get(`${C()}/obligations/${d.obligationId}/explanation`));
    expect(why.status).toBe(200);
    expect(JSON.stringify(why.body)).toMatch(/storage\.cold|Soğuk depolama/);
    expect(JSON.stringify(why.body)).toMatch(/activity\.food_preparation|Yemek/);
    // Cevabın kaynağı izlenir: yemek hazırlama, onaylanan NACE kodundan türetilmiştir.
    expect(why.body.factOrigins['activity.food_preparation'].note).toContain('56.10');
    expect(why.body.factOrigins['activity.food_preparation'].sourceRef).toContain('nace-rev2-tr');
  });

  it('yönetici görevi çalışana atar; çalışan kendi hesabında yalnızca bunu görür', async () => {
    const inv = await owner().post(`${C()}/members`, { email: 'calisan.ayse@test.invalid', role: 'staff', siteId: siteA });
    expect(inv.status).toBe(201);
    workerId = (await env.ownerDb.query(`SELECT id FROM users WHERE email = 'calisan.ayse@test.invalid'`)).rows[0].id;
    workerToken = await env.db.system(tx => createSession(tx, workerId, 24));
    const mine = (await worker().get('/me/invitations')).body as any[];
    expect((await worker().post(`/me/invitations/${mine[0].membershipId ?? mine[0].id}/accept`)).status).toBe(200);
    expect((await worker().get(`${C()}/tasks`)).body).toEqual([]);
    const as = await owner().post(`${C()}/tasks/${taskId}/assign`, { userId: workerId });
    expect(as.status).toBe(200);
    expect(((await worker().get(`${C()}/tasks`)).body as any[]).map(t => t.id)).toEqual([taskId]);
  });

  it('çalışan ölçüm ve fotoğraf kanıtı ekleyip tamamlar; kanıtsız tamamlayamaz', async () => {
    expect((await worker().post(`${C()}/tasks/${taskId}/complete`)).body.error.code).toBe('EVIDENCE_INCOMPLETE');
    const m = await worker().post(`${C()}/tasks/${taskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString() });
    expect(m.status).toBe(201);
    const photo = fakeJpeg('a-subesi-termometre');
    const reg = await worker().post(`${C()}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    expect((await worker().put(`${C()}/evidence/${reg.body.id}/content`, photo, 'image/jpeg')).body.status).toBe('stored');
    const done = await worker().post(`${C()}/tasks/${taskId}/complete`);
    expect(done.status).toBe(200);
  });

  it('kapanmış kayıt yeniden açıldığında çalışanı, kanıtı ve dayanak kuralı gösterir', async () => {
    const d = (await owner().get(`${C()}/tasks/${taskId}`)).body;
    expect(d.status).toBe("done");
    expect(d.assignee).toMatchObject({ id: workerId });
    expect(d.completedBy).toBe(workerId);
    expect(d.evidence.some((e: any) => e.kind === 'photo' && e.status === 'stored')).toBe(true);
    expect(d.measurements.length).toBe(1);
    expect(d.rule.title).toContain('Soğuk muhafaza');
    expect(d.rule.version).toBeGreaterThanOrEqual(1);
  });
});

describe('başka sektör: emlak ofisi soğuk ürün görevi üretmez', () => {
  it('68.31 işletmesinde soğuk depo "Hayır" ve soğutucu olsa bile EX-COLD-CHAIN görevi yoktur', async () => {
    const e = await newUser('Emlak Sahibi');
    estateToken = e.token;
    const est = client(env, estateToken);
    const r = await est.post('/companies', { name: 'Güven Emlak', siteName: 'Merkez ofis' });
    estateCompany = r.body.companyId; estateSite = r.body.siteId;
    expect((await est.post(`/companies/${estateCompany}/activity`, { naceCodes: ['68.31'], confirmed: true })).status).toBe(201);
    await est.post(`/companies/${estateCompany}/profile/facts`, { siteId: estateSite, key: 'storage.cold', value: false, source: 'user_declared', verification: 'user_confirmed' });
    await est.post(`/companies/${estateCompany}/equipment`, { siteId: estateSite, type: 'refrigerator', name: 'Mutfak dolabı' });
    expect(await coldTasks(estateSite)).toBe(0);
    const prof = (await est.get(`/companies/${estateCompany}/sites/${estateSite}/profile`)).body;
    expect(prof['activity.food_preparation'].value).toBe(false);
    const obs = (await est.get(`/companies/${estateCompany}/obligations?siteId=${estateSite}`)).body as any[];
    expect(obs.some(o => o.decision === 'applies')).toBe(false);
  });

  it('yemek yapan işletmeye sonradan eklenen şube, onaylı faaliyeti devralır ama soğuk depo sorusu cevaplanana kadar görev doğmaz', async () => {
    const s = await owner().post(`${C()}/sites`, { name: 'C · Yeni şube' });
    const prof = (await owner().get(`${C()}/sites/${s.body.id}/profile`)).body;
    expect(prof['activity.food_preparation'].value).toBe(true);
    expect(prof['storage.cold']).toBeUndefined();
    expect(await coldTasks(s.body.id)).toBe(0);
    const obs = (await owner().get(`${C()}/obligations?siteId=${s.body.id}`)).body as any[];
    expect(obs.find(o => o.rule === COLD)?.decision).toBe('needs_info');
  });
});

describe('soru grupları: işletme yalnız kendi faaliyetine ait soruları görür', () => {
  const keys = (b: any[]) => b.map(q => q.key);
  it('faaliyeti henüz kayıtlı olmayan eski müşteri: "eksik" döner, hiçbir görev/karar bozulmaz; tüm sorular açık kalır', async () => {
    const u = await newUser('Eski Musteri');
    const c = client(env, u.token);
    const r = await c.post('/companies', { name: 'Eski Lokanta', siteName: 'Merkez' });
    const id = r.body.companyId, site = r.body.siteId;
    const before = (await c.get(`/companies/${id}/obligations?siteId=${site}`)).body;
    const a = (await c.get(`/companies/${id}/activity`)).body;
    expect(a).toMatchObject({ missing: true, codes: [] });
    expect(keys((await c.get(`/companies/${id}/profile-questions`)).body)).toEqual(expect.arrayContaining(['storage.cold', 'activity.onsite_installation']));
    expect((await c.get(`/companies/${id}/obligations?siteId=${site}`)).body).toEqual(before);
  });

  it('emlak ofisi: gıda ve montaj soruları sorulmaz; genel sorular ve kendi sorusu (sözleşme dosyası) sorulur', async () => {
    const q = (await client(env, estateToken).get(`/companies/${estateCompany}/profile-questions`)).body;
    expect(keys(q).sort()).toEqual(['activity.client_contracts', 'site.district', 'site.province', 'staff.count']);
  });

  let shop: string, shopSite: string, shopToken: string;
  const shopC = () => client(env, shopToken);
  const installTasks = async () => (await env.ownerDb.query(
    `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-ELEC-INSTALL' AND t.status <> 'cancelled'`, [shopSite])).rows[0].n as number;
  it('elektrik dükkânı satışla başlar: montaj sorusu sorulur, ama montaj görevi doğmaz; gıda kontrolü yoktur', async () => {
    const u = await newUser('Elektrik Dukkani'); shopToken = u.token;
    const r = await shopC().post('/companies', { name: 'Volt Elektrik', siteName: 'Çarşı' });
    shop = r.body.companyId; shopSite = r.body.siteId;
    expect((await shopC().post(`/companies/${shop}/activity`, { naceCodes: ['47.59'], confirmed: true })).status).toBe(201);
    const q = keys((await shopC().get(`/companies/${shop}/profile-questions`)).body);
    expect(q).toContain('activity.onsite_installation');
    expect(q).not.toContain('storage.cold');
    await shopC().post(`/companies/${shop}/profile/facts`, { siteId: shopSite, key: 'activity.onsite_installation', value: false, source: 'user_declared', verification: 'user_confirmed' });
    expect(await installTasks()).toBe(0);
    const obs = (await shopC().get(`/companies/${shop}/obligations?siteId=${shopSite}`)).body as any[];
    expect(obs.find(o => o.rule === 'EX-ELEC-INSTALL')?.decision).toBe('not_applicable');
    expect(obs.find(o => o.rule === COLD)?.decision).toBe('not_applicable');
  });
  it('sahada montajı sonradan ekleyince yalnız montaj görevi başlar; eski kayıtlar ve karar geçmişi korunur; tekrar kayıt mükerrer üretmez', async () => {
    const histBefore = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [shopSite])).rows[0].n as number;
    const res = await shopC().post(`/companies/${shop}/profile/facts`, { siteId: shopSite, key: 'activity.onsite_installation', value: true, source: 'user_declared', verification: 'user_confirmed' });
    expect(res.status).toBe(201);
    const n = await installTasks();
    expect(n).toBeGreaterThanOrEqual(1);
    const histAfter = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [shopSite])).rows[0].n as number;
    expect(histAfter).toBeGreaterThan(histBefore); // yeni karar eklendi, eskisi silinmedi
    await shopC().post(`/companies/${shop}/profile/facts`, { siteId: shopSite, key: 'activity.onsite_installation', value: true, source: 'user_declared', verification: 'user_confirmed' });
    expect(await installTasks()).toBe(n);
    expect(await coldTasks(shopSite)).toBe(0);
  });
});

describe("iki şubeli zincir: A'da üretim açık, B sonradan değişir", () => {
  it("B'ye soğuk depo sonradan eklenince yalnız B'de yeni görev başlar; A'nın görevleri ve geçmişi aynı kalır", async () => {
    const aBefore = await coldTasks(siteA);
    const bObsBefore = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [siteB])).rows[0].n as number;
    expect(await coldTasks(siteB)).toBe(0);
    await owner().post(`${C()}/profile/facts`, { siteId: siteB, key: 'storage.cold', value: true, source: 'user_declared', verification: 'user_confirmed' });
    expect(await coldTasks(siteB)).toBeGreaterThanOrEqual(1);
    expect(await coldTasks(siteA)).toBe(aBefore);
    const bObsAfter = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations WHERE site_id = $1`, [siteB])).rows[0].n as number;
    expect(bObsAfter).toBeGreaterThan(bObsBefore);
    // Fark açıklanır: karar geçmişinde "uygulanmaz → uygulanır" görünür.
    const o = ((await owner().get(`${C()}/obligations?siteId=${siteB}`)).body as any[]).find(x => x.rule === COLD);
    const why = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    expect(why.history.map((h: any) => h.decision)).toEqual(expect.arrayContaining(['not_applicable', 'applies']));
    // Aynı cevabı tekrar işlemek mükerrer görev üretmez.
    const n = await coldTasks(siteB);
    await owner().post(`${C()}/profile/facts`, { siteId: siteB, key: 'storage.cold', value: true, source: 'user_declared', verification: 'user_confirmed' });
    expect(await coldTasks(siteB)).toBe(n);
  });
});
