import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { topUpSite } from '../../src/services/tasks';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 6B: manager board with explained priority, every count backed by its list; repeat
 * candidates with reasons (link / mark unrelated, nothing merged); first-version indicators with their
 * denominators; a second site, HQ comparison, a site manager limited to their site, staff to their own work.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
let site2: string, fridge2: string, mgr2: ReturnType<typeof client>;
let A: string, B: string, Cc: string;
const ago = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

async function openCase(c: ReturnType<typeof client>, siteId: string, title: string, severity: string, equipmentId: string | null, hazardType = 'cold_chain_temperature') {
  const r = await c.post(`${C()}/nonconformities`, { siteId, title, description: 'Test kaydı açıklaması.', hazardType, severity, equipmentId, containment: 'Ürün taşındı.' });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('a second site', () => {
  it('the owner adds a site; a site manager cannot; the same name twice is refused', async () => {
    expect((await manager().post(`${C()}/sites`, { name: 'Beşiktaş Çarşı' })).status).toBe(403);
    const r = await owner().post(`${C()}/sites`, { name: 'Beşiktaş Çarşı' });
    expect(r.status).toBe(201);
    site2 = r.body.id;
    expect((await owner().post(`${C()}/sites`, { name: 'beşiktaş çarşı' })).body.error.code).toBe('SITE_EXISTS');
    // Its own site manager and a fridge.
    const u = await env.db.system(async tx => {
      const id = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Kerem (şube yöneticisi)', 'kerem@ornek.test') RETURNING id`)).rows[0].id;
      await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,$3,'site_manager','active',now())`, [id, demo.companyId, site2]);
      return { id, token: await createSession(tx, id) };
    });
    mgr2 = client(env, u.token);
    fridge2 = (await owner().post(`${C()}/equipment`, { siteId: site2, type: 'refrigerator', name: 'Buzdolabı · Beşiktaş' })).body.id;
    expect(fridge2).toBeTruthy();
    const list = (await owner().get('/companies')).body.find((c: any) => c.id === demo.companyId);
    expect(list.sites.map((s: any) => s.name)).toEqual(['Kadıköy Moda', 'Beşiktaş Çarşı']);
  });
});

describe('board', () => {
  it('cases: an earlier closed fridge case, a later one on the same fridge, a critical one at the other site', async () => {
    A = await openCase(manager(), demo.siteId, 'Buzdolabı 9 °C (önceki)', 'major', demo.fridgeId);
    await manager().post(`${C()}/nonconformities/${A}/assignment`, { ownerId: demo.users.manager.id, dueAt: new Date(Date.now() + 86400_000).toISOString() });
    const act = (await manager().post(`${C()}/nonconformities/${A}/actions`, { kind: 'correction', description: 'Conta değiştirildi.' })).body.id;
    expect(act).toBeTruthy();
    // Test setup only: the earlier case happened 40 days ago and was closed 30 days ago.
    await env.ownerDb.query(`UPDATE nonconformities SET detected_at = $2, status = 'closed', closed_at = $3, closed_by = $4 WHERE id = $1`, [A, ago(40), ago(30), demo.users.owner.id]);
    B = await openCase(manager(), demo.siteId, 'Buzdolabı yine 8 °C', 'major', demo.fridgeId);
    Cc = await openCase(mgr2, site2, 'Dondurucu alarmı çalışmıyor', 'critical', fridge2);
    // An action past its due date.
    await manager().post(`${C()}/nonconformities/${B}/actions`, { kind: 'correction', description: 'Menteşeyi ayarla.', dueAt: ago(1) });
  });

  it('owner: priority order, counts = lists, repeat candidate with reasons, both sites compared', async () => {
    const b = (await owner().get(`${C()}/board`)).body;
    expect(b.scope).toBe('manager');
    expect(b.priority.map((x: any) => x.key)).toEqual(['critical', 'overdueActions', 'awaitingVerification', 'documents', 'repeats']);
    expect(b.sections.critical.map((x: any) => x.id)).toContain(Cc);
    expect(b.sections.overdueActions.map((x: any) => x.ncrId)).toContain(B);
    const rep = b.sections.repeats.find((x: any) => x.later.id === B);
    expect(rep.earlier.id).toBe(A);
    expect(rep.reasons).toEqual(expect.arrayContaining([expect.stringContaining('aynı ekipman'), 'aynı konu', 'aynı şube']));
    expect(rep.daysSinceClosure).toBeGreaterThanOrEqual(29);
    expect(rep.earlierActions.map((a: any) => a.description)).toContain('Conta değiştirildi.');
    expect(b.comparison.sites.map((s: any) => s.site)).toEqual(['Kadıköy Moda', 'Beşiktaş Çarşı']);
    expect(b.comparison.note).toContain('puan değildir');
    const ind = Object.fromEntries(b.indicators.map((i: any) => [i.key, i]));
    expect(ind.reappearDays).toMatchObject({ denominator: 1, note: expect.stringContaining('az') });
    expect(ind.openDays.denominator).toBe(1);
    expect(ind.effectiveActions.basis).toContain('Takip aksiyonları sayılmaz');
    expect(b.note).toContain('ceza');
  });

  it('HQ comparison tells "checked and fine" apart from "not checked yet" per site', async () => {
    await env.db.system(tx => topUpSite(tx, demo.companyId, demo.siteId, 14));
    const ids = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND site_id = $2 AND status = 'open' ORDER BY created_at LIMIT 3`, [demo.companyId, demo.siteId])).rows.map(r => r.id as string);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Other open tasks of the site must not be due yet, whatever the time of day the suite runs at (daily 18:00 tasks are already due late in the evening).
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() + interval '3 days' WHERE company_id = $1 AND site_id = $2 AND status = 'open' AND id <> ALL($3)`, [demo.companyId, demo.siteId, ids.slice(0, 2)]);
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() - interval '2 days' WHERE id = ANY($1)`, [ids.slice(0, 2)]);
    await env.ownerDb.query(`UPDATE tasks SET status = 'done', outcome = 'conforming', completed_by = $2, completed_at = now() - interval '1 day' WHERE id = $1`, [ids[0], demo.users.manager.id]);
    const cmp = (await owner().get(`${C()}/board`)).body.comparison.sites;
    const a = cmp.find((x: any) => x.siteId === demo.siteId), b = cmp.find((x: any) => x.siteId === site2);
    expect(a.controls).toMatchObject({ checkedOk: 1, checkedNonconforming: 0, notChecked: 1, due: 2 });
    expect(b.controls).toMatchObject({ checkedOk: 0, notChecked: 0, due: 0, waitingInfo: expect.any(Number) }); // nothing due there: neither "fine" nor "missed"
  });

  it('HQ comparison: a check done before its hour counts, an unfinished one of today shows as pending (not late)', async () => {
    const S = demo.siteId;
    const controls = async () => (await owner().get(`${C()}/board`)).body.comparison.sites.find((x: any) => x.siteId === S).controls;
    await env.db.system(tx => topUpSite(tx, demo.companyId, S, 30));
    await env.ownerDb.query(`UPDATE tasks SET due_at = now() + interval '5 days' WHERE company_id = $1 AND site_id = $2 AND status = 'open'`, [demo.companyId, S]);
    const open = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND site_id = $2 AND status = 'open' ORDER BY created_at LIMIT 2`, [demo.companyId, S])).rows.map(r => r.id as string);
    expect(open.length).toBe(2);
    const before = await controls();
    // Both are due at the end of today (Istanbul); one is already done, the other still waits.
    await env.ownerDb.query(`UPDATE tasks SET due_at = ((date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '1 day') AT TIME ZONE 'Europe/Istanbul') - interval '1 millisecond' WHERE id = ANY($1)`, [open]);
    await env.ownerDb.query(`UPDATE tasks SET status = 'done', outcome = 'conforming', completed_by = $2, completed_at = now() WHERE id = $1`, [open[0], demo.users.owner.id]);
    const after = await controls();
    expect(after.checkedOk).toBe(before.checkedOk + 1);
    expect(after.due).toBe(before.due + 1);
    expect(after.notChecked).toBe(before.notChecked);
    expect(after.pendingToday).toBe(before.pendingToday + 1);
  });

  it('filters: site, topic, equipment, responsible, dates', async () => {
    expect((await owner().get(`${C()}/board?siteId=${site2}`)).body.sections.critical.map((x: any) => x.id)).toEqual([Cc]);
    expect((await owner().get(`${C()}/board?siteId=${site2}`)).body.comparison).toBeNull();
    expect((await owner().get(`${C()}/board?hazard=cleaning`)).body.sections.critical).toEqual([]);
    expect((await owner().get(`${C()}/board?equipmentId=${fridge2}`)).body.sections.repeats).toEqual([]);
    expect((await owner().get(`${C()}/board?ownerId=${demo.users.staff.id}`)).body.sections.overdueActions).toEqual([]);
    const future = encodeURIComponent(new Date(Date.now() + 86400_000).toISOString());
    expect((await owner().get(`${C()}/board?from=${future}`)).body.sections.critical).toEqual([]);
  });

  it('a site manager sees their own site only; staff only their own work', async () => {
    const m = (await manager().get(`${C()}/board`)).body;
    expect(m.sections.critical.map((x: any) => x.id)).not.toContain(Cc);
    expect(m.comparison).toBeNull();
    expect(m.choices.sites.map((s: any) => s.id)).toEqual([demo.siteId]);
    expect((await manager().get(`${C()}/board?siteId=${site2}`)).status).toBe(404);
    const k = (await mgr2.get(`${C()}/board`)).body;
    expect(k.sections.critical.map((x: any) => x.id)).toEqual([Cc]);
    expect(k.sections.repeats).toEqual([]);
    const s = (await staff().get(`${C()}/board`)).body;
    expect(s.scope).toBe('mine');
    expect(Object.keys(s.sections)).toEqual(['actions', 'tasks', 'cases']);
  });

  it('a service request of one site is not listed for the other site\'s manager (list = detail visibility)', async () => {
    const mk = await manager().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Birinci şube soğutucu servisi', description: 'Yalnız birinci şubeyi ilgilendirir.', city: 'İstanbul', taskId: null, ncrId: null, shareNcrSummary: false, invitedProfileId: null, invitedProfileIds: [] });
    expect(mk.status, JSON.stringify(mk.body)).toBe(201);
    const id = mk.body.id as string;
    const ids = async (c: ReturnType<typeof client>) => (await c.get(`${C()}/service-requests`)).body.map((r: any) => r.id);
    expect(await ids(manager())).toContain(id);
    expect(await ids(owner())).toContain(id);
    expect(await ids(mgr2)).not.toContain(id);
    expect((await mgr2.get(`${C()}/service-requests/${id}`)).status).toBe(404);
  });

  it('mark unrelated / link with a reason; nothing merged; the cases do not change', async () => {
    const before = (await env.ownerDb.query(`SELECT id, status, title FROM nonconformities WHERE id = ANY($1) ORDER BY id`, [[A, B]])).rows;
    expect((await manager().post(`${C()}/nonconformities/${B}/relations`, { relatedId: A, decision: 'unrelated', reason: 'kısa' })).status).toBe(422);
    expect((await mgr2.post(`${C()}/nonconformities/${B}/relations`, { relatedId: A, decision: 'unrelated', reason: 'Başka şubenin kaydı, yetkim yok.' })).status).toBe(404);
    expect((await manager().post(`${C()}/nonconformities/${B}/relations`, { relatedId: A, decision: 'unrelated', reason: 'Önceki conta sorunuydu; bu kez kapı menteşesi.' })).status).toBe(201);
    expect((await owner().get(`${C()}/board`)).body.sections.repeats.find((x: any) => x.later.id === B)).toBeUndefined();
    expect((await manager().post(`${C()}/nonconformities/${B}/relations`, { relatedId: A, decision: 'unrelated', reason: 'Önceki conta sorunuydu; bu kez kapı menteşesi.' })).body.error.code).toBe('ALREADY_DECIDED');
    expect((await manager().post(`${C()}/nonconformities/${B}/relations`, { relatedId: A, decision: 'linked', reason: 'Menteşe contayı da zorluyormuş; aynı sorun.' })).status).toBe(201);
    const rep = (await owner().get(`${C()}/board`)).body.sections.repeats.find((x: any) => x.later.id === B);
    expect(rep.decision).toMatchObject({ decision: 'linked', reason: expect.stringContaining('Menteşe') });
    const after = (await env.ownerDb.query(`SELECT id, status, title FROM nonconformities WHERE id = ANY($1) ORDER BY id`, [[A, B]])).rows;
    expect(after).toEqual(before);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM ncr_relations WHERE ncr_id = $1`, [B])).rows[0].n).toBe(2);
  });
});
