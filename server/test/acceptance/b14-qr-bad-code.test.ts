import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** B-14: a damaged QR gets the same plain refusal as an unknown or inaccessible one; no record detail reaches an unauthorized person. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await env?.close(); });

describe('B-14 damaged and foreign codes', () => {
  it('malformed, short, foreign-URL and unknown tokens all answer the same 404 message', async () => {
    const staff = client(env, demo.users.staff.token);
    const unknown = await staff.get(`/qr/resolve?token=${'A'.repeat(32)}`);
    expect(unknown.status).toBe(404);
    for (const bad of ['abc', 'kisa%20kod', encodeURIComponent('https://baska-site.example/x?y=1'), 'a'.repeat(200), 'ğüşiöç' + 'x'.repeat(30)]) {
      const r = await staff.get(`/qr/resolve?token=${bad}`);
      expect(r.status, bad).toBe(404);
      expect(r.body.error.message).toBe(unknown.body.error.message);
    }
  });

  it('a real code the person may not open also looks like an unknown one', async () => {
    const owner = client(env, demo.users.owner.token);
    const made = await owner.post(`/companies/${demo.companyId}/qr`, { kind: 'equipment', refId: demo.fridgeId });
    expect(made.status).toBe(201);
    const token = made.body.token as string;
    const outsider = await env.db.system(async tx => {
      const id = (await tx.query(`INSERT INTO users (display_name) VALUES ('Yabancı') RETURNING id`)).rows[0].id;
      return (await import('../../src/services/principal')).createSession(tx, id, 24);
    });
    const r = await client(env, outsider).get(`/qr/resolve?token=${token}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/Dolap|Buzdolabı|Kahve/);
  });
});
