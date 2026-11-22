import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatform } from '../../src/seed/demo';
import { runScan } from '../../src/services/legislation';
import { istanbulDay, sectorRelevance } from '../../src/services/legislation-sources';
import { client, freshEnv, type Env } from '../support/env';
import { SyntheticSource } from '../support/legislation-fixtures';

/**
 * Başlığı yalnız "… Değişiklik Yapılmasına Dair …" olan yayın hangi iş koluna ait olduğunu başlıkta söylemez. Önce: "Yapılmasına" içindeki "yapı"
 * genel sözcük sayılıp YANLIŞ NEDENLE "belirsiz" oluyordu; metinde sektör olmayan benzeri ise kapsam dışı olup yalnız son taramanın kartında görünüyordu.
 * Şimdi: değişiklik/kaldırma başlığı için metin okunur; metinde desteklenen iş kolu geçiyorsa BELİRSİZ (insan), geçmiyorsa kapsam dışı ve 14 günlük listede kalır.
 */
let env: Env; let platform: Awaited<ReturnType<typeof seedPlatform>>;
const src = new SyntheticSource(); const today = istanbulDay();
const GEN = 'Tebliğde Değişiklik Yapılmasına Dair Tebliğ';

beforeAll(async () => {
  env = await freshEnv({ legislation: src.config() }); platform = await seedPlatform(env.db);
  src.publish(today, { id: `${today.replaceAll('-', '')}-31`, category: 'TEBLİĞLER', title: GEN, sayi: 99031, articles: ['Gayrimenkul aracılık hizmeti veren işletmelerin yetki sözleşmesi saklama süresi 10 yıla çıkarılmıştır.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] });
  src.publish(today, { id: `${today.replaceAll('-', '')}-32`, category: 'TEBLİĞLER', title: 'Orman Tebliğinde Değişiklik Yapılmasına Dair Tebliğ', sayi: 99032, articles: ['Orman yangını gözetleme kulelerinin süresi uzatılmıştır.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] });
});
afterAll(async () => { await env?.close(); });

describe('GH-14 başlığı genel değişiklik tebliği', () => {
  it('başlık tek başına: "yapı" fiil ekinde eşleşmez; gerçek "yapı/bina" sözcüğü hâlâ genel sayılır', () => {
    expect(sectorRelevance(GEN).level).toBe('out');
    expect(sectorRelevance('Yapı Denetimi Yönetmeliği').level).toBe('uncertain');
    expect(sectorRelevance('Binaların Enerji Performansı Yönetmeliği').level).toBe('uncertain');
  });

  it('metinde iş kolu geçen genel başlık BELİRSİZ olarak kuyruğa girer (nedeni ve metindeki sözcük kayıtlı); metinde yoksa kapsam dışı kalır', async () => {
    const r = await runScan(env.db, src.config(), { trigger: 'manual' });
    if ('skipped' in r) throw new Error('atlandı');
    const g = r.results.find(x => x.source === 'resmi_gazete')!;
    expect({ seen: g.seen, selected: g.selected, uncertain: g.uncertain, skipped: g.skipped.length, created: g.created }).toEqual({ seen: 2, selected: 0, uncertain: 1, skipped: 1, created: 1 });
    const row = (await env.ownerDb.query(`SELECT status, suggestion FROM legislation_changes WHERE doc_title = $1`, [GEN])).rows[0];
    expect(row.status).toBe('pending'); expect(row.suggestion).toMatchObject({ matchLevel: 'uncertain', bodySectors: ['estate'] });
    expect(row.suggestion.relevance).toMatch(/Gayrimenkul/i); expect(row.suggestion.relevance).not.toMatch(/"Yapı"/);
    expect(g.skipped[0]!.title).toMatch(/Orman/); expect(g.skipped[0]!.why).toMatch(/metinde/);
  });

  it('kapsam dışı sayılanlar yönetici ekranının verisinde son 14 gün boyunca kalır; sonraki taramada kaybolmaz', async () => {
    await runScan(env.db, src.config(), { trigger: 'manual' });
    const ov = (await client(env, platform.admin.token).get('/admin/legislation/overview')).body;
    expect(ov.recentSkipped).toHaveLength(1);
    expect(ov.recentSkipped[0]).toMatchObject({ title: 'Orman Tebliğinde Değişiklik Yapılmasına Dair Tebliğ', scans: 2 });
    const q = (await client(env, platform.admin.token).get('/admin/legislation/changes?status=pending')).body as any[];
    expect(q.find(x => x.doc_title === GEN).body_sectors).toEqual(['estate']);
  });
});
