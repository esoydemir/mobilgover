import type { FetchResult, Fetcher } from '../../src/services/legislation-sources';
import { legislationConfig, type LegislationConfig } from '../../src/services/legislation';

/**
 * A SYNTHETIC official-looking source (host sentetik.test: not an official host, so everything it yields is an EXAMPLE).
 * It serves Resmî Gazete-shaped index/detail pages and Mevzuat-shaped consolidated text, and can be switched off.
 */
export type SynthItem = { id: string; category: string; title: string; articles: string[]; sayi?: number; effective?: string };
export class SyntheticSource {
  days = new Map<string, SynthItem[]>();
  consolidated = new Map<string, { title: string; articles: Record<string, string> }>();
  down = false;
  /** A reachable but unusable answer, to tell failure kinds apart: timeout, blocked (403), empty body, a PDF, a robot page. */
  fail: null | 'timeout' | 'blocked' | 'empty' | 'pdf' | 'robot' = null;
  calls: string[] = [];
  readonly rg = 'https://sentetik.test/rg';
  readonly mv = 'https://sentetik.test/mv';

  publish(day: string, item: SynthItem) { this.days.set(day, [...(this.days.get(day) ?? []), item]); }
  fetcher: Fetcher = async (url): Promise<FetchResult> => {
    this.calls.push(url);
    if (this.down) throw new Error('bağlantı kesildi (sentetik kesinti)');
    if (this.fail === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; }
    if (this.fail === 'blocked') return { status: 403, body: new Uint8Array(), contentType: 'text/html' };
    if (this.fail === 'empty') return { status: 200, body: new Uint8Array(), contentType: 'text/html' };
    if (this.fail === 'pdf') return { status: 200, body: new TextEncoder().encode('%PDF-1.7 ' + 'x'.repeat(400)), contentType: 'application/pdf' };
    if (this.fail === 'robot') return { status: 200, body: new TextEncoder().encode('<html><body><h1>Access Denied</h1><p>Request blocked. ' + 'x '.repeat(80) + '</p></body></html>'), contentType: 'text/html' };
    const html = (s: string): FetchResult => ({ status: 200, body: new TextEncoder().encode(s), contentType: 'text/html; charset=utf-8' });
    const idx = /\/rg\/fihrist\?tarih=(\d{4}-\d{2}-\d{2})/.exec(url);
    if (idx) {
      const items = this.days.get(idx[1]!) ?? [];
      const by = new Map<string, SynthItem[]>();
      for (const it of items) by.set(it.category, [...(by.get(it.category) ?? []), it]);
      const body = [...by].map(([cat, xs]) => `<div class="card-title html-title" tabindex='0'> YÜRÜTME VE İDARE BÖLÜMÜ </div><div class="html-subtitle" tabindex='0'> ${cat} </div>` +
        xs.map(x => `<div class="fihrist-item mb-1"><a href="https://sentetik.test/rg/eskiler/${x.id}.htm" data-modal="True">${x.title}</a></div>`).join('')).join('');
      return html(`<div id="gunluk-akis"><div id="html-content" class="html-content">${body}</div></div>`);
    }
    const det = /\/rg\/eskiler\/([\w-]+)\.htm/.exec(url);
    if (det) {
      for (const [, items] of this.days) {
        const it = items.find(x => x.id === det[1]);
        if (it) return html(`<html><body><div>Resmî Gazete</div><div>Sayı : ${it.sayi ?? 99001}</div><div>YÖNETMELİK</div><div>Sentetik Bakanlığından:</div><div>${it.title}</div>` +
          it.articles.map((a, i) => `<p>MADDE ${i + 1}- ${a}</p>`).join('') + `</body></html>`);
      }
      return { status: 404, body: new Uint8Array(), contentType: 'text/html' };
    }
    const mv = /MevzuatTur=(\d+)&MevzuatNo=(\d+)&MevzuatTertip=(\d+)/.exec(url);
    if (mv) {
      const d = this.consolidated.get(`${mv[1]}.${mv[3]}.${mv[2]}`);
      if (!d) return { status: 404, body: new Uint8Array(), contentType: 'text/html' };
      return html(`<body><p><b>${d.title}</b></p>` + Object.entries(d.articles).map(([id, t]) => `<p><b>MADDE ${id}-</b> ${t}</p>`).join('') + '</body>');
    }
    return { status: 404, body: new Uint8Array(), contentType: 'text/html' };
  };
  config(over: Partial<LegislationConfig> = {}): LegislationConfig {
    return legislationConfig({}, { rgBase: this.rg, mevzuatBase: this.mv, watch: [{ tur: 1, no: 9001, tertip: 5, label: 'Sentetik Gıda Kanunu' }], lookbackDays: 2, fetcher: this.fetcher, sleep: async () => {}, allowExampleRules: true, enabled: true, scanHour: 6, ...over });
  }
}
