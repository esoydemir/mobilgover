import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FileReadError, readGazettePdf } from '../src/services/filetext';
import { oldestUnverifiedDay } from '../src/services/legislation';
import { gazetteKey, scanGazette, type Fetcher, type FetchResult, type PdfReader } from '../src/services/legislation-sources';

/*
 * Regression for the November 2026 outage: the gazette serves board and presidential decisions as PDF only. The scan refused
 * them ("unexpected_format") and the source stayed unhealthy. Inputs are the OFFICIAL day list of 20.11.2026 and the official
 * 20261120-3.pdf, whose body is a JBIG2 page image under a header-only text layer.
 */
const fx = (n: string) => readFileSync(new URL(`./fixtures/legislation/${n}`, import.meta.url));
const BASE = 'https://www.resmigazete.gov.tr';
const LIST = fx('rg-fihrist-2026-11-20.html');
const PDF = new Uint8Array(fx('rg-20261120-3.pdf'));
const ok = (body: Uint8Array, contentType: string, url: string): FetchResult => ({ status: 200, body, contentType, url });
const text = (s: string, url: string) => ok(new TextEncoder().encode(s), 'text/html; charset=utf-8', url);
const home = () => text('<div id="gunluk-akis"><div id="html-content" class="html-content"></div></div>' + ' '.repeat(200), `${BASE}/`);
/** The real list; only the one recorded PDF is served, every other publication answers with a short readable page. */
const site = (over: (url: string) => FetchResult | null = () => null): Fetcher => async url => over(url) ?? (
  url.includes('mukerrer=') ? home()
    : url.includes('fihrist?tarih=') ? ok(new Uint8Array(LIST), 'text/html; charset=utf-8', url)
      : url.endsWith('20261120-3.pdf') ? ok(PDF, 'application/pdf', url)
        : text('<body><p>MADDE 1- Sentetik yedek metin; bu testte okunmayan yayın.</p><p>' + 'metin '.repeat(60) + '</p></body>', url));
const scan = (fetcher: Fetcher, readPdf: PdfReader | undefined, today = '2026-11-20', lookbackDays = 0) =>
  scanGazette({ baseUrl: BASE, today, lookbackDays, fetcher, readPdf, sleep: async () => {} });
const stub = (t: string, confidence = 90): PdfReader => async () => ({ text: t, confidence, pages: 1 });
const BODY = 'Resmi Gazete Sayı : 33436\nKURUL KARARI\n' + 'MADDE 1- Akaryakıt fiyat takibi değişmiştir. '.repeat(8) + '\nMADDE 2- Bu Karar yayımı tarihinde yürürlüğe girer.';

describe('Resmî Gazete publications served as PDF', () => {
  it('reads the recorded official PDF (body included) and proposes it with an undecided effective date', async () => {
    const r = await scan(site(), readGazettePdf);
    expect(r.unreadable.filter(u => u.key === 'rg:20261120-3')).toEqual([]);
    const c = r.changes.find(x => x.externalKey === 'rg:20261120-3')!;
    expect(c).toBeTruthy();
    expect(c.docRef).toContain('33436');
    expect(c.newText).toContain('makineyle okundu');
    expect(c.newText).toMatch(/Platts European Market Scan/); // only on the page image: blank without the JBIG2 decoder
    expect(c.effective).toMatchObject({ status: 'unclear', date: null });
    expect(c.suggestion).toMatchObject({ readMethod: 'ocr_pdf', readPages: 1 });
    expect(c.sourceUrl).toBe(`${BASE}/eskiler/2026/11/20261120-3.pdf`);
  }, 120_000);

  it('keeps an untrustworthy reading unreadable instead of queueing it', async () => {
    for (const reader of [stub(BODY, 40), stub('Resmi Gazete Sayı : 33436', 95), undefined]) {
      const r = await scan(site(), reader);
      expect(r.changes.map(c => c.externalKey)).not.toContain('rg:20261120-3');
      expect(r.unreadable.map(u => u.key)).toContain('rg:20261120-3');
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  // 27.11.2026: a 113 page regulation (Bina Yangın Yönetmeliği) was refused for its length on every attempt and never reached a person.
  it('queues a publication that is too long to machine-read, clearly marked as unread, for a person to open', async () => {
    const tooLong: PdfReader = async () => { throw new FileReadError('too_large', 'Dosya 113 sayfa; en çok 40 sayfa makineyle okunur.'); };
    const r = await scan(site(), tooLong);
    const c = r.changes.find(x => x.externalKey === 'rg:20261120-3')!;
    expect(c).toBeTruthy();
    expect(c.newText).toMatch(/^\[Metin makineyle okunmadı: Dosya 113 sayfa/);
    expect(c.effective).toMatchObject({ status: 'unclear', date: null });
    expect(c.suggestion).toMatchObject({ readMethod: 'not_read', needsHumanClassification: true });
    expect((c.suggestion as { relevance: string }).relevance).toContain('Metin okunmadı');
    expect(r.unreadable).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.notes.join()).toContain('elle inceleme');
    expect(r.docsRead).toBe((await scan(site(), stub(BODY))).docsRead - r.changes.filter(x => x.suggestion.readMethod === 'not_read').length);
  });

  it('does not count a day list redirected to the home page as an empty healthy day', async () => {
    const redirected = site(url => url.endsWith('fihrist?tarih=2026-11-20') ? home() : null);
    const past = await scan(redirected, stub(BODY), '2026-11-21', 1);
    expect(past.errors.join()).toContain('2026-11-20:');
    const today = await scan(redirected, stub(BODY), '2026-11-20');
    expect(today.errors).toEqual([]);
    expect(today.notes.join()).toContain('henüz yayımlanmamış');
  });

  it('reads the extra (mükerrer) issue of a day', async () => {
    const extra = '<div id="gunluk-akis"><div id="html-content" class="html-content"><div class="html-subtitle"> KURUL KARARI </div>' +
      '<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/11/20261120M1-1.pdf" data-modal="True">Enerji Piyasası Düzenleme Kurulunun Sentetik Mükerrer Elektrik Kararı</a></div></div></div>';
    const r = await scan(site(url => url.endsWith('&mukerrer=1') ? text(extra, url) : url.endsWith('M1-1.pdf') ? ok(PDF, 'application/pdf', url) : null), stub(BODY));
    expect(r.changes.map(c => c.externalKey)).toContain('rg:20261120M1-1');
    expect(r.notes.join()).toContain('mükerrer');
  });

  it('keeps an announcement apart from the publication that has the same file name', () => {
    expect(gazetteKey(`${BASE}/eskiler/2026/11/20261120-3.pdf`)).toBe('rg:20261120-3');
    expect(gazetteKey(`${BASE}/ilanlar/eskiilanlar/2026/11/20261120-3.htm`)).toBe('rg:ilan-20261120-3');
    expect(oldestUnverifiedDay([{ unreadable: [{ key: 'rg:ilan-20261112-2' }] }])).toBe('2026-11-12');
  });

  it('finds the oldest day a run could not verify', () => {
    expect(oldestUnverifiedDay([{ errors: ['2026-11-15: zaman aşımı', 'Bir başlık: hata'], unreadable: [{ key: 'rg:20261111-1.pdf' }] }, { unreadable: [{ key: 'mv:1.5.9001' }] }])).toBe('2026-11-11');
    expect(oldestUnverifiedDay([{ errors: [], unreadable: [] }])).toBeNull();
  });
});
