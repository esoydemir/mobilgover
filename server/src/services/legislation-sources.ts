import { createHash } from 'node:crypto';

/*
 * Source connectors for the legislation watch. Pure parsing + an injected fetcher, so the same code runs against the
 * official sites (Resmî Gazete, Mevzuat Bilgi Sistemi) and against recorded or synthetic pages in tests.
 * A connector only DETECTS: it never decides what applies to a business.
 */

export type FetchResult = { status: number; body: Uint8Array; contentType: string | null };
export type Fetcher = (url: string) => Promise<FetchResult>;

export const OFFICIAL_HOSTS = { resmi_gazete: 'resmigazete.gov.tr', mevzuat: 'mevzuat.gov.tr' } as const;
export type SourceCode = keyof typeof OFFICIAL_HOSTS;

export const defaultFetcher: Fetcher = async url => {
  const r = await fetch(url, { headers: { 'user-agent': 'GoverHubLegislationWatch/1.0 (+yerel pilot; gunluk tarama)', accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  return { status: r.status, body: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
};

/** A fetch that retries transient failures (network error, 5xx, 429) with growing waits; returns the final answer or throws. */
export async function fetchWithRetry(fetcher: Fetcher, url: string, o: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<FetchResult> {
  const attempts = o.attempts ?? 3;
  const sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  let last = 'bilinmeyen hata';
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetcher(url);
      if (r.status >= 200 && r.status < 300) return r;
      last = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break; // not transient: 404/403 will not fix itself within seconds
    } catch (e) { last = (e as Error).message || String(e); }
    if (i < attempts) await sleep(1000 * 2 ** (i - 1));
  }
  throw new Error(`${url} okunamadı (${last})`);
}

export function decodeHtml(r: FetchResult): string {
  const head = Buffer.from(r.body.slice(0, 2000)).toString('latin1');
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(r.contentType ?? '') ?? /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  const cs = (m?.[1] ?? 'utf-8').toLowerCase();
  try { return new TextDecoder(cs === 'windows-1254' || cs === 'iso-8859-9' ? 'windows-1254' : cs).decode(r.body); } catch { return new TextDecoder('utf-8').decode(r.body); }
}

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const normText = (s: string) => s.replace(/\s+/g, ' ').trim();

// ── Dates ──
const MONTHS: Record<string, number> = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 };
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
/** All calendar dates written in a clause (14/11/2026, 14.11.2026, 1 Ocak 2027). */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*[\/.]\s*(\d{4})/g)) { const d = iso(+m[3]!, +m[2]!, +m[1]!); if (d) out.push(d); }
  for (const m of text.matchAll(/(\d{1,2})\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(\d{4})/gi)) { const d = iso(+m[3]!, MONTHS[m[2]!.toLocaleLowerCase('tr')]!, +m[1]!); if (d) out.push(d); }
  return out;
}
export const trDate = (iso_: string | null) => iso_ ? iso_.split('-').reverse().join('.') : '—';

export type EffectiveDate = { status: 'known' | 'unclear'; date: string | null; note: string };
/**
 * Entry into force from the text of an instrument. Only two plain forms are read as known: "yayımı tarihinde" and one
 * explicit date. Anything else (staggered dates, "yayımını izleyen ... ay", missing clause) is UNCLEAR: an administrator must
 * resolve it, and an unclear change cannot be approved.
 */
export function parseEffective(clauses: string[], publishedOn: string | null): EffectiveDate {
  const c = clauses.map(normText).filter(Boolean);
  if (!c.length) return { status: 'unclear', date: null, note: 'Metinde yürürlük maddesi bulunamadı.' };
  const joined = c.join(' ');
  if (c.length > 1) return { status: 'unclear', date: null, note: `Birden çok yürürlük hükmü var: ${joined.slice(0, 240)}` };
  const dates = [...new Set(datesIn(joined))];
  const onPublish = /yayımı\s+tarihinde|yayımlandığı\s+tarihte|yayım\s+tarihinde/i.test(joined);
  const staged = /yayımını\s+izleyen|yayımından\s+\S+\s+(ay|gün|yıl)|sonra\s+yürürlüğe|izleyen\s+(ay|yıl|mali)/i.test(joined);
  if (staged) return { status: 'unclear', date: null, note: `Yürürlük başka bir olaya/süreye bağlı: ${joined.slice(0, 240)}` };
  if (onPublish && !dates.length) return publishedOn ? { status: 'known', date: publishedOn, note: 'Yayımı tarihinde yürürlüğe girer.' } : { status: 'unclear', date: null, note: 'Yayım tarihi okunamadı.' };
  if (dates.length === 1 && !onPublish) return { status: 'known', date: dates[0]!, note: `Metinde yazılı tarih: ${trDate(dates[0]!)}.` };
  return { status: 'unclear', date: null, note: `Yürürlük tarihi tek ve açık değil: ${joined.slice(0, 240)}` };
}

// ── Relevance (first scope: food safety for cafés and restaurants) ──
const FOOD_TERMS = /gıda|hijyen|lokanta|restoran|kafe\b|yiyecek|i[çc]ecek|alerjen|soğuk zincir|bozulabilir|umumi hıfzıssıhha|yeme[\s-]*i[çc]me|tüketime sunulan|gıda i[şs]letme/i;
const NOT_FOOD = /üniversite|yüksekokul|uygulama ve araştırma merkezi|araştırma ve uygulama merkezi|enstitü/i;
export function foodSafetyRelevance(title: string): { relevant: boolean; why: string } {
  if (NOT_FOOD.test(title)) return { relevant: false, why: 'Üniversite/merkez düzenlemesi: kapsam dışı.' };
  const m = FOOD_TERMS.exec(title);
  return m ? { relevant: true, why: `Başlıkta "${m[0]}" geçiyor (gıda güvenliği kapsamı).` } : { relevant: false, why: 'Başlıkta gıda güvenliği ifadesi yok.' };
}

// ── Detected change (what a connector yields) ──
export type DetectedChange = {
  sourceCode: SourceCode; externalKey: string; changeType: 'new_publication' | 'article_amendment' | 'repeal';
  docRef: string; docTitle: string; articleRef: string | null; sourceUrl: string; publishedOn: string | null;
  effective: EffectiveDate; oldText: string | null; newText: string | null; suggestion: Record<string, unknown>;
};

/** Words added / removed between two texts: a hint for the reviewer, not a verdict. */
export function compareTexts(oldText: string | null, newText: string | null) {
  const w = (s: string | null) => normText(s ?? '').split(' ').filter(Boolean);
  const a = w(oldText), b = w(newText);
  const A = new Set(a.map(x => x.toLocaleLowerCase('tr'))), B = new Set(b.map(x => x.toLocaleLowerCase('tr')));
  const added = [...new Set(b.filter(x => !A.has(x.toLocaleLowerCase('tr'))))].slice(0, 40);
  const removed = [...new Set(a.filter(x => !B.has(x.toLocaleLowerCase('tr'))))].slice(0, 40);
  const numbers = (s: string | null) => [...new Set((s ?? '').match(/\d[\d.,]*/g) ?? [])];
  const nOld = numbers(oldText), nNew = numbers(newText);
  return { addedWords: added, removedWords: removed, changedNumbers: { from: nOld.filter(x => !nNew.includes(x)), to: nNew.filter(x => !nOld.includes(x)) }, oldLength: a.length, newLength: b.length };
}

// ── Resmî Gazete ──
export type GazetteItem = { section: string; category: string; url: string; title: string };
export function parseGazetteIndex(html: string): GazetteItem[] {
  const out: GazetteItem[] = [];
  let section = '', category = '';
  const re = /<div class="card-title html-title"[^>]*>\s*([^<]*?)\s*<\/div>|<div class="html-subtitle"[^>]*>\s*([^<]*?)\s*<\/div>|<div class="fihrist-item[^"]*"[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] !== undefined) section = htmlToText(m[1]);
    else if (m[2] !== undefined) category = htmlToText(m[2]);
    else out.push({ section, category, url: m[3]!, title: htmlToText(m[4]!).replace(/^[–—-]+\s*/, '').trim() });
  }
  return out;
}

export function changeTypeFromTitle(title: string): DetectedChange['changeType'] {
  if (/yürürlükten\s+kaldırılmasına\s+dair/i.test(title)) return 'repeal';
  if (/de(ğ|g)i[şs]iklik\s+yapılmasına\s+dair/i.test(title)) return 'article_amendment';
  return 'new_publication';
}

export type GazetteDocument = { sayi: string | null; publishedOn: string | null; issuer: string | null; title: string; articles: { id: string; text: string }[]; effectiveClauses: string[]; text: string };
export function parseGazetteDocument(html: string, fallback: { title: string; publishedOn: string | null }): GazetteDocument {
  const text = htmlToText(html);
  const sayi = /Resm[iîı]\s+Gazete\s*(?:\n|\s)*Say[ıi]\s*:\s*(\d{4,6})/i.exec(text)?.[1] ?? null;
  const issuer = /\n([^\n]{3,90}?(?:Bakanlığından|Başkanlığından|Kurumundan|Kurulundan|Genel Müdürlüğünden)):?\s*\n/.exec(text)?.[1] ?? null;
  const articles: { id: string; text: string }[] = [];
  const marks = [...text.matchAll(/(?:^|\n)\s*(GEÇİCİ\s+MADDE|EK\s+MADDE|MADDE)\s+(\d+)\s*[-–—]/g)];
  marks.forEach((m, i) => {
    const prefix = m[1]!.startsWith('GEÇİCİ') ? 'G' : m[1]!.startsWith('EK') ? 'E' : '';
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    articles.push({ id: prefix + m[2], text: normText(text.slice(m.index! + m[0].length, end)) });
  });
  const effectiveClauses = articles.filter(a => /yürürlüğe\s+gir/i.test(a.text) && !/^G/.test(a.id) && a.text.length < 600).map(a => a.text);
  return { sayi, publishedOn: fallback.publishedOn, issuer, title: fallback.title, articles, effectiveClauses, text };
}

export type ScanOutcome = { seen: number; changes: DetectedChange[]; errors: string[]; snapshots: { docKey: string; title: string; url: string; articles: Record<string, string> }[]; notes: string[] };

/** The date list of a scan window, newest last, in the Istanbul calendar. */
export function istanbulDay(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d); }
export function daysBack(today: string, n: number): string[] {
  const t = Date.parse(today + 'T00:00:00Z');
  return Array.from({ length: n + 1 }, (_, i) => new Date(t - (n - i) * 86_400_000).toISOString().slice(0, 10));
}

export async function scanGazette(o: { baseUrl: string; today: string; lookbackDays: number; fetcher: Fetcher; sleep?: (ms: number) => Promise<void> }): Promise<ScanOutcome> {
  const out: ScanOutcome = { seen: 0, changes: [], errors: [], snapshots: [], notes: [] };
  const base = o.baseUrl.replace(/\/+$/, '');
  for (const day of daysBack(o.today, o.lookbackDays)) {
    let items: GazetteItem[];
    try {
      const r = await fetchWithRetry(o.fetcher, `${base}/fihrist?tarih=${day}`, { sleep: o.sleep });
      items = parseGazetteIndex(decodeHtml(r));
    } catch (e) { out.errors.push(`${day}: ${(e as Error).message}`); continue; }
    out.seen += items.length;
    for (const it of items) {
      const rel = foodSafetyRelevance(it.title);
      if (!rel.relevant) continue;
      try {
        const url = new URL(it.url, base + '/').toString();
        const doc = parseGazetteDocument(decodeHtml(await fetchWithRetry(o.fetcher, url, { sleep: o.sleep })), { title: it.title, publishedOn: day });
        const type = changeTypeFromTitle(it.title);
        const eff = parseEffective(doc.effectiveClauses, day);
        const file = url.split('/').pop()!.replace(/\.html?$/i, '');
        const newText = type === 'repeal' ? null : doc.articles.filter(a => !doc.effectiveClauses.includes(a.text)).map(a => `MADDE ${a.id} – ${a.text}`).join('\n\n') || doc.text.slice(0, 4000);
        out.changes.push({
          sourceCode: 'resmi_gazete', externalKey: `rg:${file}`, changeType: type,
          docRef: `Resmî Gazete ${doc.sayi ?? '(sayı okunamadı)'} · ${trDate(day)}`, docTitle: it.title, articleRef: null, sourceUrl: url, publishedOn: day, effective: eff,
          oldText: null, newText,
          suggestion: { relevance: rel.why, category: it.category, issuer: doc.issuer, kind: type,
            hint: type === 'article_amendment' ? 'Değişiklik metni var; değişen maddenin eski metni için ilgili mevzuatın birleştirilmiş metnine bakın.' : type === 'repeal' ? 'Yürürlükten kaldırma: ilgili kural sürümü için bitiş tarihi önerilir.' : 'Yeni düzenleme: kural koşulunu ve görevleri uzman yazmalı.',
            ...compareTexts(null, newText) },
        });
      } catch (e) { out.errors.push(`${it.title.slice(0, 80)}: ${(e as Error).message}`); }
    }
  }
  return out;
}

// ── Mevzuat Bilgi Sistemi (consolidated text, compared with the last snapshot) ──
export type WatchDoc = { tur: number; no: number; tertip: number; label: string };
export const DEFAULT_MEVZUAT_WATCH: WatchDoc[] = [{ tur: 1, no: 5996, tertip: 5, label: 'Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem Kanunu' }];
export const parseWatchList = (s: string | undefined): WatchDoc[] => !s?.trim() ? DEFAULT_MEVZUAT_WATCH
  : s.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [tur, no, tertip, ...label] = x.split(':'); return { tur: Number(tur), no: Number(no), tertip: Number(tertip), label: label.join(':') || `Mevzuat ${no}` }; })
    .filter(w => w.tur > 0 && w.no > 0 && w.tertip > 0);
const watchKey = (w: WatchDoc) => `mv:${w.tur}.${w.tertip}.${w.no}`;

export function parseConsolidated(html: string): { title: string; articles: Record<string, string> } {
  const text = htmlToText(html);
  const title = text.split('\n').find(l => l.trim().length > 8)?.trim() ?? 'Başlıksız';
  const articles: Record<string, string> = {};
  const marks = [...text.matchAll(/(?:^|\n)\s*(GEÇİCİ\s+MADDE|EK\s+MADDE|MADDE)\s+(\d+(?:\/[A-Za-z0-9]+)?)\s*[-–—]/g)];
  marks.forEach((m, i) => {
    const prefix = m[1]!.startsWith('GEÇİCİ') ? 'G' : m[1]!.startsWith('EK') ? 'E' : '';
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    articles[prefix + m[2]] = normText(text.slice(m.index! + m[0].length, end));
  });
  return { title, articles };
}

export async function scanConsolidated(o: { baseUrl: string; watch: WatchDoc[]; previous: Map<string, Record<string, string>>; fetcher: Fetcher; today: string; sleep?: (ms: number) => Promise<void> }): Promise<ScanOutcome> {
  const out: ScanOutcome = { seen: 0, changes: [], errors: [], snapshots: [], notes: [] };
  const base = o.baseUrl.replace(/\/+$/, '');
  for (const w of o.watch) {
    const url = `${base}/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=${w.tur}&MevzuatNo=${w.no}&MevzuatTertip=${w.tertip}`;
    try {
      const parsed = parseConsolidated(decodeHtml(await fetchWithRetry(o.fetcher, url, { sleep: o.sleep })));
      if (!Object.keys(parsed.articles).length) throw new Error('metinde madde bulunamadı (sayfa biçimi değişmiş olabilir)');
      out.seen += Object.keys(parsed.articles).length;
      const key = watchKey(w);
      out.snapshots.push({ docKey: key, title: parsed.title, url, articles: parsed.articles });
      const prev = o.previous.get(key);
      if (!prev) { out.notes.push(`${w.label}: ilk okuma, karşılaştırma tabanı kaydedildi (değişiklik üretilmedi).`); continue; }
      const mulga = (t: string | undefined) => !!t && /^\(?\s*mülga/i.test(t);
      for (const [id, now] of Object.entries(parsed.articles)) {
        const before = prev[id];
        if (before !== undefined && normText(before) === normText(now)) continue;
        const repealed = mulga(now) && !mulga(before);
        const type: DetectedChange['changeType'] = before === undefined ? 'new_publication' : repealed ? 'repeal' : 'article_amendment';
        out.changes.push({
          sourceCode: 'mevzuat', externalKey: `${key}:${id}:${sha(type === 'repeal' ? 'MULGA' : normText(now)).slice(0, 16)}`, changeType: type,
          docRef: `${w.label} (Mevzuat ${w.no})`, docTitle: parsed.title, articleRef: id, sourceUrl: url, publishedOn: null,
          effective: { status: 'unclear', date: null, note: 'Birleştirilmiş metinde yürürlük tarihi ayrı yazılmaz; ilgili Resmî Gazete ilanındaki yürürlük maddesine bakılmalı.' },
          oldText: before ?? null, newText: type === 'repeal' ? null : now,
          suggestion: { relevance: 'İzleme listesindeki mevzuat.', kind: type, ...compareTexts(before ?? null, type === 'repeal' ? null : now) },
        });
      }
      for (const id of Object.keys(prev)) {
        if (parsed.articles[id] === undefined && !mulga(prev[id])) {
          out.changes.push({
            sourceCode: 'mevzuat', externalKey: `${key}:${id}:${sha('REMOVED').slice(0, 16)}`, changeType: 'repeal',
            docRef: `${w.label} (Mevzuat ${w.no})`, docTitle: parsed.title, articleRef: id, sourceUrl: url, publishedOn: null,
            effective: { status: 'unclear', date: null, note: 'Madde birleştirilmiş metinden kalktı; yürürlük tarihi Resmî Gazete ilanından doğrulanmalı.' },
            oldText: prev[id]!, newText: null, suggestion: { relevance: 'İzleme listesindeki mevzuat.', kind: 'repeal', ...compareTexts(prev[id]!, null) },
          });
        }
      }
    } catch (e) { out.errors.push(`${w.label}: ${(e as Error).message}`); }
  }
  return out;
}
