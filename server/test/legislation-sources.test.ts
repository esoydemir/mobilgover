import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareTexts, decodeHtml, errorKindOf, fetchWithRetry, foodSafetyRelevance, normText, parseConsolidated, parseEffective, parseGazetteDocument, parseGazetteIndex, parseWatchList, requireHtml, scanConsolidated, scanGazette, sameHost, SourceError, type Fetcher, type FetchResult } from '../src/services/legislation-sources';

const fx = (n: string) => readFileSync(new URL(`./fixtures/legislation/${n}`, import.meta.url), 'latin1');

describe('connectors on recorded official pages', () => {
  it('reads the Resmî Gazete daily index', () => {
    const items = parseGazetteIndex(fx('rg-fihrist-2026-10-17.html'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.title && i.url)).toBe(true);
  });
  it('reads a Resmî Gazete document', () => {
    const d = parseGazetteDocument(fx('rg-20261017-2.htm'), { title: 'x', publishedOn: '2026-10-17' });
    expect(d.articles.length).toBeGreaterThan(0);
    expect(d.text.length).toBeGreaterThan(100);
  });
  it('splits a Mevzuat consolidated page into articles', () => {
    const c = parseConsolidated(fx('mevzuat-5996-parca.html'));
    expect(Object.keys(c.articles).length).toBeGreaterThan(0);
  });
});

describe('date and relevance rules', () => {
  it('only "yayımı tarihinde" or one explicit date is a known effective date', () => {
    expect(parseEffective(['Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'], '2026-10-17')).toMatchObject({ status: 'known', date: '2026-10-17' });
    expect(parseEffective(['Bu Yönetmelik 01.01.2027 tarihinde yürürlüğe girer.'], '2026-10-17')).toMatchObject({ status: 'known', date: '2027-01-01' });
    expect(parseEffective(['Bu Yönetmelik yayımını izleyen ayın başında yürürlüğe girer.'], '2026-10-17').status).toBe('unclear');
    expect(parseEffective(['Madde 1 01.01.2027, madde 2 01.07.2027 tarihinde yürürlüğe girer.'], '2026-10-17').status).toBe('unclear');
    expect(parseEffective([], '2026-10-17').status).toBe('unclear');
  });
  it('food-safety relevance excludes university and centre regulations', () => {
    expect(foodSafetyRelevance('Gıda İşletmeleri Yönetmeliği').relevant).toBe(true);
    expect(foodSafetyRelevance('Üniversitesi Gıda Uygulama ve Araştırma Merkezi Yönetmeliği').relevant).toBe(false);
  });
  it('text comparison only suggests: added and removed words, changed numbers', () => {
    const c = compareTexts('Soğuk zincir 8 derece', 'Soğuk zincir 4 derece altında');
    expect(c.addedWords).toEqual(expect.arrayContaining(['altında']));
    expect(JSON.stringify(c)).toContain('4');
  });
  it('watch list env format', () => {
    expect(parseWatchList('1:5996:5:Kanun,7:99:5:Yön')).toHaveLength(2);
    expect(parseWatchList(undefined)).toHaveLength(6);
    const f = parseWatchList('1:5996:5:Kanun 5996:m=22;24;29')[0]!;
    expect(f.label).toBe('Kanun 5996');
    expect(f.articles).toEqual(['22', '24', '29']);
    expect(parseWatchList('7:1:5:A:B')[0]).toMatchObject({ label: 'A:B' });
  });
  it('decodes windows-1254 pages', () => {
    const body = new Uint8Array([0x47, 0xFD, 0x64, 0xFD]); // "Gıdı" in windows-1254
    expect(decodeHtml({ status: 200, body, contentType: 'text/html; charset=windows-1254' })).toBe('Gıdı');
  });
});

describe('retry', () => {
  it('retries transient failures, stops on a missing page, and gives up with an error', async () => {
    let n = 0;
    const flaky: Fetcher = async () => { n++; if (n < 3) throw new Error('ağ'); return { status: 200, body: new Uint8Array(), contentType: null }; };
    await expect(fetchWithRetry(flaky, 'https://x.test/', { sleep: async () => {} })).resolves.toMatchObject({ status: 200 });
    expect(n).toBe(3);
    let m = 0;
    const missing: Fetcher = async () => { m++; return { status: 404, body: new Uint8Array(), contentType: null }; };
    await fetchWithRetry(missing, 'https://x.test/', { sleep: async () => {} }).catch(() => {});
    expect(m).toBe(1);
    const dead: Fetcher = async () => { throw new Error('kapalı'); };
    await expect(fetchWithRetry(dead, 'https://x.test/', { sleep: async () => {} })).rejects.toThrow();
  });
});
