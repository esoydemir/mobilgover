import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { runScan } from '../../src/services/legislation';
import { istanbulDay, sectorRelevance } from '../../src/services/legislation-sources';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Çok sektörlü mevzuat keşfi (SENTETİK kaynak, sentetik.test). Önce yalnız gıda sözcükleri aday seçiyordu: elektrik ve emlak yayınları
 * "gıda güvenliği ifadesi yok" diye SESSİZCE atlanıyordu. Şimdi desteklenen üç iş kolu eşleşir, yalnız genel sözcük taşıyan başlık
 * "belirsiz" olarak insana gider, hiçbiriyle ilgisi olmayan atlanır — nedeni kayıtlı. Kural metinleri ÖRNEKTİR.
 */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>; let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const src = new SyntheticSource(); const today = istanbulDay();
const T = { elec: 'Sentetik Elektrik Tesislerinde Topraklama Ölçümleri Yönetmeliği', estate: 'Sentetik Taşınmaz Ticareti Aracılık Yönetmeliği', unsure: 'Sentetik İşyeri Denetim Esasları Yönetmeliği', out: 'Sentetik Orman Yangınlarıyla Mücadele Yönetmeliği' };
const cnt = async (sql: string) => Number((await env.ownerDb.query(sql)).rows[0].n);
const business = async () => ({ tasks: await cnt(`SELECT count(*)::int AS n FROM tasks`), notifs: await cnt(`SELECT count(*)::int AS n FROM notifications`), obligations: await cnt(`SELECT count(*)::int AS n FROM obligations`) });

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db); demo = await seedDemoCompany(env.db);
  src.publish(today, { id: `${today.replaceAll('-', '')}-11`, category: 'YÖNETMELİKLER', title: T.elec, sayi: 99011, articles: ['Elektrik tesislerinde topraklama direnci her yıl ölçülür ve kaydedilir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${today.replaceAll('-', '')}-12`, category: 'YÖNETMELİKLER', title: T.estate, sayi: 99012, articles: ['Taşınmaz ticareti yapanlar yetki sözleşmelerinin dosyasını saklar.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${today.replaceAll('-', '')}-13`, category: 'YÖNETMELİKLER', title: T.unsure, sayi: 99013, articles: ['İşyerlerinde denetim esasları belirlenir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${today.replaceAll('-', '')}-14`, category: 'YÖNETMELİKLER', title: T.out, sayi: 99014, articles: ['Orman yangınlarıyla mücadele esasları.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
});
afterAll(async () => { await env?.close(); });

describe('GH-13 çok sektörlü mevzuat keşfi', () => {
  it('başlık sınıflandırması: üç iş kolu eşleşir, genel sözcük belirsizdir, gerisi kapsam dışıdır (nedeniyle)', () => {
    expect(sectorRelevance(T.elec)).toMatchObject({ level: 'clear', sectors: ['electrical'] });
    expect(sectorRelevance(T.estate)).toMatchObject({ level: 'clear', sectors: ['estate'] });
    expect(sectorRelevance('Gıda İşletmeleri Yönetmeliği')).toMatchObject({ level: 'clear', sectors: ['food'] });
    expect(sectorRelevance(T.unsure)).toMatchObject({ level: 'uncertain', sectors: [] });
    expect(sectorRelevance(T.out)).toMatchObject({ level: 'out' }); expect(sectorRelevance(T.out).why).toMatch(/hiçbirine/);
    expect(sectorRelevance('Üniversitesi Elektrik Uygulama ve Araştırma Merkezi Yönetmeliği').level).toBe('out');
    expect(sectorRelevance('Panorama Sergi Yönetmeliği').level).toBe('out'); // "pano" sözcük içinde eşleşmez
    expect(sectorRelevance('Kafe ve Restoran İşletmeleri Yönetmeliği')).toMatchObject({ level: 'clear', sectors: ['food'] }); // "kafe" kelime sınırı eşleşir
    expect(sectorRelevance('Kafeterya Eğitim Yönetmeliği').level).toBe('out');
  });

  it('aşamalar ayrı ölçülür: görülen 4 → aday 2 + belirsiz 1 → kapsam dışı 1 → kuyruğa 3; onaydan önce işletme etkisi sıfır', async () => {
    const before = await business();
    const r = await runScan(env.db, src.config(), { trigger: 'manual' });
    if ('skipped' in r) throw new Error('taramada atlandı');
    const g = r.results.find(x => x.source === 'resmi_gazete')!;
    expect({ seen: g.seen, selected: g.selected, uncertain: g.uncertain, skipped: g.skipped.length, docsRead: g.docsRead, created: g.created }).toEqual({ seen: 4, selected: 2, uncertain: 1, skipped: 1, docsRead: 3, created: 3 });
    expect(g.skipped[0]).toMatchObject({ title: T.out }); expect(g.skipped[0]!.why).toMatch(/gıda, elektrik, emlak/);
    expect(await business()).toEqual(before); // kuyruğa düşmek hiçbir işletmeyi etkilemez
    const rows = (await env.ownerDb.query(`SELECT doc_title, status, suggestion->>'matchLevel' AS lvl, suggestion->'sectors' AS sectors, is_example FROM legislation_changes ORDER BY doc_title`)).rows;
    expect(rows.map(x => [x.doc_title, x.status, x.lvl])).toEqual([[T.unsure, 'pending', 'uncertain'], [T.estate, 'pending', 'clear'], [T.elec, 'pending', 'clear']].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'tr')));
    expect(rows.every(x => x.is_example)).toBe(true);
  });

  it('tekrar taramada aday sayısı sabit kalır; yönetici ekranı son taramanın aşamalarını ve belirsiz eşleşmeyi gösterir', async () => {
    const n = await cnt(`SELECT count(*)::int AS n FROM legislation_changes`);
    const r = await runScan(env.db, src.config(), { trigger: 'manual' });
    if ('skipped' in r) throw new Error('taramada atlandı');
    const g = r.results.find(x => x.source === 'resmi_gazete')!;
    expect(g.created).toBe(0); expect(g.selected).toBe(2); expect(await cnt(`SELECT count(*)::int AS n FROM legislation_changes`)).toBe(n);
    const admin = client(env, platform.admin.token);
    const ov = (await admin.get('/admin/legislation/overview')).body; const res = ov.lastRun.results.find((x: any) => x.source === 'resmi_gazete');
    expect(res).toMatchObject({ seen: 4, selected: 2, uncertain: 1, created: 0 });
    const list = (await admin.get('/admin/legislation/changes?status=pending')).body as any[];
    expect(list.find(x => x.doc_title === T.unsure).match_level).toBe('uncertain');
    expect(list.find(x => x.doc_title === T.elec).sectors).toEqual(['electrical']);
  });

  it('belirsiz yayın insan incelemesinde: reddedilir; hiçbir işletme etkilenmez ve görev oluşmaz', async () => {
    const before = await business();
    const id = (await env.ownerDb.query(`SELECT id FROM legislation_changes WHERE doc_title = $1`, [T.unsure])).rows[0].id as string;
    const rej = await client(env, platform.reviewer.token).post(`/admin/legislation/changes/${id}/reject`, { reason: 'Başlık genel; desteklenen iş kollarıyla ilgisi yok (sentetik).' });
    expect(rej.status).toBe(200);
    expect(await business()).toEqual(before);
    expect(demo.companyId).toBeTruthy();
  });
});
