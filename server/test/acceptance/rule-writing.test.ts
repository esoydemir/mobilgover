import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_RULES, seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { institutionView, K_MIN } from '../../src/services/institution';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 6E: writing a rule draft (scope conditions, source, version, effective date, frequency,
 * unit, evidence, review state), previewing which tasks it creates on SAMPLE profiles before
 * publishing, editing only while a draft and only by its author, unsourced rules staying example/draft,
 * and a new version never changing which version earlier tasks were made from. Plus the SYNTHETIC
 * institution view: small groups hidden, no interpretation on little data.
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const author = () => client(env, platform.author.token);
const reviewer = () => client(env, platform.reviewer.token);
const specialist = () => client(env, platform.specialist.token);
const admin = () => client(env, platform.admin.token);
const C = () => `/companies/${demo.companyId}`;
const draft = (extra: Record<string, unknown> = {}) => ({
  code: 'EX-DELIVERY-BAG', title: 'Paket servis çantası temizliği (örnek)', kind: 'good_practice', isExample: true, provisionIds: [], ambiguityNote: null,
  condition: { fact: 'service.delivery', op: 'eq', value: true },
  obligationTitle: 'Paket servis çantalarını haftalık temizle', obligationSummary: 'Paket servis yapan işletmeler çantaları düzenli temizler.',
  effectiveFrom: '2026-01-01', effectiveTo: null, changeReason: 'İlk örnek taslak', requiredReviewAreas: ['food_safety'],
  templates: [{ code: 'bag_clean', title: 'Servis çantası temizliği', instructions: 'Çantanın içini dezenfekte et ve fotoğrafını ekle.',
    recurrence: { freq: 'weekly', weekday: 1, at: '10:00' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'cleaning' }],
  ...extra,
});
let id: string;

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await topUpAllSites(env.db, 2);
});
afterAll(async () => { await env?.close(); });

describe('rule writing screen', () => {
  it('a draft shows on sample profiles which tasks it would create; nothing is published or written to businesses', async () => {
    const r = await author().post('/admin/rule-versions', draft());
    expect(r.status).toBe(201);
    id = r.body.id;
    const d = (await author().get(`/admin/rule-versions/${id}`)).body;
    expect(d).toMatchObject({ status: 'draft', canEdit: true, isExample: true, usedByTasks: 0 });
    expect(d.sourceNote).toContain('Kaynak hükmü bağlı değil');
    const by = Object.fromEntries(d.samplePreview.map((x: any) => [x.profile, x]));
    expect(by.restaurant_lpg).toMatchObject({ decision: 'applies', tasks: [{ code: 'bag_clean', count: 1, schedule: expect.stringContaining('her hafta') }] });
    expect(by.cafe_cold).toMatchObject({ decision: 'not_applicable', tasks: [] });
    expect(by.unknown).toMatchObject({ decision: 'needs_info', missingFacts: ['service.delivery'] });
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM obligations o JOIN rules r ON r.id = o.rule_id WHERE r.code = 'EX-DELIVERY-BAG'`)).rows[0].n).toBe(0);
  });

  it('only the author edits, only while a draft; a measured check needs limits; an unsourced legal rule cannot be real', async () => {
    expect((await reviewer().putJson(`/admin/rule-versions/${id}`, draft())).status).toBe(403);
    const edited = await author().putJson(`/admin/rule-versions/${id}`, draft({
      condition: { all: [{ fact: 'service.delivery', op: 'eq', value: true }, { fact: 'activity.food_preparation', op: 'eq', value: true }] },
      templates: [{ ...draft().templates[0], recurrence: { freq: 'daily', at: '09:00', perEquipmentType: 'freezer' } }] }));
    expect(edited.status).toBe(200);
    const by = Object.fromEntries((await author().get(`/admin/rule-versions/${id}`)).body.samplePreview.map((x: any) => [x.profile, x]));
    expect(by.restaurant_lpg.tasks[0]).toMatchObject({ count: 1, schedule: 'her gün 09:00' });
    expect((await author().putJson(`/admin/rule-versions/${id}`, draft({ templates: [{ ...draft().templates[0], evidence: [{ kind: 'measurement', quantity: 'temperature', unit: '°C' }] }] }))).status).toBe(422);
    expect((await author().post('/admin/rule-versions', draft({ code: 'REAL-NO-SOURCE', kind: 'legal_requirement', isExample: false }))).body.error.message).toContain('kaynak hükme');
    expect((await author().putJson(`/admin/rule-versions/${id}`, draft({ code: 'BASKA-KOD' }))).status).toBe(422);
    await author().post(`/admin/rule-versions/${id}/submit`);
    expect((await author().putJson(`/admin/rule-versions/${id}`, draft())).body.error.code).toBe('INVALID_STATE');
    const d = (await reviewer().get(`/admin/rule-versions/${id}`)).body;
    expect(d).toMatchObject({ status: 'in_review', canEdit: false, pendingAreaReviews: ['food_safety'] });
  });

  it('a new version: earlier tasks stay bound to the version they were made from', async () => {
    const before = (await env.ownerDb.query(`SELECT t.id, rv.version FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id
       WHERE t.company_id = $1 AND t.template_code = 'fridge_temp'`, [demo.companyId])).rows;
    expect(before.length).toBeGreaterThan(0);
    expect(new Set(before.map(r => r.version))).toEqual(new Set([1]));
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-COLD-CHAIN')!;
    const prov = (await env.ownerDb.query(`SELECT id FROM provisions LIMIT 1`)).rows[0].id;
    const v2 = (await author().post('/admin/rule-versions', { ...base, provisionIds: [prov], changeReason: 'Örnek: limit 0–5 °C',
      templates: base.templates.map(t => ({ ...t, limits: (t.limits ?? []).map(l => ({ ...l, max: 5 })) })) })).body.id;
    await author().post(`/admin/rule-versions/${v2}/submit`);
    await specialist().post(`/admin/rule-versions/${v2}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Limit değişikliği incelendi.' });
    expect((await reviewer().post(`/admin/rule-versions/${v2}/approve`, { reason: 'Test: onay gerekçesi' })).status).toBe(200);
    expect((await admin().post(`/admin/rule-versions/${v2}/publish`, { reason: 'Test: yayın gerekçesi' })).status).toBe(200);
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    await client(env, demo.users.owner.token).post(`${C()}/tasks/generate`, { siteId: demo.siteId, fromDay: day(5), toDay: day(5) });
    const after = (await env.ownerDb.query(`SELECT t.id, rv.version FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id
       WHERE t.company_id = $1 AND t.template_code = 'fridge_temp'`, [demo.companyId])).rows;
    for (const b of before) expect(after.find(a => a.id === b.id)!.version).toBe(1);
    expect(after.some(a => a.version === 2)).toBe(true);
    expect((await admin().get(`/admin/rule-versions/${v2}`)).body.status).toBe('published');
  });
});

describe('institution view (synthetic)', () => {
  it('labelled synthetic; small groups hidden; no interpretation or rate on little data; patterns by cause', async () => {
    const v = (await admin().get('/institution/demo')).body;
    expect(v.synthetic).toBe(true);
    expect(v.label).toContain('SENTETİK');
    expect(v.groups.filter((g: any) => g.region === 'Kars').every((g: any) => g.hidden)).toBe(true);
    expect(v.groups.filter((g: any) => !g.hidden).every((g: any) => g.businesses >= K_MIN)).toBe(true);
    expect(v.byRegion.find((r: any) => r.region === 'Kars').hidden).toBe(true);
    expect(v.byRegion.find((r: any) => r.region === 'Ankara').interpretation).toContain('Ekipman eksikliği');
    expect(v.byRegion.find((r: any) => r.region === 'İzmir').interpretation).toContain('Bilgi eksikliği');
    const eq = v.fitByCause.find((x: any) => x.cause === 'equipment');
    expect(eq.withFit).toBeLessThan(eq.withoutSupport);
    // A narrow filter leaves too little data: no rates, a note instead.
    const narrow = institutionView({ region: 'İzmir', type: 'Fırın' });
    expect(narrow.support.every(s => s.repeatRate === null && s.note)).toBe(true);
    // Not reachable without a platform role outside demo mode.
    const prod = await freshEnv({ demoMode: false });
    const o = await seedDemoCompany(prod.db);
    expect((await client(prod, o.users.owner.token).get('/institution/demo')).status).toBe(403);
    await prod.close();
  });
});
