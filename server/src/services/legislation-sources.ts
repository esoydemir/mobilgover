import { createHash } from 'node:crypto';

/*
 * Source connectors for the legislation watch. Pure parsing + an injected fetcher, so the same code runs against the
 * official sites (Resmî Gazete, Mevzuat Bilgi Sistemi) and against recorded or synthetic pages in tests.
 * A connector only DETECTS: it never decides what applies to a business.
 */

/** `url`: the address that actually answered (after redirects). */
export type FetchResult = { status: number; body: Uint8Array; contentType: string | null; url?: string };
/** Reads a publication that the gazette serves only as a scanned PDF (injected: OCR in production, a stub in tests). */
export type PdfReader = (bytes: Uint8Array) => Promise<{ text: string; confidence: number; pages: number }>;
/** Below these an OCR reading is not trusted at all: the publication stays "unreadable" for a person. */
export const PDF_MIN_CHARS = 200; export const PDF_MIN_CONFIDENCE = 60;
export type Fetcher = (url: string) => Promise<FetchResult>;

export const OFFICIAL_HOSTS = { resmi_gazete: 'resmigazete.gov.tr', mevzuat: 'mevzuat.gov.tr' } as const;
export type SourceCode = keyof typeof OFFICIAL_HOSTS;

/**
 * Why a source could not be used. The kind is shown on the source-health screen so that "unreadable" is never mistaken for
 * "no change": timeout, blocked (403/429/robot page), http_error, network, empty body, unexpected_format (PDF/JSON/non-HTML),
 * corrupt (parsed far less than the last good read), refused_link (a link outside the configured official host).
 */
export type SourceErrorKind = 'timeout' | 'blocked' | 'not_found' | 'http_error' | 'network' | 'empty' | 'unexpected_format' | 'corrupt' | 'refused_link';
export const ERROR_KIND_TR: Record<SourceErrorKind, string> = {
  timeout: 'zaman aşımı', blocked: 'erişim engeli', not_found: 'sayfa yok', http_error: 'sunucu hatası', network: 'bağlantı hatası',
  empty: 'boş yanıt', unexpected_format: 'beklenmeyen biçim', corrupt: 'bozuk/eksik metin', refused_link: 'resmî olmayan bağlantı reddedildi',
};
export class SourceError extends Error {
  constructor(public kind: SourceErrorKind, message: string) { super(`[${ERROR_KIND_TR[kind]}] ${message}`); }
}
/** The kind of a recorded error message ("[zaman aşımı] ..."), or null for an older/unclassified one. */
export function errorKindOf(message: string): SourceErrorKind | null {
  const m = /(?:^|: )\[([^\]]+)\]/.exec(message);
  return (Object.entries(ERROR_KIND_TR).find(([, v]) => v === m?.[1])?.[0] as SourceErrorKind | undefined) ?? null;
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
export const sameHost = (a: string, b: string) => { try { return bare(new URL(a).hostname) === bare(new URL(b).hostname); } catch { return false; } };

export const defaultFetcher: Fetcher = async url => {
  const r = await fetch(url, { headers: { 'user-agent': 'GoverHubLegislationWatch/1.0 (+yerel pilot; gunluk tarama)', accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  // A redirect may only stay on the host that was asked for; the watch never follows a source to another site.
  if (r.url && !sameHost(r.url, url)) throw new SourceError('refused_link', `${url} başka bir adrese yönlendirdi (${new URL(r.url).hostname}); izlenmedi`);
  return { status: r.status, body: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type'), url: r.url };
};

/** A fetch that retries transient failures (network error, 5xx, 429) with growing waits; returns the final answer or throws a classified SourceError. */
export async function fetchWithRetry(fetcher: Fetcher, url: string, o: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<FetchResult> {
  const attempts = o.attempts ?? 3;
  const sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  let last = 'bilinmeyen hata';
  let kind: SourceErrorKind = 'network';
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetcher(url);
      if (r.status >= 200 && r.status < 300) return r;
      last = `HTTP ${r.status}`;
      kind = r.status === 403 || r.status === 401 || r.status === 429 || r.status === 451 ? 'blocked' : r.status === 404 || r.status === 410 ? 'not_found' : 'http_error';
      if (r.status < 500 && r.status !== 429) break; // not transient: 404/403 will not fix itself within seconds
    } catch (e) {
      if (e instanceof SourceError) throw e; // a refused link is final
      last = (e as Error).message || String(e);
      kind = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError' || /timeout|timed out|zaman/i.test(last) ? 'timeout' : 'network';
    }
    if (i < attempts) await sleep(1000 * 2 ** (i - 1));
  }
  throw new SourceError(kind, `${url} okunamadı (${last})`);
}

const BLOCK_PAGE = /access denied|erişim(iniz)?\s+engellendi|are you a robot|captcha|cloudflare|request blocked|the requested url was rejected/i;
/**
 * A 200 answer is not yet a usable page: it can be empty, a PDF/JSON, or a robot/"access denied" page. Each is a different
 * failure, and none of them may be read as "the text did not change".
 */
export function requireHtml(r: FetchResult, url: string): string {
  if (r.body.length < 40) throw new SourceError('empty', `${url} boş ya da çok kısa yanıt verdi (${r.body.length} bayt)`);
  const ct = (r.contentType ?? '').toLowerCase();
  const head = Buffer.from(r.body.slice(0, 8)).toString('latin1');
  if (/pdf|json|octet-stream|image\//.test(ct) || head.startsWith('%PDF')) throw new SourceError('unexpected_format', `${url} HTML yerine ${ct || 'bilinmeyen'} döndü`);
  const text = decodeHtml(r);
  if (!/<\s*(html|body|div|p|table)\b/i.test(text)) throw new SourceError('unexpected_format', `${url} yanıtı HTML sayfa değil`);
  if (BLOCK_PAGE.test(htmlToText(text).slice(0, 600)) && htmlToText(text).length < 3000) throw new SourceError('blocked', `${url} erişim engeli/robot doğrulama sayfası döndü`);
  return text;
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
export const isPdf = (r: FetchResult) => /application\/pdf/i.test(r.contentType ?? '') || Buffer.from(r.body.slice(0, 5)).toString('latin1') === '%PDF-';
/** The site answers a list that does not exist (not yet published, no extra issue) with a redirect to its home page. */
const leftList = (r: FetchResult) => !!r.url && !/\/fihrist(\?|$)/i.test(r.url);
/**
 * Comparison form of a text: Unicode NFC, invisible characters (zero-width, soft hyphen, BOM) removed, every kind of space
 * (non-breaking included) collapsed to one. Words, digits, punctuation and letter case are NOT touched, so nothing that
 * carries meaning is lost; only differences a reader cannot see stop producing "changes".
 */
export const normText = (s: string) => s.normalize('NFC').replace(/[​-‍⁠﻿­]/g, '').replace(/\s+/g, ' ').trim();

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

// ── Relevance: which supported sector a publication may concern ──
// Supported sectors: food service (café/restaurant/market), electrical installation, real-estate office. A title with a CLEAR sector
// term is a candidate; a title with only a general term (workplace, building, consumer, contract…) is UNCERTAIN and goes to a person
// (never silently dropped, never silently accepted); a title with neither is out of scope. Matching is on the title, so the reason
// is always shown with the words it rests on. Nothing here decides a rule: a person reads and decides.
export type Sector = 'food' | 'electrical' | 'estate';
export const SECTOR_TR: Record<Sector, string> = { food: 'gıda güvenliği', electrical: 'Elektrik tesisatı', estate: 'Emlak ofisi' };
const SECTOR_TERMS: Record<Sector, RegExp> = {
  food: /gıda|hijyen|lokanta|restoran|kafe\b|yiyecek|i[çc]ecek|alerjen|soğuk zincir|bozulabilir|umumi hıfzıssıhha|yeme[\s-]*i[çc]me|tüketime sunulan|gıda i[şs]letme/i,
  electrical: /elektrik|topraklama|kuvvetli akım|zayıf akım|yıldırım|paratoner|a[şs]ırı akım|elektrik tesis|[iİ]ç tesisat|ayd[ıi]nlatma tesis|pano\b|kaçak akım/i,
  estate: /emlak|gayrimenkul|ta[şs][ıi]nmaz|konut sat|kira(?:lama|c[ıi])|tapu|komisyoncu|aracılık hizmet|yetki belgesi|ta[şs][ıi]nmaz ticaret/i,
};
// General words only count at the START of a word ("yapı" must not match "yapılmasına", the verb in "Değişiklik Yapılmasına Dair").
const GENERAL_TERMS = /(?<!\p{L})(?:i[şs]yeri|i[şs] sağlığı|yap[ıi](?:lar[ıi]?|n[ıi]n)?(?!\p{L})|bina(?:lar|n[ıi]n)?(?!\p{L})|tüketici|ticari|ticaret|sözleşme|mesleki|esnaf|enerji|tesis|belgelendirme|denetim|güvenlik|standart)/iu;
/** An amendment/repeal title says WHAT it changes only by naming another text; the sector often shows up only in the body. */
export const AMENDMENT_TITLE = /de(?:ğ|g)i[şs]iklik\s+yapılmasına\s+dair|yürürlükten\s+kaldırılmasına\s+dair/i;
export function sectorsInText(text: string): { sector: Sector; word: string }[] {
  return (Object.keys(SECTOR_TERMS) as Sector[]).flatMap(k => { const m = SECTOR_TERMS[k].exec(text); return m ? [{ sector: k, word: m[0] }] : []; });
}
const NOT_FOOD = /üniversite|yüksekokul|uygulama ve araştırma merkezi|araştırma ve uygulama merkezi|enstitü/i;
export type SectorMatch = { level: 'clear' | 'uncertain' | 'out'; sectors: Sector[]; why: string };
/** The start of the first article, so two publications with the same title show different reasons. */
function bodyExcerpt(text: string) { const t = text.replace(/\s+/g, ' '); const i = t.search(/MADDE\s*1/i); return t.slice(i < 0 ? 0 : i, (i < 0 ? 0 : i) + 110).trim(); }
export function sectorRelevance(title: string): SectorMatch {
  if (NOT_FOOD.test(title)) return { level: 'out', sectors: [], why: 'Üniversite/merkez düzenlemesi: kapsam dışı.' };
  const hits = (Object.keys(SECTOR_TERMS) as Sector[]).flatMap(k => { const m = SECTOR_TERMS[k].exec(title); return m ? [{ k, w: m[0] }] : []; });
  if (hits.length) return { level: 'clear', sectors: hits.map(h => h.k), why: hits.map(h => `Başlıkta "${h.w}" geçiyor (${SECTOR_TR[h.k]} kapsamı).`).join(' ') };
  const g = GENERAL_TERMS.exec(title);
  if (g) return { level: 'uncertain', sectors: [], why: `Başlıkta yalnız genel bir ifade var ("${g[0]}"); hangi iş koluna ait olduğu başlıktan anlaşılmıyor. İnsan incelemesi gerekir.` };
  return { level: 'out', sectors: [], why: 'Başlıkta desteklenen iş kollarından (gıda, elektrik, emlak) hiçbirine ait ifade yok.' };
}
/** Kept for the food-only callers/tests: a food term in the title. */
export function foodSafetyRelevance(title: string): { relevant: boolean; why: string } {
  if (NOT_FOOD.test(title)) return { relevant: false, why: 'Üniversite/merkez düzenlemesi: kapsam dışı.' };
  const m = SECTOR_TERMS.food.exec(title);
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
  return parseGazetteText(htmlToText(html), fallback);
}
export function parseGazetteText(text: string, fallback: { title: string; publishedOn: string | null }): GazetteDocument {
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

/** `docsRead`: documents (gazette items / watched consolidated texts) read and parsed in this scan, separate from `seen` (items or articles). */
export type ScanOutcome = { seen: number; /** items matching a supported sector (clear) */ selected: number; /** items a person must classify */ uncertain: number; /** items outside every supported sector, with the reason */ skipped: { key: string; url: string; title: string; why: string }[]; /** items whose text could not be read: shown as such, retried by the next scan */ unreadable: { key: string; url: string; title: string; error: string }[]; docsRead: number; changes: DetectedChange[]; errors: string[]; snapshots: { docKey: string; title: string; url: string; articles: Record<string, string> }[]; notes: string[] };

/**
 * The effective-date parts of a gazette instrument, kept in SEPARATE fields: the general entry-into-force clause, the
 * transition/later-dated provisions found in other articles, and the scope clause (what it covers: product / activity).
 * Reading them out is not a decision: which of them applies to which business is for the expert/admin.
 */
export type EffectiveDetail = {
  general: { articleIds: string[]; clause: string | null };
  transitional: { articleId: string; dates: string[]; sentence: string }[];
  scope: { articleId: string; text: string } | null;
};
export function effectiveDetail(doc: Pick<GazetteDocument, 'articles' | 'effectiveClauses'>, day: string): EffectiveDetail {
  const eff = doc.articles.filter(a => doc.effectiveClauses.includes(a.text));
  const transitional: EffectiveDetail['transitional'] = [];
  for (const a of doc.articles.filter(x => !doc.effectiveClauses.includes(x.text))) {
    for (const s of a.text.split(/(?<=[.;])\s+/)) {
      const dates = [...new Set(datesIn(s))].filter(d => d > day).sort();
      if (dates.length && transitional.length < 8) transitional.push({ articleId: a.id, dates, sentence: normText(s).slice(0, 400) });
    }
  }
  // The scope article. Gazette headings ("Kapsam") are appended to the END of the previous article's text, so a heading
  // "Kapsam" at an article's tail means the NEXT article is the scope; otherwise the first early article saying "... kapsar".
  const early = doc.articles.slice(0, 5);
  const headIdx = early.findIndex(a => /\bKapsam\s*$/.test(a.text.trim()));
  const sc = headIdx >= 0 && early[headIdx + 1] ? early[headIdx + 1] : early.find(a => /\bkapsa(r|mında)\b/i.test(a.text.replace(/\bKapsam\s*$/, '')));
  return {
    general: { articleIds: eff.map(a => a.id), clause: doc.effectiveClauses.length ? normText(doc.effectiveClauses.join(' • ')).slice(0, 400) : null },
    transitional, scope: sc ? { articleId: sc.id, text: sc.text.slice(0, 400) } : null,
  };
}

/** The date list of a scan window, newest last, in the Istanbul calendar. */
export function istanbulDay(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d); }
export function daysBack(today: string, n: number): string[] {
  const t = Date.parse(today + 'T00:00:00Z');
  return Array.from({ length: n + 1 }, (_, i) => new Date(t - (n - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Record key of a gazette file. The announcements section reuses the file names of the main section, so it gets its own prefix. */
export const gazetteKey = (url: string) => `rg:${/\/ilanlar\//i.test(url) ? 'ilan-' : ''}${url.split('/').pop()!.replace(/\.(html?|pdf)$/i, '')}`;

/** Extra (mükerrer) issues of a day are separate lists; five a day is far above anything the gazette publishes. */
const MAX_EXTRA_ISSUES = 5;
export async function scanGazette(o: { baseUrl: string; today: string; lookbackDays: number; fetcher: Fetcher; readPdf?: PdfReader; sleep?: (ms: number) => Promise<void> }): Promise<ScanOutcome> {
  const out: ScanOutcome = { seen: 0, selected: 0, uncertain: 0, skipped: [], unreadable: [], docsRead: 0, changes: [], errors: [], snapshots: [], notes: [] };
  const base = o.baseUrl.replace(/\/+$/, '');
  for (const day of daysBack(o.today, o.lookbackDays)) {
    let items: GazetteItem[];
    try {
      const idxUrl = `${base}/fihrist?tarih=${day}`;
      const answer = await fetchWithRetry(o.fetcher, idxUrl, { sleep: o.sleep });
      // A redirect away from the list is NOT "nothing published": today's issue may still be missing; a past day is unverified.
      if (leftList(answer)) {
        if (day === o.today) { out.notes.push(`${day}: günün sayısı henüz yayımlanmamış (liste adresi ana sayfaya yönlendiriyor); sonraki taramada yeniden bakılır.`); continue; }
        throw new SourceError('not_found', `${idxUrl} gün listesi yerine ana sayfaya yönlendirdi; bu gün doğrulanamadı`);
      }
      const html = requireHtml(answer, idxUrl);
      items = parseGazetteIndex(html);
      // A day list with no items AND none of the page's list markers is a changed/broken page, not "nothing published".
      if (!items.length && !/gunluk-akis|fihrist-item|html-content/i.test(html)) throw new SourceError('unexpected_format', `${idxUrl} günlük fihrist biçiminde değil (liste bulunamadı)`);
    } catch (e) { out.errors.push(`${day}: ${(e as Error).message}`); continue; }
    const listed = new Set(items.map(i => i.url));
    for (let n = 1; n <= MAX_EXTRA_ISSUES; n++) {
      const url = `${base}/fihrist?tarih=${day}&mukerrer=${n}`;
      try {
        const answer = await fetchWithRetry(o.fetcher, url, { sleep: o.sleep });
        if (leftList(answer)) break;
        const fresh = parseGazetteIndex(requireHtml(answer, url)).filter(i => !listed.has(i.url));
        if (!fresh.length) break;
        for (const i of fresh) { listed.add(i.url); items.push(i); }
        out.notes.push(`${day}: ${n}. mükerrer sayıda ${fresh.length} yayın.`);
      } catch (e) {
        if (!(e instanceof SourceError && e.kind === 'not_found')) out.errors.push(`${day}: mükerrer sayı listesi: ${(e as Error).message}`);
        break;
      }
    }
    out.seen += items.length;
    for (const it of items) {
      const itemUrl = new URL(it.url, base + '/').toString(); const itemKey = gazetteKey(itemUrl);
      let rel: SectorMatch & { bodySectors?: Sector[] } = sectorRelevance(it.title);
      const mustRead = rel.level !== 'out' || AMENDMENT_TITLE.test(it.title); // an amendment title may hide its sector: read the text before deciding
      if (!mustRead) { out.skipped.push({ key: itemKey, url: itemUrl, title: it.title.slice(0, 160), why: rel.why }); continue; }
      try {
        const url = new URL(it.url, base + '/').toString();
        // Links inside the day list are followed only when they stay on the configured source host.
        if (!sameHost(url, base)) throw new SourceError('refused_link', `${url} yapılandırılmış kaynak adresinin dışında; izlenmedi`);
        const answer = await fetchWithRetry(o.fetcher, url, { sleep: o.sleep });
        let ocr: Awaited<ReturnType<PdfReader>> | null = null; let doc: GazetteDocument;
        if (isPdf(answer) && o.readPdf) {
          try { ocr = await o.readPdf(answer.body); } catch (e) { throw new SourceError('unexpected_format', `${url} PDF okunamadı: ${(e as Error).message}`); }
          const chars = ocr.text.replace(/\s/g, '').length;
          if (chars < PDF_MIN_CHARS || ocr.confidence < PDF_MIN_CONFIDENCE) throw new SourceError('corrupt', `${url} PDF okuması güvenilir değil (${chars} karakter, güven %${Math.round(ocr.confidence)})`);
          doc = parseGazetteText(ocr.text, { title: it.title, publishedOn: day });
        } else doc = parseGazetteDocument(requireHtml(answer, url), { title: it.title, publishedOn: day });
        out.docsRead += 1;
        if (rel.level === 'out') {
          const hits = sectorsInText(doc.text);
          if (!hits.length) { out.skipped.push({ key: itemKey, url: itemUrl, title: it.title.slice(0, 160), why: 'Başlık değişiklik/kaldırma biçiminde; başlıkta da metinde de desteklenen iş kollarından (gıda, elektrik, emlak) ifade yok. Okunan metin: «' + bodyExcerpt(doc.text) + '».' }); continue; }
          rel = { level: 'uncertain', sectors: [], bodySectors: [...new Set(hits.map(h => h.sector))],
            why: `Başlık hangi iş koluna ait olduğunu söylemiyor (yalnız "değişiklik/kaldırma"); metinde ${hits.map(h => `"${h.word}" (${SECTOR_TR[h.sector]})`).join(', ')} geçiyor. İnsan incelemesi gerekir.` };
        }
        if (rel.level === 'clear') out.selected += 1; else out.uncertain += 1;
        const type = changeTypeFromTitle(it.title);
        let eff = parseEffective(doc.effectiveClauses, day);
        // "Yayımı tarihinde yürürlüğe girer" can sit next to transition dates in other articles (e.g. "30/4/2027 tarihinden sonra ...").
        // Such a text has more than one date that matters, so an administrator must decide; it is never read as a plain known date.
        if (eff.status === 'known') {
          const later = [...new Set(doc.articles.filter(a => !doc.effectiveClauses.includes(a.text)).flatMap(a => datesIn(a.text)).filter(d => d > day))].sort();
          if (later.length) eff = { status: 'unclear', date: null, note: `Yürürlük maddesi ${trDate(eff.date)} gösteriyor, ancak metinde ileri tarihli/geçiş hükümleri var (${later.slice(0, 4).map(trDate).join(', ')}). Hangi tarihin uygulanacağını yönetici metinden belirlemeli.` };
        }
        // Machine-read text is never trusted with a date: a person reads the official file and decides.
        if (ocr) eff = { status: 'unclear', date: null, note: `PDF görüntüsünden makineyle okundu (güven %${Math.round(ocr.confidence)}); yürürlük tarihini yönetici resmî metinden belirlemeli.${eff.date ? ` Okumadaki aday tarih: ${trDate(eff.date)}.` : ''}` };
        const body = type === 'repeal' ? null : doc.articles.filter(a => !doc.effectiveClauses.includes(a.text)).map(a => `MADDE ${a.id} – ${a.text}`).join('\n\n') || doc.text.slice(0, 4000);
        const newText = ocr && body ? `[PDF görüntüsünden makineyle okundu; harf ve sayı hataları olabilir. Resmî PDF'i açıp doğrulayın.]\n\n${body}` : body;
        out.changes.push({
          sourceCode: 'resmi_gazete', externalKey: itemKey, changeType: type,
          docRef: `Resmî Gazete ${doc.sayi ?? '(sayı okunamadı)'} · ${trDate(day)}`, docTitle: it.title, articleRef: null, sourceUrl: url, publishedOn: day, effective: eff,
          oldText: null, newText,
          suggestion: { relevance: rel.why, sectors: rel.sectors, matchLevel: rel.level, bodySectors: rel.bodySectors ?? [], needsHumanClassification: rel.level === 'uncertain', category: it.category, issuer: doc.issuer, kind: type, effectiveDetail: effectiveDetail(doc, day),
            ...(ocr ? { readMethod: 'ocr_pdf', readConfidence: Math.round(ocr.confidence), readPages: ocr.pages } : {}),
            hint: type === 'article_amendment' ? 'Değişiklik metni var; değişen maddenin eski metni için ilgili mevzuatın birleştirilmiş metnine bakın.' : type === 'repeal' ? 'Yürürlükten kaldırma: ilgili kural sürümü için bitiş tarihi önerilir.' : 'Yeni düzenleme: kural koşulunu ve görevleri uzman yazmalı.',
            ...compareTexts(null, newText) },
        });
      } catch (e) { out.errors.push(`${it.title.slice(0, 80)}: ${(e as Error).message}`); out.unreadable.push({ key: itemKey, url: itemUrl, title: it.title.slice(0, 160), error: (e as Error).message.slice(0, 200) }); }
    }
  }
  return out;
}

// ── Mevzuat Bilgi Sistemi (consolidated text, compared with the last snapshot) ──
/** `articles`: optional filter, only these article ids produce changes (the whole text is still read and kept as the baseline). */
export type WatchDoc = { tur: number; no: number; tertip: number; label: string; articles?: string[] };
/** Initial inventory for café/restaurant food safety; every id was read from the official consolidated text (docs/MEVZUAT_IZLEME_ENVANTERI.md). */
export const DEFAULT_MEVZUAT_WATCH: WatchDoc[] = [
  { tur: 1, no: 5996, tertip: 5, label: 'Kanun 5996 (Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem)', articles: ['22', '24', '29', '30', '31', '32', '36'] },
  { tur: 7, no: 15592, tertip: 5, label: 'Gıda Hijyeni Yönetmeliği' },
  { tur: 7, no: 15594, tertip: 5, label: 'Gıda İşletmelerinin Kayıt ve Onay İşlemlerine Dair Yönetmelik' },
  { tur: 7, no: 18552, tertip: 5, label: 'Hijyen Eğitimi Yönetmeliği' },
  { tur: 9, no: 20147, tertip: 5, label: 'Hızlı Dondurulmuş Gıdalar Tebliği (2014/47)' },
  { tur: 9, no: 20148, tertip: 5, label: 'Hızlı Dondurulmuş Gıdaların Sıcaklık İzleme Tebliği (2014/48)' },
];
/**
 * `tür:no:tertip:ad[:m=22;24;G1]`, comma separated. The optional last segment `m=` limits the watched articles (for a law that is
 * mostly about other sectors). Not described by the official sites: the list is OUR inventory (docs/MEVZUAT_IZLEME_ENVANTERI.md).
 */
export const parseWatchList = (s: string | undefined): WatchDoc[] => !s?.trim() ? DEFAULT_MEVZUAT_WATCH
  : s.split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const parts = x.split(':');
    const [tur, no, tertip] = parts;
    let articles: string[] | undefined;
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 4 && /^m=/i.test(last)) { articles = last.slice(2).split(';').map(a => a.trim()).filter(Boolean); parts.pop(); }
    const label = parts.slice(3).join(':');
    return { tur: Number(tur), no: Number(no), tertip: Number(tertip), label: label || `Mevzuat ${no}`, ...(articles?.length ? { articles } : {}) };
  }).filter(w => w.tur > 0 && w.no > 0 && w.tertip > 0);
const watchKey = (w: WatchDoc) => `mv:${w.tur}.${w.tertip}.${w.no}`;

export function parseConsolidated(html: string): { title: string; articles: Record<string, string> } {
  const text = htmlToText(html);
  // The title is the heading block before the first article/section ("TÜRK" and "GIDA KODEKSİ ..." may sit on separate lines).
  const head = text.split(/\n\s*(?:GEÇİCİ\s+MADDE|EK\s+MADDE|MADDE)\s+\d|Kanun\s+Numarası|BİRİNCİ\s+(?:BÖLÜM|KISIM)|\sAmaç(?=\s|$)/)[0] ?? '';
  const title = normText(head.replace(/^\s*\d+\s+/, '')).slice(0, 200) || 'Başlıksız';
  const articles: Record<string, string> = {};
  // Article numbers can carry a Turkish letter suffix (Kanun 5996: 10/A … 10/Ç …); [A-Za-z] alone skipped "10/Ç" and folded its text into the article before it.
  const marks = [...text.matchAll(/(?:^|\n)\s*(GEÇİCİ\s+MADDE|EK\s+MADDE|MADDE)\s+(\d+(?:\/[A-Za-z0-9ÇĞİÖŞÜçğıöşü]+)?)\s*[-–—]/g)];
  marks.forEach((m, i) => {
    const prefix = m[1]!.startsWith('GEÇİCİ') ? 'G' : m[1]!.startsWith('EK') ? 'E' : '';
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    articles[prefix + m[2]] = normText(text.slice(m.index! + m[0].length, end));
  });
  return { title, articles };
}

export async function scanConsolidated(o: { baseUrl: string; watch: WatchDoc[]; previous: Map<string, Record<string, string>>; fetcher: Fetcher; today: string; sleep?: (ms: number) => Promise<void> }): Promise<ScanOutcome> {
  const out: ScanOutcome = { seen: 0, selected: 0, uncertain: 0, skipped: [], unreadable: [], docsRead: 0, changes: [], errors: [], snapshots: [], notes: [] };
  const base = o.baseUrl.replace(/\/+$/, '');
  for (const w of o.watch) {
    const url = `${base}/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=${w.tur}&MevzuatNo=${w.no}&MevzuatTertip=${w.tertip}`;
    try {
      const parsed = parseConsolidated(requireHtml(await fetchWithRetry(o.fetcher, url, { sleep: o.sleep }), url));
      const count = Object.keys(parsed.articles).length;
      if (!count) throw new SourceError('unexpected_format', 'metinde madde bulunamadı (sayfa biçimi değişmiş olabilir)');
      const key = watchKey(w);
      const prev = o.previous.get(key);
      // A read that finds far fewer articles than the last good one is a truncated/corrupt page, not a repeal of half the law.
      // The baseline is kept and the source shows an error.
      if (prev && Object.keys(prev).length >= 6 && count < Object.keys(prev).length * 0.6) {
        throw new SourceError('corrupt', `${count} madde okundu, önceki sağlıklı okumada ${Object.keys(prev).length} vardı; taban korundu`);
      }
      out.seen += count;
      out.docsRead += 1;
      out.snapshots.push({ docKey: key, title: parsed.title, url, articles: parsed.articles });
      if (!prev) { out.notes.push(`${w.label}: ilk okuma, ${count} madde, karşılaştırma tabanı kaydedildi (değişiklik üretilmedi).`); continue; }
      const mulga = (t: string | undefined) => !!t && /^\(?\s*mülga/i.test(t);
      const watched = (id: string) => !w.articles || w.articles.includes(id);
      for (const [id, now] of Object.entries(parsed.articles)) {
        if (!watched(id)) continue;
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
        if (watched(id) && parsed.articles[id] === undefined && !mulga(prev[id])) {
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
