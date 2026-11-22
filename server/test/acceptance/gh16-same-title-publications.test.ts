import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { runScan } from '../../src/services/legislation';
import { istanbulDay, sectorRelevance } from '../../src/services/legislation-sources';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Aynı başlıklı iki resmî yayın tek satıra çökmez: son 14 gün listesi KAYNAK YAYIN KİMLİĞİYLE ayırır; her satırın kendi bağlantısı ve gerekçesi vardır.
 * Metni okunamayan yayın "okunamadı" durumuyla görünür. Tüm yayınlar SENTETİKTİR (sentetik.test).
 */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay(); const ymd = today.replaceAll('-', '');
const TITLE = 'Tebliğde Değişiklik Yapılmasına Dair Tebliğ';
const cnt = async (sql: string) => Number((await env.ownerDb.query(sql)).rows[0].n);
const overview = async () => (await client(env, platform.admin.token).get('/admin/legislation/overview')).body;

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db);
  src.publish(today, { id: `${ymd}-71`, category: 'TEBLİĞLER', title: TITLE, sayi: 99071, articles: ['Orman yangını gözetleme kulelerinin süresi uzatılmıştır.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${ymd}-72`, category: 'TEBLİĞLER', title: TITLE, sayi: 99072, articles: ['Balıkçı barınaklarında ağ onarım süresi değiştirilmiştir.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${ymd}-73`, category: 'TEBLİĞLER', title: TITLE, sayi: 99073, articles: ['Metin okunamayacak.'] });
  src.unreadable.add(`${ymd}-73`);
});
afterAll(async () => { await env?.close(); });

describe('GH-16 aynı başlıklı yayınlar ayrı izlenir', () => {
  it('başlık aynı, kimlik ve metin farklı: yönetici üç ayrı satır, üç ayrı bağlantı ve ayrı gerekçe görür', async () => {
    expect(sectorRelevance(TITLE).level).toBe('out');
    const r = await runScan(env.db, src.config(), { trigger: 'manual' }); if ('skipped' in r) throw new Error('atlandı');
    const g = r.results.find(x => x.source === 'resmi_gazete')!;
    expect(g.skipped).toHaveLength(2); expect(g.unreadable).toHaveLength(1); expect(g.created).toBe(0);
    const rows = (await overview()).recentSkipped as any[];
    expect(rows).toHaveLength(3); expect(new Set(rows.map(x => x.key)).size).toBe(3); expect(new Set(rows.map(x => x.url)).size).toBe(3);
    const a = rows.find(x => x.key.endsWith('-71')), b = rows.find(x => x.key.endsWith('-72')), u = rows.find(x => x.key.endsWith('-73'));
    expect(a.url).toMatch(/-71\.htm/); expect(b.url).toMatch(/-72\.htm/);
    expect(a.status).toBe('out_of_scope'); expect(b.status).toBe('out_of_scope'); expect(a.why).not.toBe(b.why);
    expect(a.why).toMatch(/Orman/); expect(b.why).toMatch(/Balıkçı/);
    expect(u).toMatchObject({ status: 'unreadable', title: TITLE }); expect(u.why).toMatch(/okunamadı/);
  });

  it('tekrar taramada satır sayısı değişmez (üç), tarama sayısı artar; kuyruğa ve işletmeye hiçbir şey eklenmez', async () => {
    const q = await cnt(`SELECT count(*)::int AS n FROM legislation_changes`); const t = await cnt(`SELECT count(*)::int AS n FROM tasks`);
    await runScan(env.db, src.config(), { trigger: 'manual' }); await runScan(env.db, src.config(), { trigger: 'manual' });
    const rows = (await overview()).recentSkipped as any[];
    expect(rows).toHaveLength(3); expect(rows.every(x => x.scans === 3)).toBe(true);
    expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(q); expect(await cnt(`SELECT count(*)::int AS n FROM tasks`)).toBe(t);
  });

  it('okunamayan yayın okunabilir hale gelince kuyruğa/atlanan listesine kendi kimliğiyle geçer; öteki satırlar etkilenmez', async () => {
    src.unreadable.delete(`${ymd}-73`);
    await runScan(env.db, src.config(), { trigger: 'manual' });
    const rows = (await overview()).recentSkipped as any[];
    expect(rows).toHaveLength(3);
    expect(rows.find(x => x.key.endsWith('-73')).status).toBe('out_of_scope');
    expect(rows.find(x => x.key.endsWith('-71')).status).toBe('out_of_scope');
  });
});
