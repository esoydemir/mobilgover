import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** After a profile answer changes, the response names WHICH checks changed (by title), so the screen can show the before/after difference. */
let env: Env; let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await env?.close(); });

describe('profil yanıtı sonrası fark', () => {
  it('değişen her kontrol okunur bir başlıkla döner; ikinci kez aynı yanıt fark üretmez', async () => {
    const owner = client(env, demo.users.owner.token);
    const demoVal = true; const post = (v: boolean) => owner.post(`/companies/${demo.companyId}/profile/facts`, { siteId: demo.siteId, key: 'activity.food_preparation', value: v, source: 'user_declared', verification: 'user_confirmed' });
    await post(true); const first = await post(false); expect(first.status).toBe(201);
    const all = first.body.recomputed.flatMap((r: any) => r.changed);
    for (const c of all) { expect(typeof c.title).toBe('string'); expect(c.title).not.toBe(''); expect(c.title).not.toBe(c.ruleCode); }
    const again = await post(false);
    expect(again.body.recomputed.flatMap((r: any) => r.changed).filter((c: any) => c.from !== c.to)).toEqual([]);
  });
});
