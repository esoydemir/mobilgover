import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureActivityDerivedFacts, ensureFoodScopeRevision, ensureSectorGateRevisions, ensureSectorRules, seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * "Profil eksik" sayacı yalnız gerçek, yanıtlanabilir eksikleri sayar. Önce: bir iş kolunda hiç sorulmayan soru (ör. emlakçıda "LPG",
 * markette "sahada montaj") kural v1'i yüzünden sonsuza dek "bilgi eksik" kalıyordu. Şimdi sektör geçidi (v2) bu kuralları o işletme için "uygulanmaz" yapar.
 * Yayımlı v1 ve ona bağlı görevler değişmez. Tüm kurallar ÖRNEKTİR.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let seq = 0;
type Biz = { c: ReturnType<typeof client>; company: string; site: string };
const biz = async (name: string, nace: string): Promise<Biz> => {
  const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, `gh11-${++seq}@test.invalid`])).rows[0].id as string;
  const c = client(env, await env.db.system(tx => createSession(tx, id, 24)));
  const r = await c.post('/companies', { name, siteName: 'Şube' });
  await c.post(`/companies/${r.body.companyId}/activity`, { naceCodes: [nace], confirmed: true });
  return { c, company: r.body.companyId, site: r.body.siteId };
};
const obligations = async (b: Biz) => (await b.c.get(`/companies/${b.company}/obligations?siteId=${b.site}`)).body as any[];
const asked = async (b: Biz) => new Set(((await b.c.get(`/companies/${b.company}/profile-questions`)).body as any[]).map(q => q.key));
const counted = (o: any[]) => o.filter(x => x.decision === 'needs_info' || x.decision === 'needs_review');
const tasks = async (b: Biz) => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1 AND status <> 'cancelled'`, [b.site])).rows[0].n as number;
const notifs = async (b: Biz) => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM notifications WHERE company_id = $1`, [b.company])).rows[0].n as number;

let lpgV1Tasks = 0;
beforeAll(async () => {
  env = await freshEnv(); await seedPlatform(env.db); await ensureSectorRules(env.db);
  demo = await seedDemoCompany(env.db); // the café with LPG, on the published v1 of every rule
  lpgV1Tasks = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE r.code = 'EX-LPG-CHECK' AND t.company_id = $1`, [demo.companyId])).rows[0].n;
  await ensureFoodScopeRevision(env.db);
});
afterAll(async () => { await env?.close(); });

describe('GH-11 profil eksik sayacı', () => {
  it('ÖNCE: sektör geçidi yokken emlak ofisinde hiç sorulmayan iki soru sayaçta kalır (davranışın kaydı)', async () => {
    const estate = await biz('Önce Emlak', '68.31');
    const o = counted(await obligations(estate)); const a = await asked(estate);
    const dead = o.filter(x => (x.missingFacts as string[]).some(k => !a.has(k)));
    expect(dead.map(x => x.rule).sort()).toEqual(['EX-ELEC-INSTALL', 'EX-LPG-CHECK']);
  });

  it('geçit yayımlanır (normal inceleme/yayın akışı); eski v1 korunur, bir kez; yeniden çalışınca tekrar yayımlanmaz', async () => {
    const moved = await ensureSectorGateRevisions(env.db);
    expect(moved.map(m => `${m.code} v${m.from}→v${m.to}`).sort()).toEqual(['EX-ELEC-INSTALL v1→v2', 'EX-ESTATE-FILES v1→v2', 'EX-LPG-CHECK v1→v2']);
    expect(await ensureSectorGateRevisions(env.db)).toEqual([]);
    const v = (await env.ownerDb.query(`SELECT r.code, rv.version, rv.status FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code IN ('EX-LPG-CHECK','EX-ELEC-INSTALL') ORDER BY 1, 2`)).rows;
    expect(v.map(x => `${x.code} v${x.version} ${x.status}`)).toEqual(['EX-ELEC-INSTALL v1 retired', 'EX-ELEC-INSTALL v2 published', 'EX-LPG-CHECK v1 retired', 'EX-LPG-CHECK v2 published']);
  });

  it('eski görevler v1 şablonuna bağlı kalır, açık olanlar "kural sürümü değişti" ile işaretlenir; kafe v2\'de de LPG kuralını alır', async () => {
    const rows = (await env.ownerDb.query(`SELECT rv.version, t.review_flag FROM tasks t JOIN rules r ON r.id = t.rule_id JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id
      WHERE r.code = 'EX-LPG-CHECK' AND t.company_id = $1 AND t.created_at < now()`, [demo.companyId])).rows;
    expect(rows.filter(r => r.version === 1).length).toBe(lpgV1Tasks);
    expect(rows.filter(r => r.version === 1).every(r => r.review_flag === 'RULE_VERSION_CHANGED')).toBe(true);
    const cafe = (await demo.users.owner && client(env, demo.users.owner.token));
    const o = (await cafe.get(`/companies/${demo.companyId}/obligations?siteId=${demo.siteId}`)).body as any[];
    expect(o.find(x => x.rule === 'EX-LPG-CHECK')?.decision).toBe('applies');
  });

  it('SONRA: market, elektrikçi, emlakçı — sayaçtaki her kalem gerçekten sorulan bir soruyu bekler', async () => {
    const market = await biz('Market', '47.11'); const shop = await biz('Elektrik', '47.59'); const estate = await biz('Emlak', '68.31');
    for (const b of [market, shop, estate]) {
      const a = await asked(b);
      for (const x of counted(await obligations(b)).filter(x => x.decision === 'needs_info')) for (const k of x.missingFacts as string[]) expect(a.has(k), `${x.rule} → ${k}`).toBe(true);
    }
    expect(counted(await obligations(market)).map(x => x.rule).sort()).toEqual(['EX-COLD-CHAIN', 'EX-ISG-THRESHOLD', 'EX-LPG-CHECK']);
    expect(counted(await obligations(shop)).map(x => x.rule).sort()).toEqual(['EX-ELEC-INSTALL', 'EX-ISG-THRESHOLD']);
    expect(counted(await obligations(estate)).map(x => x.rule).sort()).toEqual(['EX-ESTATE-FILES', 'EX-ISG-THRESHOLD']);
    const out = (await obligations(estate)).filter(x => x.decision === 'not_applicable').map(x => x.rule);
    expect(out).toEqual(expect.arrayContaining(['EX-LPG-CHECK', 'EX-ELEC-INSTALL']));
  });

  it('cevap kaydedilince sayaç düşer; aynı profili yeniden kaydetmek görev ve bildirim çoğaltmaz', async () => {
    const market = await biz('Market Cevap', '47.11');
    const before = counted(await obligations(market)).length;
    const f = (key: string, value: unknown) => ({ siteId: market.site, key, value, source: 'user_declared', verification: 'user_confirmed' });
    expect((await market.c.post(`/companies/${market.company}/profile/facts`, f('utility.lpg', false))).status).toBe(201);
    expect(counted(await obligations(market)).length).toBe(before - 1);
    expect((await market.c.post(`/companies/${market.company}/profile/facts`, f('storage.cold', true))).status).toBe(201);
    await market.c.post(`/companies/${market.company}/equipment`, { siteId: market.site, type: 'refrigerator', name: 'Dolap' });
    const after = counted(await obligations(market)).length;
    expect(after).toBe(before - 2); // lpg, cold
    const t = await tasks(market), n = await notifs(market);
    expect(t).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) { await market.c.post(`/companies/${market.company}/profile/facts`, f('storage.cold', true)); await market.c.post(`/companies/${market.company}/profile/facts`, f('utility.lpg', false)); }
    expect(await tasks(market)).toBe(t); expect(await notifs(market)).toBe(n);
    expect(counted(await obligations(market)).length).toBe(after);
  });

  it('eski işletme (türetilmiş bilgi yok) yeniden türetilince geçitten geçer; tekrar çalışınca hiçbir şey eklenmez', async () => {
    const estate = await biz('Eski Emlak', '68.31');
    await env.ownerDb.query(`DELETE FROM profile_facts WHERE company_id = $1 AND key IN ('activity.installation_business','activity.brokerage','activity.food_business')`, [estate.company]);
    await ensureActivityDerivedFacts(env.db);
    const n = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM profile_facts WHERE company_id = $1`, [estate.company])).rows[0].n;
    await ensureActivityDerivedFacts(env.db);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM profile_facts WHERE company_id = $1`, [estate.company])).rows[0].n).toBe(n);
    expect(counted(await obligations(estate)).map(x => x.rule).sort()).toEqual(['EX-ESTATE-FILES', 'EX-ISG-THRESHOLD']);
  });
});
