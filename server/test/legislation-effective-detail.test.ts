import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveDetail, parseGazetteDocument, scanGazette, type Fetcher } from '../src/services/legislation-sources';

const real = readFileSync(new URL('./fixtures/legislation/rg-20261110-7-peynir-tebligi.htm', import.meta.url));
const html = (b: Uint8Array | string, ct = 'text/html; charset=windows-1254') => ({ status: 200, body: typeof b === 'string' ? new TextEncoder().encode(b) : b, contentType: ct });

describe('Peynir Tebliği (2026/24): effective-date parts are separate fields', () => {
  it('general clause, transition dates and scope come out apart; nothing is decided', async () => {
    const idx = '<div id="gunluk-akis"><div id="html-content" class="html-content"><div class="html-subtitle"> TEBLİĞ </div><div class="fihrist-item mb-1"><a href="/eskiler/2026/11/20261110-7.htm">Türk Gıda Kodeksi Peynir Tebliği (No: 2026/24)</a></div></div></div>' + '<!-- -->'.repeat(30);
    const f: Fetcher = async url => (url.includes('/fihrist') ? html(idx, 'text/html; charset=utf-8') : html(new Uint8Array(real)));
    const out = await scanGazette({ baseUrl: 'https://www.resmigazete.gov.tr', today: '2026-11-10', lookbackDays: 0, fetcher: f, sleep: async () => {} });
    expect(out.errors).toEqual([]);
    const c = out.changes[0]!;
    const d = c.suggestion.effectiveDetail as ReturnType<typeof effectiveDetail>;
    expect(c.effective.status).toBe('unclear');
    expect(d.general.clause).toMatch(/yayımı tarihinde yürürlüğe girer/);
    expect(d.transitional.length).toBeGreaterThanOrEqual(1);
    expect(d.transitional.every(t => t.dates.every(x => x > '2026-11-10'))).toBe(true);
    expect(d.transitional.map(t => t.dates).flat()).toContain('2027-04-30');
    expect(d.transitional.some(t => /dilimlenebilir eritme peynir/i.test(t.sentence))).toBe(true);
    expect(d.scope?.articleId).toBe('2'); // heading "Kapsam" trails article 1; the scope article is 2
    expect(d.scope?.text).toMatch(/peynirleri kapsar/i);
    expect(c.suggestion.effectiveDetail).not.toHaveProperty('appliesTo'); // no applicability verdict
  });
  it('an instrument with no later dates has an empty transition list', () => {
    const doc = parseGazetteDocument('<html><body><div>Resmî Gazete</div><div>Sayı : 1</div><p>MADDE 1- Bu Yönetmelik hijyen kurallarını kapsar ve yeterince uzundur.</p><p>MADDE 2- Bu Yönetmelik yayımı tarihinde yürürlüğe girer.</p></body></html>', { title: 'x', publishedOn: '2026-11-10' });
    const d = effectiveDetail(doc, '2026-11-10');
    expect(d.transitional).toEqual([]);
    expect(d.general.articleIds).toEqual(['2']);
  });
});
