import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Group 1: form (template) version is bound to records, older records still open, vault "missing file" filter. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 20);
});
afterAll(async () => { await env?.close(); });

const tasks = async () => (await owner().get(`${C()}/tasks?siteId=${demo.siteId}&from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 20 * 864e5).toISOString()}`)).body as any[];

describe('the form version is bound to the record', () => {
  it('a note keeps the template and rule version it was written against; an older record without it still opens', async () => {
    const t = (await tasks())[0];
    const d0 = (await owner().get(`${C()}/tasks/${t.id}`)).body;
    const n = await owner().post(`${C()}/tasks/${t.id}/evidence`, { kind: 'note', text: 'Kayıt, form sürümüne bağlanmalı.' });
    expect(n.status).toBe(201);
    const row = (await env.ownerDb.query(`SELECT body FROM evidence WHERE id = $1`, [n.body.id])).rows[0].body;
    expect(row.form).toMatchObject({ templateCode: expect.any(String), ruleCode: expect.any(String), ruleVersion: d0.rule.version });
    // A record created before this binding existed has no "form"; the task must still open and count it.
    await env.ownerDb.query(`INSERT INTO evidence (company_id, task_id, kind, status, body, created_by, stored_at) VALUES ($1,$2,'note','stored',$3,$4, now())`,
      [demo.companyId, t.id, JSON.stringify({ text: 'Eski kayıt (form sürümü yok).' }), demo.users.owner.id]);
    const d = await owner().get(`${C()}/tasks/${t.id}`);
    expect(d.status).toBe(200);
    expect(d.body.rule.version).toBe(d0.rule.version);
  });
});

describe('document vault: "Eksik" filter lists documents without a file', () => {
  it('a document with no uploaded file shows under no_file and not under expired', async () => {
    const mk = await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'İşyeri açma ruhsatı (dosya yok)', siteId: demo.siteId });
    expect(mk.status).toBe(201);
    const all = (await owner().get(`${C()}/documents`)).body as any[];
    const missing = (await owner().get(`${C()}/documents?filter=no_file`)).body as any[];
    expect(missing.map(d => d.id)).toContain(mk.body.id);
    expect(missing.every(d => d.status === 'no_file')).toBe(true);
    expect(missing.length).toBeLessThanOrEqual(all.length);
    expect(((await owner().get(`${C()}/documents?filter=expired`)).body as any[]).map(d => d.id)).not.toContain(mk.body.id);
  });
});
