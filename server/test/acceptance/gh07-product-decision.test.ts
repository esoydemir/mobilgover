import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GH-07: the device being fixed and the fate of the product are separate decisions.
 * Public API only. The cold-chain case: containment, cause, repair, effectiveness check all done and the cabinet measures normal,
 * while the product decision stays open and keeps the case from closing.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let plainSite: string;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
type Cl = ReturnType<typeof client>;
const verifyAction = (by: Cl, n: string, id: string) => by.post(`${C()}/nonconformities/${n}/actions/${id}`, { op: 'verify', result: 'accepted', notes: 'Yerinde kontrol ettim, yapılmış.' });

/** Device side only: the manager fixes and measures, the owner (not a performer) verifies each step. */
async function fixDevice(ncr: string) {
  const N = `${C()}/nonconformities/${ncr}`;
  await manager().post(`${N}/assignment`, { ownerId: demo.users.manager.id, dueAt: new Date(Date.now() + 86400_000).toISOString() });
  await manager().post(`${N}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Conta yırtık, kapı kapanmıyor.' });
  const corr = (await manager().post(`${N}/actions`, { kind: 'correction', description: 'Geçici bant, ürünler yan dolaba.', ownerId: demo.users.manager.id })).body.id;
  await manager().post(`${N}/actions/${corr}`, { op: 'done', notes: 'Yapıldı.' });
  expect((await verifyAction(owner(), ncr, corr)).status).toBe(200);
  const ca = (await manager().post(`${N}/actions`, { kind: 'corrective_action', description: 'Contayı yenisiyle değiştir (servis).', ownerId: demo.users.manager.id })).body.id;
  await manager().post(`${N}/actions/${ca}`, { op: 'done', notes: 'Conta değişti.' });
  expect((await verifyAction(owner(), ncr, ca)).status).toBe(200);
  await owner().post(`${N}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Conta ömrünü doldurmuş.' });
  expect((await manager().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'İki gün boyunca 2–4 °C ölçüldü.' })).status).toBe(201);
}
const cold = async (title: string, by: Cl = manager()) => (await by.post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Dolap sıcaklığı sınırı aştı, ürünler etkilenmiş olabilir.',
  hazardType: 'cold_chain_temperature', severity: 'critical', equipmentId: demo.fridgeId, containment: 'Ürünler yan dolaba taşındı.' })).body.id as string;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  plainSite = (await env.db.system(async tx => (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Montaj deposu') RETURNING id`, [demo.companyId])).rows[0].id)) as string;
});
afterAll(async () => { await env?.close(); });

describe('sectors without a product effect', () => {
  it('see no product fields, and cannot open an assessment', async () => {
    const r = await owner().post(`${C()}/nonconformities`, { siteId: plainSite, title: 'Merdiven korkuluğu gevşek', description: 'Depodaki merdiven korkuluğu oynuyor.', hazardType: 'other', severity: 'major', equipmentId: null, containment: null });
    expect(r.status).toBe(201);
    const d = (await owner().get(`${C()}/nonconformities/${r.body.id}`)).body;
    expect(d.product).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/closureBlocker/);
    const a = await owner().post(`${C()}/nonconformities/${r.body.id}/product-assessments`, { product: 'Parti 1', quantity: 5, quantityUnknown: false, firstAction: 'Ayrıldı', assessorId: demo.users.manager.id });
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe('PRODUCT_NOT_APPLICABLE');
  });
});

describe('cold-chain case: device fixed, product undecided', () => {
  let ncr: string, aid: string;
  const N = () => `${C()}/nonconformities/${ncr}`;

  it('a cold-chain case in a product sector needs a product decision from the start, and says so', async () => {
    ncr = await cold('Soğutucu sıcaklığı aşıldı');
    const d = (await manager().get(N())).body;
    expect(d.product).toMatchObject({ applies: true, suggested: true, required: true, openCount: 0 });
    expect(d.product.suggestionText).toMatch(/ürün etkilenmiş olabilir/);
    expect(d.product.closureBlocker).toMatch(/ürün etkisi yok/);
    expect(d.closureMissing.map((x: any) => x.stage)).not.toContain('product_decision'); // device side is reported separately
  });

  it('with no assessment at all, a fixed device still cannot be closed', async () => {
    const bare = await cold('Vitrin sıcaklığı yüksek');
    await fixDevice(bare);
    const v = await owner().post(`${C()}/nonconformities/${bare}/verify`, { result: 'effective', notes: 'Cihaz düzeldi.' });
    expect(v.status).toBe(422);
    expect(v.body.error.code).toBe('PRODUCT_DECISION_OPEN');
    expect(v.body.error.message).toMatch(/ürün etkisi yok/);
  });

  it('an assessment needs product, first measure and either a quantity or an explicit "unknown"', async () => {
    const base = { product: 'Süt – 12 L, parti 0412', firstAction: 'Ürünler ayrı rafa alındı, kullanım durduruldu.', assessorId: demo.users.manager.id };
    expect((await manager().post(`${N()}/product-assessments`, { ...base, quantity: null, quantityUnknown: false })).status).toBe(422); // neither
    expect((await manager().post(`${N()}/product-assessments`, { ...base, quantity: 12, quantityUnknown: true })).status).toBe(422);    // both
    expect((await manager().post(`${N()}/product-assessments`, { ...base, firstAction: 'x', quantity: 12, quantityUnknown: false })).status).toBe(422);
    const outsider = await env.ownerDb.query(`INSERT INTO users (display_name) VALUES ('Dışarıdan') RETURNING id`);
    expect((await manager().post(`${N()}/product-assessments`, { ...base, quantity: 12, quantityUnknown: false, assessorId: outsider.rows[0].id })).status).toBe(422);
    const ok = await manager().post(`${N()}/product-assessments`, { ...base, quantity: null, quantityUnknown: true });
    expect(ok.status).toBe(201);
    aid = ok.body.id;
    const d = (await manager().get(N())).body.product;
    expect(d).toMatchObject({ openCount: 1, unknownQuantity: true, required: true, suggested: false });
    expect((await manager().get(N())).body.product.closureBlocker).toMatch(/karar/);
    expect(d.assessments[0]).toMatchObject({ state: 'open', quantity: null, quantityUnknown: true, assessor: { name: expect.any(String) } });
  });

  it('the cabinet is fixed and measures normal, yet the case cannot close while the product decision is open', async () => {
    await fixDevice(ncr);
    const d = (await manager().get(N())).body;
    expect(d.status).toBe('awaiting_verification');
    expect(d.flow.stages.filter((s: any) => s.state !== 'done').map((s: any) => s.key)).toHaveLength(1); // device side complete; only the closure verification itself remains
    const v = await owner().post(`${N()}/verify`, { result: 'effective', notes: 'Cihaz düzeldi, ölçümler normal.' });
    expect(v.status).toBe(422);
    expect(v.body.error.code).toBe('PRODUCT_DECISION_OPEN');
    expect((await owner().get(N())).body.status).toBe('awaiting_verification');
  });

  it('only the named assessor or a case manager decides; the reason is written; a decision is final', async () => {
    expect((await staff().post(`${N()}/product-assessments/${aid}/decision`, { decision: 'destroy', rationale: 'Sıcaklık sınırı aşıldı, imha.' })).status).toBeGreaterThanOrEqual(403);
    expect((await manager().post(`${N()}/product-assessments/${aid}/decision`, { decision: 'destroy', rationale: 'kısa' })).status).toBe(422);
    const r = await manager().post(`${N()}/product-assessments/${aid}/decision`, { decision: 'destroy', rationale: 'Dört saatten fazla 8 °C üstünde kaldı; süt imha edildi.' });
    expect(r.status).toBe(200);
    expect((await manager().post(`${N()}/product-assessments/${aid}/decision`, { decision: 'release', rationale: 'Fikrimi değiştirdim.' })).status).toBe(409);
    const d = (await manager().get(N())).body.product;
    expect(d.assessments[0].decision).toMatchObject({ code: 'destroy', label: 'İmha', by: expect.any(String) });
    expect(d.closureBlocker).toBeNull();
  });

  it('with the decision recorded, the independent verifier closes the case; audit trail keeps both decisions apart', async () => {
    const v = await owner().post(`${N()}/verify`, { result: 'effective', notes: 'Cihaz ve ürün kararı incelendi.' });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('closed');
    const types = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE entity_id = $1 AND event_type LIKE 'nonconformity.%' ORDER BY seq`, [ncr])).rows.map(r => r.event_type);
    expect(types).toEqual(expect.arrayContaining(['nonconformity.product_assessment_opened', 'nonconformity.product_decided', 'nonconformity.closed']));
  });

  it('the audit file lists the device steps and the product decision in separate blocks', async () => {
    const from = new Date(Date.now() - 86400_000).toISOString(), to = new Date(Date.now() + 86400_000).toISOString();
    const rep = (await owner().get(`${C()}/audit-report?format=json&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body;
    const c = rep.sections.closures.cases.find((x: any) => x.id === ncr);
    expect(c.product).toHaveLength(1);
    expect(c.product[0]).toMatchObject({ product: 'Süt – 12 L, parti 0412', quantity: 'MİKTAR BİLİNMİYOR' });
    expect(c.product[0].decision).toMatch(/İmha/);
    expect(c.sequence.some((e: any) => /Etkinlik kontrolü/.test(e.text))).toBe(true);
    expect(c.sequence.some((e: any) => /İmha|Ürün kararı/.test(e.text))).toBe(false); // product decision is not mixed into the device sequence
    const pdf = await owner().get(`${C()}/audit-report?format=pdf&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(pdf.status).toBe(200);
  });
});

describe('"no product effect" is an authorized, written assessment', () => {
  it('a person who may verify closure can record it with a long reason; others cannot; then the case can close', async () => {
    const ncr = await cold('Dondurucu kapısı aralık kaldı');
    const N = `${C()}/nonconformities/${ncr}`;
    const a = await manager().post(`${N}/product-assessments`, { product: 'Etkilenen ürün yok', quantity: 0, unit: 'adet', quantityUnknown: false, firstAction: 'İçerik kontrol edildi, sıcaklık sınırda kaldı.', assessorId: demo.users.manager.id });
    expect(a.status).toBe(201);
    await fixDevice(ncr);
    expect((await owner().post(`${N}/verify`, { result: 'effective', notes: 'Cihaz düzeldi.' })).body.error.code).toBe('PRODUCT_DECISION_OPEN');
    const dec = `${N}/product-assessments/${a.body.id}/decision`;
    expect((await staff().post(dec, { decision: 'no_product_effect', rationale: 'Ürün etkilenmedi, kontrol ettim ve emin oldum.' })).status).toBeGreaterThanOrEqual(403);
    expect((await owner().post(dec, { decision: 'no_product_effect', rationale: 'Ürün yok gibi.' })).status).toBe(422); // reason too short for this decision
    expect((await owner().post(dec, { decision: 'no_product_effect', rationale: 'Dondurucu içeriği ölçüldü; çekirdek sıcaklık -15 °C üstüne çıkmadı, ürün etkilenmedi.' })).status).toBe(200);
    expect((await owner().post(`${N}/verify`, { result: 'effective', notes: 'Cihaz ve ürün değerlendirmesi incelendi.' })).body.status).toBe('closed');
  });
});
