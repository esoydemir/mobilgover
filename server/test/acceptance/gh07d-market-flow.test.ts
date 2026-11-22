import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFoodScopeRevision, ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { topUpSite } from '../../src/services/tasks';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * First user tour at API level (public routes only; the only non-API step is the hourly top-up job and the rule review/publish flow, both real processes).
 *
 * EXPECTED, written before the run, from the approved scope of the EXAMPLE cold-chain check:
 *   v1 (published first): applies only where food is prepared AND cold product is kept  → a market that only sells chilled dairy: NOT applicable (the gap).
 *   v2 (scope revision, normal review): applies to food businesses that keep cold product → market with cold = yes: applies.
 *   branch answered "no"         → not applicable, 0 tasks, no product card, no equipment prompt.
 *   branch not answered          → needs info (asks storage.cold), 0 tasks, product card asks the question, nothing is blocked or guessed.
 *   "no" + a fridge is registered → still 0 tasks, but the person is asked which is true (conflict).
 *   estate office with a staff fridge → no food task, no question, no product card.
 */
let env: Env;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const COLD = 'EX-COLD-CHAIN';
const evidence: Record<string, unknown>[] = [];
const log = (step: string, result: unknown) => { evidence.push({ step, result }); };

const newUser = async (name: string) => {
  const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `${name.replace(/\W/g, '').toLowerCase()}@test.invalid`])).rows[0].id as string;
  return { id, token: await env.db.system(tx => createSession(tx, id, 24)) };
};
const tasksOf = async (siteId: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = $2 AND t.status <> 'cancelled'`, [siteId, COLD])).rows[0].n as number;
const todayTasksOf = async (siteId: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = $2 AND t.status <> 'cancelled'
      AND t.due_at = (SELECT min(t2.due_at) FROM tasks t2 JOIN rules r2 ON r2.id = t2.rule_id WHERE t2.site_id = $1 AND r2.code = $2 AND t2.status <> 'cancelled')`, [siteId, COLD])).rows[0].n as number;
const notifications = async (siteId: string) => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM notifications WHERE site_id = $1`, [siteId])).rows[0].n as number;
const fact = (o: ReturnType<typeof client>, c: string, siteId: string, key: string, value: boolean) => o.post(`/companies/${c}/profile/facts`, { siteId, key, value, source: 'user_declared', verification: 'user_confirmed' });
const decisionOf = async (o: ReturnType<typeof client>, c: string, siteId: string) => ((await o.get(`/companies/${c}/obligations?siteId=${siteId}`)).body as any[]).find(x => x.rule === COLD);
const gaps = async (o: ReturnType<typeof client>, c: string, siteId?: string) => ((await o.get(`/companies/${c}/board`)).body.sections.gaps as any[]).filter(g => g.ruleCode === COLD && (!siteId || g.siteId === siteId));
const versionOfTask = async (taskId: string) => (await env.ownerDb.query(
  `SELECT rv.version FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id WHERE t.id = $1`, [taskId])).rows[0].version as number;

beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); await ensureSectorRules(env.db); });
afterAll(async () => { console.log('EVIDENCE ' + JSON.stringify(evidence)); await env?.close(); });

// ── people and companies ──
let market: { id: string; a: string; b: string; owner: ReturnType<typeof client> };
let cafe: { id: string; a: string; owner: ReturnType<typeof client> };
let cafeTaskV1: string;

describe('0 · the gap of the first version (v1), shown before it is fixed', () => {
  it('a café (prepares food, cold product, fridge) gets its task and completes it with evidence under v1', async () => {
    const o = await newUser('Kafe Sahibi'); const c = client(env, o.token);
    const r = await c.post('/companies', { name: 'Moda Kafe', siteName: 'Moda' });
    cafe = { id: r.body.companyId, a: r.body.siteId, owner: c };
    expect((await c.post(`/companies/${cafe.id}/activity`, { naceCodes: ['56.10'], confirmed: true })).status).toBe(201);
    await fact(c, cafe.id, cafe.a, 'storage.cold', true);
    expect((await c.post(`/companies/${cafe.id}/equipment`, { siteId: cafe.a, type: 'refrigerator', name: 'Kafe dolabı' })).status).toBe(201);
    const t = ((await c.get(`/companies/${cafe.id}/tasks?siteId=${cafe.a}&status=open`)).body as any[]).find(x => x.title === 'Soğutucu sıcaklık kontrolü')!;
    cafeTaskV1 = t.id;
    expect(await versionOfTask(cafeTaskV1)).toBe(1);
    const w = await newUser('Kafe Calisan');
    await c.post(`/companies/${cafe.id}/members`, { email: 'kafecalisan@test.invalid', role: 'staff', siteId: cafe.a });
    const wc = client(env, w.token);
    const inv = (await wc.get('/me/invitations')).body as any[];
    await wc.post(`/me/invitations/${inv[0].membershipId ?? inv[0].id}/accept`);
    await c.post(`/companies/${cafe.id}/tasks/${cafeTaskV1}/assign`, { userId: w.id });
    await wc.post(`/companies/${cafe.id}/tasks/${cafeTaskV1}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString() });
    const photo = fakeJpeg('kafe-termometre');
    const reg = await wc.post(`/companies/${cafe.id}/tasks/${cafeTaskV1}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    await wc.put(`/companies/${cafe.id}/evidence/${reg.body.id}/content`, photo, 'image/jpeg');
    expect((await wc.post(`/companies/${cafe.id}/tasks/${cafeTaskV1}/complete`)).status).toBe(200);
    log('café task completed under rule version', { taskId: cafeTaskV1, version: await versionOfTask(cafeTaskV1) });
  });

  it('a new market owner picks "market" (NACE 47.11), says "I sell chilled product", has no fridge registered: v1 does not apply (the gap)', async () => {
    const o = await newUser('Market Sahibi'); const c = client(env, o.token);
    const r = await c.post('/companies', { name: 'Yeşil Market', siteName: 'Market A' });
    const b = await c.post(`/companies/${r.body.companyId}/sites`, { name: 'Depo B' });
    market = { id: r.body.companyId, a: r.body.siteId, b: b.body.id, owner: c };
    expect((await c.post(`/companies/${market.id}/activity`, { naceCodes: ['47.11'], confirmed: true })).status).toBe(201);
    await fact(c, market.id, market.a, 'storage.cold', true);
    await fact(c, market.id, market.b, 'storage.cold', false);
    const prof = (await c.get(`/companies/${market.id}/sites/${market.a}/profile`)).body;
    expect(prof['activity.food_preparation'].value).toBe(false);
    expect(prof['activity.food_business'].value).toBe(true);
    const d = await decisionOf(c, market.id, market.a);
    expect(d.decision).toBe('not_applicable'); // v1: needs food preparation
    log('v1: market A decision', { decision: d.decision, ruleVersion: d.ruleVersion ?? d.version ?? 1 });
  });
});

describe('1 · the scope revision goes through the normal review and publish flow', () => {
  let moved: { code: string; from: number; to: number }[];
  it('v2 is drafted, area-reviewed, approved and published; v1 is retired, never edited', async () => {
    moved = await ensureFoodScopeRevision(env.db);
    expect(moved.map(m => m.code)).toContain(COLD); // the report-rule revisions follow where those rules were published
    expect(moved.every(m => m.from === 1 && m.to === 2)).toBe(true);
    const vs = (await env.ownerDb.query(`SELECT rv.version, rv.status, rv.condition, rv.change_reason, rv.is_example FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 ORDER BY rv.version`, [COLD])).rows;
    expect(vs.map(v => [v.version, v.status])).toEqual([[1, 'retired'], [2, 'published']]);
    expect(JSON.stringify(vs[0].condition)).toContain('activity.food_preparation'); // v1 untouched
    expect(JSON.stringify(vs[1].condition)).toContain('activity.food_business');
    expect(vs.every(v => v.is_example)).toBe(true);
    const flow = (await env.ownerDb.query(`SELECT event_type FROM audit_events WHERE entity_type = 'rule_version' AND payload->>'code' = $1 OR (entity_type = 'rule_version' AND entity_id IN (SELECT rv.id::text FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND rv.version = 2)) ORDER BY seq`, [COLD])).rows.map(x => x.event_type);
    expect(flow).toEqual(expect.arrayContaining(['rule.drafted', 'rule.published']));
    log('rule versions', { code: COLD, versions: vs.map(v => ({ v: v.version, status: v.status, reason: v.change_reason })), moved });
  });
  it('the café\'s completed task stays bound to v1; its new periods come from v2', async () => {
    expect(await versionOfTask(cafeTaskV1)).toBe(1);
    expect((await cafe.owner.get(`/companies/${cafe.id}/tasks/${cafeTaskV1}`)).body.rule.version).toBe(1);
    // the hourly top-up (real job) reaches past the horizon that was generated under v1
    await env.db.system(tx => topUpSite(tx, cafe.id, cafe.a, 30));
    const rows = (await env.ownerDb.query(
      `SELECT rv.version, count(*)::int AS n FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id
        WHERE t.site_id = $1 AND r.code = $2 GROUP BY rv.version ORDER BY rv.version`, [cafe.a, COLD])).rows;
    expect(rows.map(r => r.version)).toEqual([1, 2]);
    expect(rows.find(r => r.version === 2).n).toBeGreaterThan(0);
    log('café tasks by rule version', rows);
    expect(await versionOfTask(cafeTaskV1)).toBe(1);
  });
});

describe('2 · a new market owner is never left in a dead end', () => {
  let taskId: string; let managerId: string; let workerId: string;
  it('applies now, but no fridge is registered: the home screen says what is missing and offers "Dolap ekle"; tasks are 0', async () => {
    const d = await decisionOf(market.owner, market.id, market.a);
    expect(d.decision).toBe('applies');
    expect(await tasksOf(market.a)).toBe(0);
    const g = await gaps(market.owner, market.id, market.a);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'equipment', equipmentType: 'refrigerator', siteId: market.a, action: { kind: 'add_equipment', label: 'Dolap ekle', equipmentType: 'refrigerator', siteId: market.a } });
    expect(g[0].message).toMatch(/Soğuk ürün satışı için ekipman bilgisi eksik/);
    expect(await gaps(market.owner, market.id, market.b)).toHaveLength(0); // B said "no"
    log('market A before fridge', { tasks: 0, gap: g[0].message, action: g[0].action.label });
  });
  it('the fridge is registered from that action: tasks go 0 → 1; re-saving the profile keeps 1; the other branch gets nothing', async () => {
    const g = (await gaps(market.owner, market.id, market.a))[0];
    expect((await market.owner.post(`/companies/${market.id}/equipment`, { siteId: g.action.siteId, type: g.action.equipmentType, name: 'Süt ürünleri dolabı' })).status).toBe(201);
    expect(await todayTasksOf(market.a)).toBe(1);
    expect(await gaps(market.owner, market.id, market.a)).toHaveLength(0);
    const before = await tasksOf(market.a);
    for (let i = 0; i < 2; i++) {
      expect((await market.owner.post(`/companies/${market.id}/activity`, { naceCodes: ['47.11'], confirmed: true })).status).toBe(201);
      expect((await fact(market.owner, market.id, market.a, 'storage.cold', true)).status).toBe(201);
    }
    expect(await tasksOf(market.a)).toBe(before);
    expect(await todayTasksOf(market.a)).toBe(1);
    expect(await tasksOf(market.b)).toBe(0);
    expect(await notifications(market.b)).toBe(0);
    log('market A after fridge', { periodTasks: 1, afterResave: await todayTasksOf(market.a), branchB: await tasksOf(market.b), branchBNotifications: await notifications(market.b) });
  });
  it('the manager assigns, the worker completes with evidence on his own account; every step carries the same task id', async () => {
    const mgr = await newUser('Market Yonetici'); const wrk = await newUser('Market Calisan');
    managerId = mgr.id; workerId = wrk.id;
    expect((await market.owner.post(`/companies/${market.id}/members`, { email: 'marketyonetici@test.invalid', role: 'site_manager', siteId: market.a })).status).toBe(201);
    expect((await market.owner.post(`/companies/${market.id}/members`, { email: 'marketcalisan@test.invalid', role: 'staff', siteId: market.a })).status).toBe(201);
    const m = client(env, mgr.token), w = client(env, wrk.token);
    for (const c of [m, w]) { const inv = (await c.get('/me/invitations')).body as any[]; expect((await c.post(`/me/invitations/${inv[0].membershipId ?? inv[0].id}/accept`)).status).toBe(200); }
    taskId = ((await m.get(`/companies/${market.id}/tasks?siteId=${market.a}&status=open`)).body as any[]).find(x => x.title === 'Soğutucu sıcaklık kontrolü')!.id;
    expect(await versionOfTask(taskId)).toBe(2);
    expect((await w.get(`/companies/${market.id}/tasks`)).body).toEqual([]);
    expect((await m.post(`/companies/${market.id}/tasks/${taskId}/assign`, { userId: wrk.id })).status).toBe(200);
    expect(((await w.get(`/companies/${market.id}/tasks`)).body as any[]).map(t => t.id)).toEqual([taskId]);
    expect((await w.post(`/companies/${market.id}/tasks/${taskId}/complete`)).body.error.code).toBe('EVIDENCE_INCOMPLETE');
    await w.post(`/companies/${market.id}/tasks/${taskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString() });
    const photo = fakeJpeg('market-termometre');
    const reg = await w.post(`/companies/${market.id}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    expect((await w.put(`/companies/${market.id}/evidence/${reg.body.id}/content`, photo, 'image/jpeg')).body.status).toBe('stored');
    expect((await w.post(`/companies/${market.id}/tasks/${taskId}/complete`)).status).toBe(200);
    const rows = (await env.ownerDb.query(`SELECT seq, event_type, actor_id FROM audit_events WHERE company_id = $1 AND entity_id = $2 ORDER BY seq`, [market.id, taskId])).rows;
    const types = rows.map(r => r.event_type);
    expect(types.length).toBeGreaterThanOrEqual(2);
    expect(types.some((t: string) => /assign/.test(t))).toBe(true);
    expect(types.some((t: string) => /complet/.test(t))).toBe(true);
    const done = (await m.get(`/companies/${market.id}/tasks/${taskId}`)).body;
    expect(done).toMatchObject({ id: taskId, status: 'done', completedBy: wrk.id });
    expect(done.rule.version).toBe(2);
    log('market task transitions (same task id)', { taskId, ruleVersion: 2, events: rows.map(r => ({ seq: r.seq, type: r.event_type, by: r.actor_id === wrk.id ? 'çalışan' : r.actor_id === mgr.id ? 'yönetici' : 'sahip/sistem' })) });
  });
});

describe('3 · "prepares food" is not "this cold-chain check applies": answered "no", unanswered, contradictory', () => {
  let no: string, unanswered: string;
  it('expected written first; branch answered "no": not applicable, 0 tasks, no equipment prompt, no product card', async () => {
    no = (await market.owner.post(`/companies/${market.id}/sites`, { name: 'Şube C · soğuk yok' })).body.id;
    await fact(market.owner, market.id, no, 'storage.cold', false);
    expect((await decisionOf(market.owner, market.id, no)).decision).toBe('not_applicable');
    expect(await tasksOf(no)).toBe(0);
    expect(await gaps(market.owner, market.id, no)).toHaveLength(0);
    const ncr = (await market.owner.post(`/companies/${market.id}/nonconformities`, { siteId: no, title: 'Raf düzeni', description: 'Sıcaklık sınırı aştı gibi görünüyor.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: null, containment: 'Ürünler ayrıldı.' })).body.id;
    expect((await market.owner.get(`/companies/${market.id}/nonconformities/${ncr}`)).body.product).toBeNull();
    log('branch C ("no")', { decision: 'not_applicable', tasks: 0, productCard: null });
  });
  it('branch not answered: needs info naming storage.cold, 0 tasks, home screen asks the question, product card asks it too; nothing blocked', async () => {
    unanswered = (await market.owner.post(`/companies/${market.id}/sites`, { name: 'Şube D · cevap yok' })).body.id;
    const d = await decisionOf(market.owner, market.id, unanswered);
    expect(d.decision).toBe('needs_info');
    expect(JSON.stringify(d)).toMatch(/storage\.cold/);
    expect(await tasksOf(unanswered)).toBe(0);
    const g = await gaps(market.owner, market.id, unanswered);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'question', missing: ['storage.cold'], action: { kind: 'answer_question', factKey: 'storage.cold' } });
    const ncr = (await market.owner.post(`/companies/${market.id}/nonconformities`, { siteId: unanswered, title: 'Dolap sıcak', description: 'Dolap sınırın üstünde.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: null, containment: 'Kapı kapatıldı.' })).body.id;
    const p = (await market.owner.get(`/companies/${market.id}/nonconformities/${ncr}`)).body.product;
    expect(p).toMatchObject({ applies: false, unknown: true, needsAnswer: 'storage.cold', closureBlocker: null });
    log('branch D (unanswered)', { decision: d.decision, tasks: 0, homeAsks: g[0].message, productCard: p.suggestionText });
  });
  it('contradiction: "no cold storage" but a fridge is registered → tasks stay 0 and the person is asked which is true', async () => {
    expect((await market.owner.post(`/companies/${market.id}/equipment`, { siteId: no, type: 'refrigerator', name: 'Şube C dolap' })).status).toBe(201);
    expect(await tasksOf(no)).toBe(0);
    const g = await gaps(market.owner, market.id, no);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'conflict', missing: ['storage.cold'], action: { kind: 'answer_question', factKey: 'storage.cold' } });
    log('branch C + fridge', { tasks: 0, asks: g[0].message });
    // answering "yes" resolves it and now creates work
    await fact(market.owner, market.id, no, 'storage.cold', true);
    expect(await gaps(market.owner, market.id, no)).toHaveLength(0);
    expect(await todayTasksOf(no)).toBe(1);
  });
  it('estate office with a staff fridge: no food task, no question, no product card, no prompt', async () => {
    const e = await newUser('Emlak Sahibi'); const c = client(env, e.token);
    const r = await c.post('/companies', { name: 'Güven Emlak', siteName: 'Merkez ofis' });
    const id = r.body.companyId, site = r.body.siteId;
    await c.post(`/companies/${id}/activity`, { naceCodes: ['68.31'], confirmed: true });
    await c.post(`/companies/${id}/equipment`, { siteId: site, type: 'refrigerator', name: 'Personel buzdolabı' });
    expect(await tasksOf(site)).toBe(0);
    expect((await decisionOf(c, id, site)).decision).toBe('not_applicable');
    expect(await gaps(c, id, site)).toHaveLength(0);
    const ncr = (await c.post(`/companies/${id}/nonconformities`, { siteId: site, title: 'Dolap', description: 'Personel dolabı ısındı.', hazardType: 'cold_chain_temperature', severity: 'minor', equipmentId: null, containment: 'Boşaltıldı.' })).body.id;
    expect((await c.get(`/companies/${id}/nonconformities/${ncr}`)).body.product).toBeNull();
    log('estate office', { foodTasks: 0, question: null, productCard: null });
  });
});
