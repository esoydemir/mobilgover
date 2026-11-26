import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  errorKindOf, fetchWithRetry, normText, parseConsolidated, requireHtml, sameHost, scanConsolidated, scanGazette,
  SourceError, type FetchResult, type Fetcher, type WatchDoc,
} from '../src/services/legislation-sources';

const fx = (n: string) => readFileSync(new URL(`./fixtures/legislation/${n}`, import.meta.url));
const html = (s: string | Buffer, contentType = 'text/html; charset=utf-8'): FetchResult => ({ status: 200, body: new Uint8Array(typeof s === 'string' ? Buffer.from(s) : s), contentType });
const noSleep = async () => {};
const WATCH: WatchDoc = { tur: 7, no: 15592, tertip: 5, label: 'Gıda Hijyeni Yönetmeliği' };
const page = (articles: Record<string, string>) => `<html><body><p><b>TEST YÖNETMELİĞİ</b></p>${Object.entries(articles).map(([id, t]) => `<p><b>MADDE ${id} –</b> ${t}</p>`).join('')}<p>padding padding padding padding padding padding padding padding padding</p></body></html>`;
const prevOf = (a: Record<string, string>) => parseConsolidated(page(a)).articles; // what a good earlier read of this page stored
const art = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), `Madde ${i + 1} metni burada yazılıdır.`]));

describe('recorded live page (Gıda Hijyeni Yönetmeliği, Mevzuat, 18.11.2026)', () => {
  const raw = html(fx('mevzuat-gida-hijyeni-2026-11-18.html'));
  const parsed = parseConsolidated(requireHtml(raw, 'x'));
  it('splits the real page into its 31 numbered articles with the provisions the inventory relies on', () => {
    expect(Object.keys(parsed.articles).filter(k => /^\d+$/.test(k))).toHaveLength(30);
    expect(parsed.articles['G1']).toBeDefined(); // the one geçici madde
    expect(parsed.articles['17']).toMatch(/kişisel temizliğini sürdürmeye/);
    expect(parsed.articles['18']).toMatch(/soğuk zincirin kırılmaması/);
    expect(parsed.articles['22']).toMatch(/HACCP/);
  });
  it('reading the same page twice, or with invisible/spacing noise, produces no change', () => {
    const noisy = Buffer.from(fx('mevzuat-gida-hijyeni-2026-11-18.html')).toString('utf8')
      .replace(/ Gıda /g, ' Gıda ').replace(/işletmecisi/g, 'işletme​cisi').replace(/<\/p>/g, '</p>\r\n\r\n   ');
    const again = parseConsolidated(requireHtml(html(noisy), 'x'));
    expect(Object.keys(again.articles)).toEqual(Object.keys(parsed.articles));
    for (const k of Object.keys(parsed.articles)) expect(normText(again.articles[k]!)).toBe(normText(parsed.articles[k]!));
  });
  it('a real numeric edit is still a change (normalisation keeps meaning)', () => {
    expect(normText('en az 8 saat')).not.toBe(normText('en az 9 saat'));
    expect(normText('Gıda işletmecisi')).not.toBe(normText('gıda işletmecisi'));
    expect(normText('a b​  c')).toBe('a b c');
  });
});

describe('failure kinds are told apart', () => {
  it('timeout, blocked, not found, server error and network are different kinds', async () => {
    const t: Fetcher = async () => { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; };
    const k = async (f: Fetcher) => (await fetchWithRetry(f, 'https://x.test/', { sleep: noSleep }).catch(e => e)) as SourceError;
    expect((await k(t)).kind).toBe('timeout');
    expect((await k(async () => ({ status: 403, body: new Uint8Array(), contentType: null }))).kind).toBe('blocked');
    expect((await k(async () => ({ status: 429, body: new Uint8Array(), contentType: null }))).kind).toBe('blocked');
    expect((await k(async () => ({ status: 404, body: new Uint8Array(), contentType: null }))).kind).toBe('not_found');
    expect((await k(async () => ({ status: 503, body: new Uint8Array(), contentType: null }))).kind).toBe('http_error');
    expect((await k(async () => { throw new Error('ECONNRESET'); })).kind).toBe('network');
    expect(errorKindOf((await k(t)).message)).toBe('timeout');
  });
  it('a 200 answer that is empty, a PDF, JSON or a robot page is refused with its own kind', () => {
    const kind = (r: FetchResult) => { try { requireHtml(r, 'https://x.test/'); return 'ok'; } catch (e) { return (e as SourceError).kind; } };
    expect(kind(html(''))).toBe('empty');
    expect(kind(html('<html></html>'))).toBe('empty');
    expect(kind(html('%PDF-1.7 ' + 'x'.repeat(400), 'application/pdf'))).toBe('unexpected_format');
    expect(kind(html('{"a":1}'.padEnd(300, ' '), 'application/json'))).toBe('unexpected_format');
    expect(kind(html('just plain words '.repeat(30), 'text/plain'))).toBe('unexpected_format');
    expect(kind(html('<html><body><h1>Access Denied</h1><p>Request blocked.</p>' + '<!-- -->'.repeat(30) + '</body></html>'))).toBe('blocked');
    expect(kind(html(page(art(3))))).toBe('ok');
  });
});

describe('Mevzuat connector: unreadable is never "no change"', () => {
  const read = (pages: (string | FetchResult)[]) => { let i = 0; const f: Fetcher = async () => { const p = pages[Math.min(i++, pages.length - 1)]!; return typeof p === 'string' ? html(p) : p; }; return f; };
  const scan = (f: Fetcher, prev: Record<string, string> | null, w: WatchDoc = WATCH) =>
    scanConsolidated({ baseUrl: 'https://www.mevzuat.gov.tr', watch: [w], previous: new Map(prev ? [['mv:7.5.15592', prev]] : []), fetcher: f, today: '2026-11-18', sleep: noSleep });

  it('first read is a baseline with its article and document counts, no change', async () => {
    const out = await scan(read([page(art(10))]), null);
    expect(out).toMatchObject({ seen: 10, docsRead: 1, errors: [] });
    expect(out.changes).toHaveLength(0);
    expect(out.snapshots).toHaveLength(1);
  });
  it('a truncated read (far fewer articles) is a corrupt error: no snapshot, no repeal records', async () => {
    const out = await scan(read([page(art(3))]), art(10));
    expect(out.errors[0]).toContain("[bozuk/eksik metin]");
    expect(out.snapshots).toHaveLength(0);
    expect(out.changes).toHaveLength(0);
    expect(out.docsRead).toBe(0);
  });
  it('a page with no articles, a PDF and a block page are errors, never "unchanged"', async () => {
    for (const [p, kind] of [[page({}), 'unexpected_format'], [html('%PDF-1.4 ' + 'x'.repeat(400), 'application/pdf'), 'unexpected_format'], [html('<html><body>' + 'Access Denied '.repeat(5) + '</body></html>'.padEnd(200, ' ')), 'blocked']] as const) {
      const out = await scan(read([p]), art(10));
      expect(out.errors).toHaveLength(1);
      expect(errorKindOf(out.errors[0]!)).toBe(kind);
      expect(out.snapshots).toHaveLength(0);
    }
  });
  it('an unchanged text, even re-spaced, yields no change; one edited article yields exactly one amendment', async () => {
    const base = art(10);
    const same = await scan(read([page(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.replace(/ /g, '  ')])))]), prevOf(base));
    expect(same.changes).toHaveLength(0);
    const edited = await scan(read([page({ ...base, '4': 'Madde 4 metni burada yazılıdır, 5 gün içinde.' })]), prevOf(base));
    expect(edited.changes).toHaveLength(1);
    expect(edited.changes[0]).toMatchObject({ articleRef: '4', changeType: 'article_amendment' });
  });
  it('the article filter reports only watched articles but keeps the whole text as baseline', async () => {
    const base = art(10);
    const now = { ...base, '2': 'değişti iki', '7': 'değişti yedi' };
    const out = await scan(read([page(now)]), prevOf(base), { ...WATCH, articles: ['7'] });
    expect(out.changes.map(c => c.articleRef)).toEqual(['7']);
    expect(Object.keys(out.snapshots[0]!.articles)).toHaveLength(10);
  });
});

describe('Resmî Gazete connector: only the configured source is contacted', () => {
  const base = 'https://www.resmigazete.gov.tr';
  const index = (href: string) => `<div id="gunluk-akis"><div id="html-content" class="html-content"><div class="card-title html-title" tabindex='0'> YÜRÜTME VE İDARE BÖLÜMÜ </div><div class="html-subtitle" tabindex='0'> YÖNETMELİK </div><div class="fihrist-item mb-1"><a href="${href}" data-modal="True">Gıda Hijyeni Yönetmeliğinde Değişiklik Yapılmasına Dair Yönetmelik</a></div></div></div>` + '<!-- -->'.repeat(30);
  it('does not fetch a document link that points to another host', async () => {
    const asked: string[] = [];
    const f: Fetcher = async url => { asked.push(url); return html(index('https://baska-site.example/belge.htm')); };
    const out = await scanGazette({ baseUrl: base, today: '2026-11-18', lookbackDays: 0, fetcher: f, sleep: noSleep });
    expect(asked).toEqual([`${base}/fihrist?tarih=2026-11-18`, `${base}/fihrist?tarih=2026-11-18&mukerrer=1`]); // day list and its extra issue, never the other host
    expect(out.errors).toHaveLength(1);
    expect(errorKindOf(out.errors[0]!)).toBe('refused_link');
    expect(out.docsRead).toBe(0);
  });
  it('a day list that is not the gazette list format is an error, not "nothing published"', async () => {
    const f: Fetcher = async () => html('<html><body><h1>Bakım</h1><p>Site bakımda, daha sonra tekrar deneyin.</p>' + '<!-- -->'.repeat(30) + '</body></html>');
    const out = await scanGazette({ baseUrl: base, today: '2026-11-18', lookbackDays: 0, fetcher: f, sleep: noSleep });
    expect(errorKindOf(out.errors[0]!)).toBe('unexpected_format');
  });
  it('a same-host document is read and counted; www and bare host are the same host', async () => {
    expect(sameHost('https://resmigazete.gov.tr/a', 'https://www.resmigazete.gov.tr')).toBe(true);
    expect(sameHost('https://resmigazete.gov.tr.evil.test/a', 'https://www.resmigazete.gov.tr')).toBe(false);
    const doc = '<html><body><div>Resmî Gazete</div><div>Sayı : 99001</div><div>YÖNETMELİK</div><div>Sağlık Bakanlığından:</div><p>MADDE 1- Bu madde metni yeterince uzundur ve test içindir.</p><p>MADDE 2- Bu Yönetmelik yayımı tarihinde yürürlüğe girer.</p>' + '<!-- -->'.repeat(30) + '</body></html>';
    const f: Fetcher = async url => html(url.includes('/fihrist') ? index('/eskiler/2026/11/20261118-1.htm') : doc);
    const out = await scanGazette({ baseUrl: base, today: '2026-11-18', lookbackDays: 0, fetcher: f, sleep: noSleep });
    expect(out.errors).toEqual([]);
    expect(out.docsRead).toBe(1);
    expect(out.changes).toHaveLength(1);
  });
});

describe('real Resmî Gazete item (Peynir Tebliği 2026/24, RG 10.11.2026)', () => {
  it('"yayımı tarihinde" next to a later transition date is NOT a plain known date', async () => {
    const real = html(fx('rg-20261110-7-peynir-tebligi.htm'), 'text/html; charset=windows-1254');
    const idx = '<div id="gunluk-akis"><div id="html-content" class="html-content"><div class="html-subtitle"> TEBLİĞ </div><div class="fihrist-item mb-1"><a href="/eskiler/2026/11/20261110-7.htm">Türk Gıda Kodeksi Peynir Tebliği (No: 2026/24)</a></div></div></div>' + '<!-- -->'.repeat(30);
    const f: Fetcher = async url => (url.includes('/fihrist') ? html(idx) : real);
    const out = await scanGazette({ baseUrl: 'https://www.resmigazete.gov.tr', today: '2026-11-10', lookbackDays: 0, fetcher: f, sleep: noSleep });
    expect(out.errors).toEqual([]);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]!.effective.status).toBe('unclear');
    expect(out.changes[0]!.effective.note).toContain('30.04.2027');
  });
  it('the title of a consolidated text is its whole heading block', () => {
    expect(parseConsolidated(Buffer.from(fx('mevzuat-gida-hijyeni-2026-11-18.html')).toString('utf8')).title).toBe('GIDA HİJYENİ YÖNETMELİĞİ');
    expect(parseConsolidated('<body><p>10559 VETERİNER HİZMETLERİ KANUNU</p><p>Kanun Numarası : 5996</p><p>MADDE 1- metin metin</p></body>').title).toBe('VETERİNER HİZMETLERİ KANUNU');
    expect(parseConsolidated('<body><p>TEBLİĞ (TEBLİĞ NO: 2014/47) Amaç</p><p>MADDE 1- metin metin</p></body>').title).toBe('TEBLİĞ (TEBLİĞ NO: 2014/47)');
    expect(parseConsolidated('<body><p>TÜRK</p><p>GIDA KODEKSİ TEBLİĞİ</p><p>MADDE 1- metin metin</p></body>').title).toBe('TÜRK GIDA KODEKSİ TEBLİĞİ');
  });
});
