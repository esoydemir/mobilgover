import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { runScan } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/** A publication that could not be read must not slide out of the scan window, and reading it later queues it exactly once. */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay();
const day = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const old = day(-2); const id = `${old.replaceAll('-', '')}-1`;
const cnt = async (sql: string) => Number((await env.ownerDb.query(sql)).rows[0].n);
const business = async () => ({ tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), obl: await cnt(`SELECT count(*)::int AS n FROM obligations`) });
const gazette = async (now: Date) => { const r = await runScan(env.db, src.config(), { trigger: 'manual', now }); if ('skipped' in r) throw new Error('atlandı'); return r.results.find(x => x.source === 'resmi_gazete')!; };
const overview = async () => (await client(env, platform.admin.token).get('/admin/legislation/overview')).body;
const queued = () => cnt(`SELECT count(*)::int AS n FROM legislation_changes WHERE source_code = 'resmi_gazete'`);

beforeAll(async () => {
  src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: { '1': 'Amaç: gıda güvenliği.' } });
  env = await freshEnv({ legislation: src.config() });
  platform = await seedPlatform(env.db);
  src.publish(old, { id, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri Soğuk Zincir Yönetmeliği', articles: ['Soğuk zincir korunur.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
});
afterAll(async () => { await env?.close(); });

describe('recovery after an unreadable publication', () => {
  it('reaches back to the unread day, queues it once, and stops listing it as unreadable', async () => {
    src.unreadable.add(id);
    const first = await gazette(new Date());
    expect(first.ok).toBe(false); expect(first.unreadable).toHaveLength(1);
    expect((await overview()).recentSkipped.map((x: any) => x.status)).toContain('unreadable');
    const before = await business();

    // Five days later the configured two-day window no longer covers the unread day.
    src.unreadable.clear();
    const later = new Date(Date.now() + 5 * 86_400_000);
    const second = await gazette(later);
    expect(second.ok).toBe(true); expect(second.created).toBe(1);
    expect(await queued()).toBe(1);
    expect((await overview()).recentSkipped.filter((x: any) => x.status === 'unreadable')).toEqual([]);

    const third = await gazette(new Date(later.getTime() + 60_000));
    expect(third.created).toBe(0);
    expect(await queued()).toBe(1);
    expect(await business()).toEqual(before);
  });
});
