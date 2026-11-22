import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFoodScopeRevision, ensureSectorRules, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/** Emlak ofisi kendi örnek görevini görür (EX-ESTATE-FILES, ÖRNEK kural); gıda/montaj görevi görmez. Hiçbir kayıt elle eklenmez. */
let env: Env; let co: string, site: string, tok: string;
const est = () => client(env, tok);
const tasksOf = async (code: string) => (await env.ownerDb.query(
  `SELECT count(*)::int AS n FROM tasks t JOIN rules r ON r.id = t.rule_id WHERE t.site_id = $1 AND r.code = $2 AND t.status <> 'cancelled'`, [site, code])).rows[0].n as number;
const allTasks = async () => (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1 AND status <> 'cancelled'`, [site])).rows[0].n as number;

beforeAll(async () => {
  env = await freshEnv(); await seedPlatform(env.db); await ensureSectorRules(env.db); await ensureFoodScopeRevision(env.db);
  const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ('Emlak Sahibi', 'emlak10@test.invalid') RETURNING id`)).rows[0].id as string;
  tok = await env.db.system(tx => createSession(tx, id, 24));
});
afterAll(async () => { await env?.close(); });

describe('GH-10 emlak ofisi: kendi görevi', () => {
  it('68.31 seçilince yalnız emlak sorusu sorulur; yanıtlanana kadar görev yok ve cevap "bilinmiyor" sayılır', async () => {
    const r = await est().post('/companies', { name: 'Güven Emlak', siteName: 'Merkez ofis' }); co = r.body.companyId; site = r.body.siteId;
    expect((await est().post(`/companies/${co}/activity`, { naceCodes: ['68.31'], confirmed: true })).status).toBe(201);
    const keys = JSON.stringify((await est().get(`/companies/${co}/profile-questions`)).body);
    expect(keys).toContain('activity.client_contracts');
    expect(keys).not.toContain('storage.cold'); expect(keys).not.toContain('onsite_installation');
    expect(await tasksOf('EX-ESTATE-FILES')).toBe(0);
    const o = ((await est().get(`/companies/${co}/obligations?siteId=${site}`)).body as any[]).find(x => x.rule === 'EX-ESTATE-FILES');
    expect(o?.decision).toBe('needs_info');
  });
  it('"dosya tutuyorum" denince emlak görevi doğar; personel dolabı olsa da gıda görevi doğmaz; yeniden kayıt mükerrer üretmez', async () => {
    await est().post(`/companies/${co}/equipment`, { siteId: site, type: 'refrigerator', name: 'Personel dolabı' });
    const f = { siteId: site, key: 'activity.client_contracts', value: true, source: 'user_declared', verification: 'user_confirmed' };
    expect((await est().post(`/companies/${co}/profile/facts`, f)).status).toBe(201);
    const n = await tasksOf('EX-ESTATE-FILES'); expect(n).toBeGreaterThanOrEqual(1);
    await est().post(`/companies/${co}/profile/facts`, f);
    expect(await tasksOf('EX-ESTATE-FILES')).toBe(n);
    expect(await tasksOf('EX-COLD-CHAIN')).toBe(0); expect(await tasksOf('EX-ELEC-INSTALL')).toBe(0);
    expect(await allTasks()).toBe(n);
  });
  it('"hayır" denince görev doğmaz', async () => {
    const e2 = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ('Emlak İki', 'emlak10b@test.invalid') RETURNING id`)).rows[0].id as string;
    const t2 = await env.db.system(tx => createSession(tx, e2, 24)); const c = client(env, t2);
    const r = await c.post('/companies', { name: 'Kira Emlak', siteName: 'Ofis' });
    await c.post(`/companies/${r.body.companyId}/activity`, { naceCodes: ['68.31'], confirmed: true });
    await c.post(`/companies/${r.body.companyId}/profile/facts`, { siteId: r.body.siteId, key: 'activity.client_contracts', value: false, source: 'user_declared', verification: 'user_confirmed' });
    const n = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks WHERE site_id = $1`, [r.body.siteId])).rows[0].n;
    expect(n).toBe(0);
  });
  it('kapsam sürümü yeniden başlatmada tekrar yayımlanmaz (idempotent)', async () => {
    const ver = async () => (await env.ownerDb.query(`SELECT max(rv.version)::int AS v FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = 'EX-COLD-CHAIN'`)).rows[0].v as number;
    const before = await ver();
    expect(await ensureFoodScopeRevision(env.db)).toEqual([]);
    expect(await ver()).toBe(before);
  });
  it('emlak sorusu sorulmayan işletmede (elektrik dükkânı) emlak kuralı "bilgi eksik" değil "uygulanmaz" çıkar', async () => {
    const id = (await env.ownerDb.query(`INSERT INTO users (display_name, email) VALUES ('Elektrikçi', 'elk10@test.invalid') RETURNING id`)).rows[0].id as string;
    const c = client(env, await env.db.system(tx => createSession(tx, id, 24)));
    const r = await c.post('/companies', { name: 'Volt', siteName: 'Çarşı' });
    await c.post(`/companies/${r.body.companyId}/activity`, { naceCodes: ['47.59'], confirmed: true });
    const o = ((await c.get(`/companies/${r.body.companyId}/obligations?siteId=${r.body.siteId}`)).body as any[]).find(x => x.rule === 'EX-ESTATE-FILES');
    expect(o?.decision).toBe('not_applicable');
  });
});
