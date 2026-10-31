import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_RULES, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** A non-demo deployment: example content and demo resets must be refused. */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;

beforeAll(async () => {
  env = await freshEnv({ demoMode: false, allowExampleRules: false });
  platform = await seedPlatform(env.db);
});
afterAll(async () => { await env?.close(); });

describe('production guards', () => {
  it('refuses to publish an example rule', async () => {
    const author = client(env, platform.author.token), reviewer = client(env, platform.reviewer.token), admin = client(env, platform.admin.token);
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-GLOVE')!;
    const v = await author.post('/admin/rule-versions', { ...base, provisionIds: [], changeReason: 'Örnek: yeni sürüm denemesi' });
    expect(v.status).toBe(201);
    await author.post(`/admin/rule-versions/${v.body.id}/submit`);
    await reviewer.post(`/admin/rule-versions/${v.body.id}/approve`);
    const pub = await admin.post(`/admin/rule-versions/${v.body.id}/publish`);
    expect(pub.status).toBe(403);
    expect(pub.body.error.message).toContain('demo');
  });

  it('refuses demo reset', async () => {
    expect((await client(env, platform.admin.token).post('/admin/demo/reset')).status).toBe(403);
  });

  it('refuses a real legal requirement without a source provision', async () => {
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-LPG-CHECK')!;
    const r = await client(env, platform.author.token).post('/admin/rule-versions', { ...base, code: 'REAL-LPG', isExample: false, provisionIds: [] });
    expect(r.status).toBe(422);
  });
});
