import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFoodScopeRevision, seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Product-decision scope (GH-07 follow-up). The same EXAMPLE cold-chain rule (EX-COLD-CHAIN, EXAMPLE limits) is run against four kinds of site.
 * What decides is what the site really does and keeps, not whether it prepares food: cold storage of product → product decision;
 * a fridge for staff in an office → none; unknown answer → asked, never read as "no".
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const fact = (siteId: string, key: string, value: boolean) => owner().post(`${C()}/profile/facts`, { siteId, key, value, source: 'user_declared', verification: 'user_confirmed' });
const site = async (name: string) => (await owner().post(`${C()}/sites`, { name })).body.id as string;
const coldTasks = async (siteId: string) => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = 'EX-COLD-CHAIN' AND t.status <> 'cancelled'`, [siteId])).rows[0].n as number;
const ncr = async (siteId: string) => (await owner().post(`${C()}/nonconformities`, { siteId, title: 'Dolap sıcaklığı yüksek', description: 'Dolap sınırın üstünde, ürünler etkilenmiş olabilir.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: null, containment: 'Kapı kapatıldı.' })).body.id as string;
const productOf = async (id: string) => (await owner().get(`${C()}/nonconformities/${id}`)).body.product;

let market: string, dry: string, estate: string;
beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  await ensureFoodScopeRevision(env.db); // v1 -> v2 through the normal review and publish flow
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await fact(demo.siteId, 'activity.food_business', true); await fact(demo.siteId, 'activity.food_preparation', true); await fact(demo.siteId, 'storage.cold', true);
  market = await site('Market (hazırlık yok, süt ürünü)'); dry = await site('Kuru gıda şubesi'); estate = await site('Emlak ofisi');
  await fact(market, 'activity.food_business', true); await fact(market, 'activity.food_preparation', false); await fact(market, 'storage.cold', true);
  // the market registers its dairy cabinet the way a user does (public API); the cold check is per unit
  expect((await owner().post(`${C()}/equipment`, { siteId: market, type: 'refrigerator', name: 'Süt ürünleri dolabı' })).status).toBe(201);
  await fact(dry, 'activity.food_business', true); await fact(dry, 'activity.food_preparation', false); await fact(dry, 'storage.cold', false);
  // The estate office is never asked the food questions; a staff fridge exists but is not a stated activity.
  await env.ownerDb.query(`INSERT INTO equipment (company_id, site_id, type, name) VALUES ($1,$2,'refrigerator','Personel buzdolabı')`, [demo.companyId, estate]);
});
afterAll(async () => { await env?.close(); });


describe('same example cold-chain rule, four kinds of site', () => {
  it('1 · café that prepares food and keeps cold product: task and product decision', async () => {
    expect(await coldTasks(demo.siteId)).toBeGreaterThan(0);
    expect(await productOf(await ncr(demo.siteId))).toMatchObject({ applies: true, required: true });
  });
  it('2 · market that does not prepare food but sells chilled dairy: task and product decision', async () => {
    expect(await coldTasks(market)).toBeGreaterThan(0);
    expect(await productOf(await ncr(market))).toMatchObject({ applies: true, required: true });
  });
  it('3 · branch with shelf-stable goods only: no cold task, no product fields', async () => {
    expect(await coldTasks(dry)).toBe(0);
    expect(await productOf(await ncr(dry))).toBeNull();
  });
  it('4 · office with a staff fridge: no cold task, no product fields, and the answer is not guessed', async () => {
    expect(await coldTasks(estate)).toBe(0);
    expect(await productOf(await ncr(estate))).toBeNull();
  });
});

describe('unknown answers are asked, not read as "no"', () => {
  it('a site that sells food but never answered the cold-storage question is asked the question', async () => {
    const s = await site('Eski şube (cevap yok)');
    await fact(s, 'activity.food_business', true); await fact(s, 'activity.food_preparation', false);
    const p = await productOf(await ncr(s));
    expect(p).toMatchObject({ applies: false, unknown: true, needsAnswer: 'storage.cold' });
    expect(p.suggestionText).toMatch(/soğuk/);
    expect(p.closureBlocker).toBeNull();
  });
});
