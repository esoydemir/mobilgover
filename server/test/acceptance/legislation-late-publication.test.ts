import { describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { legislationTick } from '../../src/services/legislation';
import { istanbulDay } from '../../src/services/legislation-sources';
import { client, freshEnv } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/** A late issue must not close the day: the scheduled scan keeps its retries until the day list has actually been read. */
describe('today’s issue is published after the scheduled hour', () => {
  it('retries the same day, queues the issue once when it appears, then stops', async () => {
    const day = istanbulDay(); const t = (hm: string) => new Date(`${day}T${hm}:00+03:00`);
    const src = new SyntheticSource(); const id = `${day.replaceAll('-', '')}-1`;
    src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: { '1': 'Amaç: gıda güvenliği.' } });
    const cfg = src.config({ enabled: true, scanHour: 6 });
    const env = await freshEnv({ legislation: cfg });
    try {
      const platform = await seedPlatform(env.db);
      src.late.add(day);
      const runs = async () => Number((await env.ownerDb.query(`SELECT count(*)::int AS n FROM legislation_scan_runs WHERE trigger = 'schedule'`)).rows[0].n);
      const queued = async () => Number((await env.ownerDb.query(`SELECT count(*)::int AS n FROM legislation_changes WHERE source_code = 'resmi_gazete'`)).rows[0].n);
      const schedule = async () => (await client(env, platform.admin.token).get('/admin/legislation/overview')).body.schedule;

      await legislationTick(env.db, cfg, t('06:00'));
      expect(await runs()).toBe(1);
      // The sources answered, so this is not a source failure; but the day is not finished either.
      expect((await schedule()).retry).toMatchObject({ attempts: 1, awaitingToday: true, exhausted: false });

      await legislationTick(env.db, cfg, t('06:10'));
      expect(await runs()).toBe(1); // the usual waiting time applies
      src.late.delete(day);
      src.publish(day, { id, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri Soğuk Zincir Yönetmeliği (ÖRNEK)', sayi: 99401, articles: ['Soğuk zincir korunur.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
      await legislationTick(env.db, cfg, t('06:31'));
      expect(await runs()).toBe(2);
      expect(await queued()).toBe(1);
      expect((await schedule()).retry).toBeNull();

      await legislationTick(env.db, cfg, t('23:00'));
      expect(await runs()).toBe(2);
      expect(await queued()).toBe(1);
    } finally { await env.close(); }
  });
});
