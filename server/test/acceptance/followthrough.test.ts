import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { createSession } from '../../src/services/principal';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Delivery 6A: one look at a case (stage, who is next, what is missing), the critical first step
 * before any suggestion, several suggestions for several causes (set aside with a reason), linked
 * records, a new measurement in the effectiveness check, a new round after a failed check with the
 * earlier round kept, independence in the new round, and an outside verifier who cannot reach other
 * cases, photos or documents by a direct link. Real HTTP + PostgreSQL; limits are EXAMPLES.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let ncr: string;
const N = () => `${C()}/nonconformities/${ncr}`;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 2);
  // A fridge check out of limit, completed by the owner: a nonconformity with the measurement.
  const task = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND template_code = 'fridge_temp' AND status = 'open' ORDER BY due_at LIMIT 1`, [demo.companyId])).rows[0].id;
  await owner().post(`${C()}/tasks/${task}/measurements`, { quantity: 'temperature', value: 11, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId });
  const img = fakeJpeg('fridge-11');
  const ev = (await owner().post(`${C()}/tasks/${task}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(img), sizeBytes: img.length })).body;
  await owner().put(`${C()}/evidence/${ev.id}/content`, img, 'image/jpeg');
  await owner().post(`${C()}/tasks/${task}/evidence`, { kind: 'note', text: 'Kapı contası yırtık, ürünler yedek üniteye alındı.' });
  ncr = (await owner().post(`${C()}/tasks/${task}/complete`, { clientCompletedAt: new Date().toISOString() })).body.nonconformityId;
});
afterAll(async () => { await env?.close(); });

describe('one look at a case', () => {
  it('a high-risk case shows the first step before any suggestion; then who is next and what is missing', async () => {
    let d = (await manager().get(N())).body;
    expect(['high', 'critical']).toContain(d.risk_level);
    expect(d.firstAction.items.map((i: any) => i.key)).toEqual(['containment', 'assignment']);
    expect(d.firstAction.note).toContain('ilk işlemlerden sonra');
    // An example limit never reads as a legal one: the case title says so.
    expect(d.title).toContain('ÖRNEK limit, doğrulanmadı');
    expect(d.next).toMatchObject({ stage: 'containment', mine: true });
    expect(d.progress.total).toBe(d.flow.stages.length);
    expect(d.closureMissing.length).toBe(d.progress.total - d.progress.done);
    await manager().post(`${N()}/steps`, { step: 'containment', notes: 'Ürünler yedek üniteye taşındı.' });
    await manager().post(`${N()}/assignment`, { ownerId: demo.users.manager.id, dueAt: later(24) });
    d = (await manager().get(N())).body;
    expect(d.firstAction).toBeNull();
    expect(d.next).toMatchObject({ stage: 'cause', who: expect.stringContaining('Selin'), mine: true });
    // Staff who have no part in the case do not see it at all.
    expect((await staff().get(N())).status).toBe(404);
  });

  it('several causes give several suggestions; one is set aside with a reason, kept in the history', async () => {
    await manager().post(`${N()}/causes`, { stage: 'initial', categories: ['knowledge', 'equipment', 'process'], notes: 'Conta yırtık, personel kapıyı kontrol etmiyor, sorumlu belirsiz.' });
    const d = (await manager().get(N())).body;
    const keys = d.suggestions.map((s: any) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['knowledge:training', 'equipment:equipment_history', 'equipment:service_request', 'process:assign', 'process:follow_up']));
    expect(d.suggestions.find((s: any) => s.key === 'equipment:service_request').serviceCategory).toBe('refrigeration_service');
    expect(d.suggestions.find((s: any) => s.key === 'equipment:equipment_history').equipmentId).toBe(demo.fridgeId);
    expect(d.suggestions.find((s: any) => s.key === 'knowledge:training').body).toMatch(/ilgili \d+ eğitim/);
    expect((await manager().post(`${N()}/suggestions`, { key: 'process:follow_up', decision: 'dismissed', reason: 'kısa' })).status).toBe(422);
    const ok = await manager().post(`${N()}/suggestions`, { key: 'process:follow_up', decision: 'dismissed', reason: 'Sorumlu atandı; ayrıca takip aksiyonu gerekmiyor.', replacement: 'Haftalık kontrol listesine eklendi.' });
    expect(ok.body.changed).toBe(true);
    // Sent again (offline retry without a key): no second decision.
    expect((await manager().post(`${N()}/suggestions`, { key: 'process:follow_up', decision: 'dismissed', reason: 'Sorumlu atandı; ayrıca takip aksiyonu gerekmiyor.' })).body.changed).toBe(false);
    const after = (await manager().get(N())).body;
    expect(after.suggestions.find((s: any) => s.key === 'process:follow_up').dismissed).toMatchObject({ replacement: 'Haftalık kontrol listesine eklendi.' });
    expect(after.history.some((h: any) => h.event_type === 'nonconformity.suggestion_decided')).toBe(true);
  });

  it('equipment history: earlier cases and documents; staff see neither other cases nor measurements', async () => {
    const h = (await manager().get(`${C()}/equipment/${demo.fridgeId}/history`)).body;
    expect(h.cases.map((c: any) => c.id)).toContain(ncr);
    expect(h.measurements.length).toBeGreaterThan(0);
    const s = (await staff().get(`${C()}/equipment/${demo.fridgeId}/history`)).body;
    expect(s.cases).toEqual([]);
    expect(s.measurements).toEqual([]);
  });
});

describe('effectiveness with a new measurement, a new round and independence', () => {
  let a1: string, a2: string;
  it('actions are verified by someone without a part; a value still out of limit is refused', async () => {
    a1 = (await manager().post(`${N()}/actions`, { kind: 'correction', description: 'Contayı değiştir.' })).body.id;
    a2 = (await manager().post(`${N()}/actions`, { kind: 'corrective_action', description: 'Conta kontrolünü bakım planına ekle.' })).body.id;
    for (const a of [a1, a2]) await manager().post(`${N()}/actions/${a}`, { op: 'done', notes: 'Yapıldı, fotoğraf ekte değil.' });
    let d = (await manager().get(N())).body;
    expect(d.next).toMatchObject({ stage: 'actions', mine: false });
    expect(d.next.what).toContain('"yapıldı" beyanını');
    for (const a of [a1, a2]) expect((await owner().post(`${N()}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Yerinde baktım.' })).status).toBe(200);
    await owner().post(`${N()}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Conta yırtığı sıcaklık kaydıyla örtüşüyor.' });
    const out = await manager().post(`${N()}/steps`, { step: 'effectiveness_check', notes: 'Yeni ölçüm aldım.', measurement: { value: 9 } });
    expect(out.body.error.code).toBe('MEASUREMENT_OUT_OF_LIMIT');
    expect(out.body.error.message).toContain('limit dışında');
    expect((await manager().post(`${N()}/steps`, { step: 'effectiveness_check', notes: 'Conta sonrası iki gün 3 °C.', measurement: { value: 3 } })).status).toBe(201);
    d = (await manager().get(N())).body;
    const eff = d.steps.find((s: any) => s.step === 'effectiveness_check');
    expect(eff.data.measurement).toMatchObject({ value: 3, unit: '°C', within: true, limitMax: 4 });
    expect(d.next).toMatchObject({ stage: 'verification' });
  });

  it('not effective → round 2; round 1 people and decisions stay; the doer of round 2 cannot close it', async () => {
    await owner().post(`${N()}/verify`, { result: 'not_effective', notes: 'Ertesi sabah yine 7 °C ölçüldü, kapı menteşesi de sorunlu.' });
    let d = (await manager().get(N())).body;
    expect(d.iteration).toBe(2);
    expect(d.actions.filter((a: any) => a.iteration === 1).every((a: any) => a.verified_by_name)).toBe(true);
    expect(d.verifications.at(-1)).toMatchObject({ iteration: 1, result: 'not_effective' });
    expect(d.next.stage).toBe('actions');
    const a3 = (await manager().post(`${N()}/actions`, { kind: 'correction', description: 'Menteşeyi ayarla.' })).body.id;
    await manager().post(`${N()}/actions/${a3}`, { op: 'done', notes: 'Menteşe ayarlandı.' });
    await owner().post(`${N()}/actions/${a3}`, { op: 'verify', result: 'accepted', notes: 'Kapı kendiliğinden kapanıyor.' });
    // A full CAPA needs the root cause confirmed again in the new round.
    await owner().post(`${N()}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Menteşe ve conta birlikte; ölçümler destekliyor.' });
    await manager().post(`${N()}/steps`, { step: 'effectiveness_check', notes: 'Üç gün 2–4 °C.', measurement: { value: 3.5 } });
    d = (await manager().get(N())).body;
    expect(d.permissions.verify).toBe(false);
    expect((await manager().post(`${N()}/verify`, { result: 'effective', notes: 'Kontrol ettim, çalışıyor.' })).body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
    expect((await owner().post(`${N()}/verify`, { result: 'effective', notes: 'Kendi ölçümümle 3 °C.' })).body.status).toBe('closed');
    d = (await manager().get(N())).body;
    expect(d.next.stage).toBe('closed');
  });
});

describe('an outside verifier only reaches the case they were invited to', () => {
  it('another case, its photo, a document and equipment history are not reachable by a direct link', async () => {
    const other = (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Başka kayıt: depo', description: 'Raf tozlu.', hazardType: 'cleaning', severity: 'minor', containment: 'Alan silindi.' })).body.id;
    const O = `${C()}/nonconformities/${other}`;
    const act = (await manager().post(`${O}/actions`, { kind: 'correction', description: 'Rafı temizle.' })).body.id;
    const img = fakeJpeg('raf-foto');
    const ev = (await manager().post(`${O}/actions/${act}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(img), sizeBytes: img.length })).body;
    await manager().put(`${C()}/evidence/${ev.id}/content`, img, 'image/jpeg');
    const doc = (await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'İşyeri ruhsatı', siteId: null })).body.id;
    // Invite for the closed fridge case only.
    expect((await owner().post(`${C()}/verifiers`, { email: 'tek.kayit@ornek.test', days: 7, note: 'Yalnız soğutucu kaydı', ncrIds: [ncr] })).status).toBe(201);
    const v = await env.db.system(async tx => {
      const u = (await tx.query(`SELECT id FROM users WHERE email = 'tek.kayit@ornek.test'`)).rows[0].id as string;
      return client(env, await createSession(tx, u));
    });
    expect((await v.get(N())).status).toBe(200);
    expect((await v.get(O)).status).toBe(404);
    expect((await v.get(`${C()}/evidence/${ev.id}/content`)).status).toBe(404);
    expect((await v.get(`${C()}/documents/${doc}`)).status).toBe(404);
    expect((await v.get(`${C()}/equipment/${demo.fridgeId}/history`)).status).toBe(404);
    expect((await v.get(`${C()}/nonconformities`)).body.map((x: any) => x.id)).toEqual([ncr]);
    // The manager can reach the photo; the owner of the other case too.
    expect((await manager().get(`${C()}/evidence/${ev.id}/content`)).status).toBe(200);
    // Once the grant is revoked, the invited case is closed to them as well.
    const g = (await owner().get(`${C()}/verifiers`)).body.find((x: any) => x.email === 'tek.kayit@ornek.test' || x.user_email === 'tek.kayit@ornek.test') ?? (await owner().get(`${C()}/verifiers`)).body[0];
    await owner().post(`${C()}/verifiers/${g.id}/revoke`, { reason: 'Doğrulama tamamlandı.' });
    expect((await v.get(N())).status).toBe(404);
  });
});
