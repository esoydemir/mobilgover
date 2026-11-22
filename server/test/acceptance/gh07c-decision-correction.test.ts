import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GH-07 correction path. A product decision given on wrong grounds is corrected, not overwritten: the old decision, who gave it and when stay
 * visible; an open case just carries on with the new decision; a closed case is reopened so the new decision goes through closure again and
 * the earlier closure stays in the history. Public API only.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
type Cl = ReturnType<typeof client>;
const verifyAction = (by: Cl, n: string, id: string) => by.post(`${C()}/nonconformities/${n}/actions/${id}`, { op: 'verify', result: 'accepted', notes: 'Yerinde kontrol ettim, yapılmış.' });

async function fixDevice(ncr: string) {
  const N = `${C()}/nonconformities/${ncr}`;
  await manager().post(`${N}/assignment`, { ownerId: demo.users.manager.id, dueAt: new Date(Date.now() + 86400_000).toISOString() });
  await manager().post(`${N}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Conta yırtık, kapı kapanmıyor.' });
  const corr = (await manager().post(`${N}/actions`, { kind: 'correction', description: 'Geçici bant, ürünler yan dolaba.', ownerId: demo.users.manager.id })).body.id;
  await manager().post(`${N}/actions/${corr}`, { op: 'done', notes: 'Yapıldı.' });
  await verifyAction(owner(), ncr, corr);
  const ca = (await manager().post(`${N}/actions`, { kind: 'corrective_action', description: 'Contayı yenisiyle değiştir (servis).', ownerId: demo.users.manager.id })).body.id;
  await manager().post(`${N}/actions/${ca}`, { op: 'done', notes: 'Conta değişti.' });
  await verifyAction(owner(), ncr, ca);
  await owner().post(`${N}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Conta ömrünü doldurmuş.' });
  await manager().post(`${N}/steps`, { step: 'effectiveness_check', notes: 'İki gün boyunca 2–4 °C ölçüldü.' });
}
async function openCase(title: string) {
  const id = (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'Dolap sıcaklığı sınırı aştı, ürünler etkilenmiş olabilir.',
    hazardType: 'cold_chain_temperature', severity: 'critical', equipmentId: demo.fridgeId, containment: 'Ürünler yan dolaba taşındı.' })).body.id as string;
  const aid = (await manager().post(`${C()}/nonconformities/${id}/product-assessments`, { product: 'Süt – 12 L, parti 0412', quantity: 12, unit: 'L', quantityUnknown: false,
    firstAction: 'Ürünler ayrı rafa alındı.', assessorId: demo.users.manager.id })).body.id as string;
  return { id, aid, N: `${C()}/nonconformities/${id}` };
}

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
});
afterAll(async () => { await env?.close(); });

describe('wrong product decision on an OPEN case', () => {
  let k: Awaited<ReturnType<typeof openCase>>;
  it('is corrected with a reason; the old decision, person and time stay visible; nothing is duplicated', async () => {
    k = await openCase('Süt dolabı ısındı (açık vaka)');
    expect((await manager().post(`${k.N}/product-assessments/${k.aid}/decision`, { decision: 'release', rationale: 'Sıcaklık kısa süreli aştı, ürün satışa uygun.' })).status).toBe(200);
    const before = (await manager().get(k.N)).body.product.assessments[0];
    expect(before.decision.code).toBe('release');
    // a staff member cannot correct; reason is mandatory; unchanged content is refused
    expect((await staff().post(`${k.N}/product-assessments/${k.aid}/correction`, { decision: 'destroy', rationale: 'Dört saat 8 °C üstünde kaldı.', reason: 'Ölçüm kaydı sonradan incelendi, süre uzun.' })).status).toBeGreaterThanOrEqual(403);
    expect((await owner().post(`${k.N}/product-assessments/${k.aid}/correction`, { decision: 'destroy', rationale: 'Dört saat 8 °C üstünde kaldı.', reason: 'kısa' })).status).toBe(422);
    expect((await owner().post(`${k.N}/product-assessments/${k.aid}/correction`, { decision: 'release', rationale: 'Sıcaklık kısa süreli aştı, ürün satışa uygun.', reason: 'Hiçbir şey değişmedi ama düzeltme dedim.' })).status).toBe(422);
    const r = await owner().post(`${k.N}/product-assessments/${k.aid}/correction`, { decision: 'destroy', rationale: 'Dört saat 8 °C üstünde kaldı; süt imha edilecek.', reason: 'Veri kaydedici dökümü sonradan okundu: aşım 4 saati geçmiş.' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: 'corrected', decision: 'destroy', reopened: false });
    const p = (await manager().get(k.N)).body.product;
    expect(p.assessments).toHaveLength(1);
    expect(p.assessments[0].decision.code).toBe('destroy');
    expect(p.assessments[0].corrections).toHaveLength(1);
    expect(p.assessments[0].corrections[0]).toMatchObject({ previous: { code: 'release', by: expect.any(String) }, now: { code: 'destroy' }, correctedBy: expect.any(String), caseWasClosed: false });
    expect(p.assessments[0].corrections[0].reason).toMatch(/Veri kaydedici/);
    expect((await manager().get(k.N)).body.status).not.toBe('closed');
  });
  it('the audit trail names who changed what, and the correction needs a decided assessment', async () => {
    const ev = (await env.ownerDb.query(`SELECT event_type, payload FROM audit_events WHERE entity_id = $1 AND event_type IN ('nonconformity.product_decided','nonconformity.product_decision_corrected') ORDER BY seq`, [k.id])).rows;
    expect(ev.map(e => e.event_type)).toEqual(['nonconformity.product_decided', 'nonconformity.product_decision_corrected']);
    expect(ev[1].payload).toMatchObject({ previous: { decision: 'release' }, now: { decision: 'destroy' }, caseWasClosed: false });
    const k2 = await openCase('Karar yok henüz');
    expect((await owner().post(`${k2.N}/product-assessments/${k2.aid}/correction`, { decision: 'destroy', rationale: 'Henüz karar yok ama dene.', reason: 'Karar verilmeden düzeltme denemesi yapılıyor.' })).status).toBe(409);
  });
});

describe('wrong product decision on a CLOSED case', () => {
  it('reopens the case, keeps the earlier closure in history, and the new decision must pass closure again', async () => {
    const k = await openCase('Süt dolabı ısındı (kapalı vaka)');
    await fixDevice(k.id);
    expect((await manager().post(`${k.N}/product-assessments/${k.aid}/decision`, { decision: 'release', rationale: 'Sıcaklık kısa süreli aştı, ürün satışa uygun.' })).status).toBe(200);
    expect((await owner().post(`${k.N}/verify`, { result: 'effective', notes: 'Cihaz düzeldi, ölçümler normal.' })).status).toBe(200);
    expect((await owner().get(k.N)).body.status).toBe('closed');
    const r = await owner().post(`${k.N}/product-assessments/${k.aid}/correction`, { decision: 'return_supplier', rationale: 'Parti numarası geri çağırma listesinde çıktı; tedarikçiye iade.', reason: 'Tedarikçi geri çağırma bildirimi kapanıştan sonra geldi.' });
    expect(r.status).toBe(200);
    expect(r.body.reopened).toBe(true);
    const d = (await owner().get(k.N)).body;
    expect(d.status).not.toBe('closed');
    expect(d.product.assessments[0].corrections[0]).toMatchObject({ previous: { code: 'release' }, now: { code: 'return_supplier' }, caseWasClosed: true });
    const hist = (await env.ownerDb.query(`SELECT result FROM ncr_verifications WHERE ncr_id = $1 ORDER BY verified_at`, [k.id])).rows.map(x => x.result);
    expect(hist).toEqual(expect.arrayContaining(['effective', 'reopened']));
    const types = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE entity_id = $1`, [k.id])).rows.map(x => x.event_type);
    expect(types).toEqual(expect.arrayContaining(['nonconformity.reopened', 'nonconformity.product_decision_corrected']));
  });
});
