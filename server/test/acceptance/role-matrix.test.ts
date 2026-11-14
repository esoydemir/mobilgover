import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Group 2: what each role may call on the server. The menus of the app follow these rules; the server is the authority. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
const C = () => `/companies/${demo.companyId}`;
const who: Record<string, string> = {};
const probe = async () => {
  const out: Record<string, Record<string, number>> = {};
  const calls: [string, (c: ReturnType<typeof client>) => Promise<{ status: number }>][] = [
    ['tasks', c => c.get(`${C()}/tasks?siteId=${demo.siteId}&from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 5 * 864e5).toISOString()}`)],
    ['board', c => c.get(`${C()}/board`)],
    ['documents', c => c.get(`${C()}/documents`)],
    ['members', c => c.get(`${C()}/members`)],
    ['verifiers', c => c.get(`${C()}/verifiers`)],
    ['audit-export', c => c.get(`${C()}/audit-export?from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date().toISOString()}`)],
    ['bulk-assign', c => c.post(`${C()}/tasks/bulk-assign/preview`, { userId: demo.users.staff.id, from: new Date().toISOString(), to: new Date(Date.now() + 864e5).toISOString() })],
    ['admin-rules', c => c.get('/admin/rule-versions')],
    ['admin-market', c => c.get('/admin/marketplace/queue')],
  ];
  for (const [role, token] of Object.entries(who)) {
    out[role] = {};
    for (const [name, f] of calls) out[role]![name] = (await f(client(env, token))).status;
  }
  return out;
};

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 6);
  const mk = async (name: string) => env.db.system(async tx => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ($1) RETURNING id`, [name])).rows[0]!.id;
    return { id, token: await createSession(tx, id, 24) };
  });
  const hq = await mk('Merkez Yönetici'), ver = await mk('Dış Doğrulayıcı');
  await env.ownerDb.query(`INSERT INTO memberships (user_id, company_id, site_id, role) VALUES ($1,$2,NULL,'hq_manager')`, [hq.id, demo.companyId]);
  await env.ownerDb.query(`INSERT INTO access_grants (company_id, user_id, kind, scopes, granted_by, reason, expires_at, site_id) VALUES ($1,$2,'expert','{ncr_verify}',$3,'Bağımsız doğrulama (test)', now() + interval '30 days', $4)`,
    [demo.companyId, ver.id, demo.users.owner.id, demo.siteId]);
  Object.assign(who, { owner: demo.users.owner.token, hq: hq.token, siteManager: demo.users.manager.token, staff: demo.users.staff.token, expert: demo.users.expert.token, verifier: ver.token,
    platformAdmin: platform.admin.token });
});
afterAll(async () => { await env?.close(); });

describe('role matrix', () => {
  it('every role gets exactly the access the menus assume; the server decides, not the menu', async () => {
    const m = await probe();
    const only = (role: string, ok: string[]) => {
      for (const [name, status] of Object.entries(m[role]!)) expect([role, name, ok.includes(name) ? 'izin' : 'red', status === 200 ? 'izin' : 'red']).toEqual([role, name, ok.includes(name) ? 'izin' : 'red', ok.includes(name) ? 'izin' : 'red']);
    };
    const mgmt = ['tasks', 'board', 'documents', 'members', 'verifiers', 'audit-export', 'bulk-assign'];
    only('owner', mgmt);
    only('hq', mgmt);
    only('siteManager', ['tasks', 'board', 'documents', 'bulk-assign']); // no team, verifier or audit-export administration
    only('staff', ['tasks', 'board', 'documents']);
    only('expert', ['tasks', 'board', 'documents']);
    only('verifier', ['tasks', 'board', 'documents']);
    only('platformAdmin', ['admin-rules']); // platform staff are not company members: company data is not theirs to read
    expect(m.platformAdmin!.tasks).toBe(404);
  });

  it('the 200s for staff, expert and verifier carry no company data: their own work only', async () => {
    const win = `from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 5 * 864e5).toISOString()}`;
    const full = (await client(env, who.owner!).get(`${C()}/tasks?siteId=${demo.siteId}&${win}`)).body as any[];
    expect(full.length).toBeGreaterThan(0);
    expect((await client(env, who.siteManager!).get(`${C()}/tasks?siteId=${demo.siteId}&${win}`)).body).toHaveLength(full.length);
    await client(env, who.owner!).post(`${C()}/documents`, { docType: 'business_license', title: 'Ruhsat', siteId: demo.siteId });
    for (const r of ['staff', 'expert', 'verifier']) {
      expect((await client(env, who[r]!).get(`${C()}/tasks?siteId=${demo.siteId}&${win}`)).body).toEqual([]);
      expect((await client(env, who[r]!).get(`${C()}/documents`)).body).toEqual([]);
      const b = (await client(env, who[r]!).get(`${C()}/board`)).body;
      expect(b.scope).toBe('mine');
    }
    expect(((await client(env, who.owner!).get(`${C()}/documents`)).body as any[]).length).toBe(1);
  });
});

describe('counts, filtered lists and details rest on the same records', () => {
  it('the per-site comparison equals the board filtered to that site; a card number opens exactly that many cases', async () => {
    const o = client(env, who.owner!);
    const site2 = (await o.post(`${C()}/sites`, { name: 'Beşiktaş Çarşı' })).body.id as string;
    const mk = async (siteId: string, title: string, severity: string) => (await o.post(`${C()}/nonconformities`, { siteId, title, description: 'Test kaydı açıklaması.', hazardType: 'cold_chain_temperature', severity, equipmentId: null, containment: 'Ürün taşındı.' })).body.id as string;
    await mk(demo.siteId, 'Soğutucu 9 °C', 'critical'); await mk(demo.siteId, 'Kapı contası', 'major'); await mk(site2, 'Depo sıcaklığı', 'critical');
    const all = (await o.get(`${C()}/board`)).body;
    expect(all.comparison.sites).toHaveLength(2);
    for (const row of all.comparison.sites as any[]) {
      const one = (await o.get(`${C()}/board?siteId=${row.siteId}`)).body;
      expect(one.sections.critical.length).toBe(row.critical);
      expect(one.sections.overdueActions.length).toBe(row.overdueActions);
      expect(one.sections.awaitingVerification.length).toBe(row.awaitingVerification);
      for (const c of one.sections.critical) {
        const d = await o.get(`${C()}/nonconformities/${c.id}`); // every listed card record opens as a detail
        expect(d.status).toBe(200);
        expect(d.body.site_id ?? d.body.siteId ?? row.siteId).toBe(row.siteId);
      }
    }
    // The company-wide critical list is the union of the per-site ones.
    expect(all.sections.critical.length).toBe((all.comparison.sites as any[]).reduce((n, r) => n + r.critical, 0));
    // A site manager's numbers are the same records, restricted to their site.
    const mine = (await client(env, who.siteManager!).get(`${C()}/board`)).body;
    expect(mine.sections.critical.map((c: any) => c.id).sort()).toEqual((await o.get(`${C()}/board?siteId=${demo.siteId}`)).body.sections.critical.map((c: any) => c.id).sort());
  });
});
