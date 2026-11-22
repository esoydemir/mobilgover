import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * B-07: an outside verifier invited for one selected case sees that case's evidence and nothing else of the business:
 * no team data, no branch names, no vault. Each response family is checked on its own: the company list the menu is built from,
 * the direct pages' data, and the case data itself. Secret strings must appear nowhere in what the verifier can fetch.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let assigned: string, other: string;
let ex: ReturnType<typeof client>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const SECRET = /GIZLI SUBE|BASKA VAKA|GIZLI BELGE|Kadıköy|@ornek\.test.*staff|Personel/;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await env.db.system(tx => tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'GIZLI SUBE ADI')`, [demo.companyId]));
  const mk = async (t: string) => (await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: t, description: 'Açıklama metni burada.', hazardType: 'cleaning', severity: 'major', containment: 'Alan kapatıldı.' })).body.id as string;
  assigned = await mk('ATANMIS VAKA'); other = await mk('BASKA VAKA GIZLI');
  expect((await owner().post(`${C()}/documents`, { docType: 'signature_circular', title: 'GIZLI BELGE sirküleri' })).status).toBe(201);
  expect((await owner().post(`${C()}/verifiers`, { email: 'dis.dogrulayici@ornek.test', siteId: demo.siteId, ncrIds: [assigned], days: 30, note: 'Bağımsız doğrulama için.' })).status).toBe(201);
  ex = await env.db.system(async tx => { const id = (await tx.query(`SELECT id FROM users WHERE email = 'dis.dogrulayici@ornek.test'`)).rows[0].id; return client(env, await createSession(tx, id)); });
});
afterAll(async () => { await env?.close(); });

describe('B-07 outside verifier scope', () => {
  it('menu source: the company list gives the name and the grant, no branch list', async () => {
    const list = (await ex.get('/companies')).body as any[];
    expect(list).toHaveLength(1);
    expect(list[0].sites).toEqual([]);
    expect(list[0].roles).toEqual([]);
    expect(list[0].grants[0].scopes).toEqual(['ncr_verify']);
    expect(JSON.stringify(list)).not.toMatch(SECRET);
  });

  it('direct pages: team, vault, profile, tasks, training, audit file, service requests, network give nothing or are refused', async () => {
    const q = `from=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`;
    for (const u of ['members', 'activity', 'profile-questions', 'obligations', 'verifiers', 'service-requests', 'network/case-posts', 'audit-chain/verify', `audit-report?format=json&${q}`]) {
      expect((await ex.get(`${C()}/${u}`)).status, u).toBe(403);
    }
    for (const u of ['documents', 'tasks', 'training/courses', 'training/assignments', 'qr', 'verification-queue']) {
      const r = await ex.get(`${C()}/${u}`);
      expect(r.status, u).toBe(200);
      expect(r.body, u).toEqual([]);
      expect(JSON.stringify(r.body)).not.toMatch(SECRET);
    }
    expect((await ex.get(`${C()}/board`)).body.sections).toEqual({ actions: [], tasks: [], cases: [] });
  });

  it('case data: only the assigned case is listed and readable; the other one looks missing', async () => {
    const list = (await ex.get(`${C()}/nonconformities`)).body as any[];
    expect(list.map(x => x.id)).toEqual([assigned]);
    expect(JSON.stringify(list)).not.toMatch(SECRET);
    expect((await ex.get(`${C()}/nonconformities/${assigned}`)).status).toBe(200);
    expect((await ex.get(`${C()}/nonconformities/${other}`)).status).toBe(404);
    const d = (await ex.get(`${C()}/nonconformities/${assigned}`)).body;
    expect(JSON.stringify(d)).not.toMatch(/GIZLI SUBE|BASKA VAKA|GIZLI BELGE/);
  });
});
