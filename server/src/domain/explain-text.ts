import { FACTS, isFactKey } from './facts';

/**
 * GH-02: the engine's trace in the language of the person who answered the questions.
 * Nothing here decides anything; it only words what `decide()` already found, fact by fact, so every sentence
 * can be traced to an answer (and, in the explanation, to the source of that answer).
 */
type Leaf = { kind: 'fact'; fact: string; label: string; op: string; expected: unknown; result: 'true' | 'false' | 'unknown'; actual?: unknown; factStatus?: string; verification?: string; source?: string; unknownReason?: string };
type Node = { kind: string; result: 'true' | 'false' | 'unknown'; children?: Node[] } | Leaf;

/** What a yes/no answer means, said back to the person. A fact without an entry falls back to "label: value". */
const STATEMENT: Record<string, { yes: string; no: string }> = {
  'activity.food_preparation': { yes: 'Bu şubede yemek veya içecek hazırladığınızı belirttiniz.', no: 'Bu şubede yemek veya içecek hazırlamadığınızı belirttiniz.' },
  'activity.food_business': { yes: 'Faaliyetiniz gıda ürünü hazırlama veya satışı olarak kayıtlı.', no: 'Faaliyetiniz gıda ürünü hazırlama veya satışı değil.' },
  'storage.cold': { yes: 'Bu şubede soğukta saklanan ürün olduğunu belirttiniz.', no: 'Bu şubede soğukta saklanan ürün olmadığını belirttiniz.' },
  'utility.lpg': { yes: 'Bu şubede LPG / tüp gaz kullandığınızı belirttiniz.', no: 'Bu şubede LPG / tüp gaz kullanmadığınızı belirttiniz.' },
  'service.delivery': { yes: 'Bu şubede paket servis yaptığınızı belirttiniz.', no: 'Bu şubede paket servis yapmadığınızı belirttiniz.' },
  'activity.installation_business': { yes: 'Faaliyetiniz montaj / kurulum işi içeren bir faaliyet olarak kayıtlı.', no: 'Faaliyetiniz montaj / kurulum işi içeren bir faaliyet olarak kayıtlı değil.' },
  'activity.brokerage': { yes: 'Faaliyetiniz emlak / aracılık olarak kayıtlı.', no: 'Faaliyetiniz emlak / aracılık olarak kayıtlı değil.' },
  'activity.client_contracts': { yes: 'Müşteri veya mülk sahibi adına sözleşme ve yetki belgesi dosyası tuttuğunuzu belirttiniz.', no: 'Müşteri veya mülk sahibi adına sözleşme ve yetki belgesi dosyası tutmadığınızı belirttiniz.' },
  'activity.onsite_installation': { yes: 'Müşteri yerinde montaj / kurulum işi yaptığınızı belirttiniz.', no: 'Müşteri yerinde montaj / kurulum işi yapmadığınızı belirttiniz.' },
};

const show = (v: unknown) => (v === true ? 'Evet' : v === false ? 'Hayır' : Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v));
const OPS: Record<string, string> = { eq: 'şu olmalı', neq: 'şu olmamalı', in: 'şunlardan biri olmalı', contains: 'şunu içermeli', gte: 'en az', lte: 'en çok', gt: 'daha fazla', lt: 'daha az' };

export function statementFor(key: string, value: unknown): string {
  const s = STATEMENT[key];
  if (s && typeof value === 'boolean') return value ? s.yes : s.no;
  const label = isFactKey(key) ? FACTS[key].label : key;
  return `${label}: ${show(value)} olarak belirttiniz.`;
}

const leaves = (n: Node): Leaf[] => (n.kind === 'fact' ? [n as Leaf] : ((n as { children?: Node[] }).children ?? []).flatMap(leaves));

/** One line per answer the decision rests on (matched answers), plus one per answer that is missing or unconfirmed. */
export function reasonLines(decision: string, trace: Node | null) {
  if (!trace) return { text: '', matched: [] as string[], missing: [] as string[] };
  const all = leaves(trace);
  const matched = all.filter(l => l.result === 'true' && l.factStatus !== 'unknown').map(l => statementFor(l.fact, l.actual));
  const against = all.filter(l => l.result === 'false').map(l => statementFor(l.fact, l.actual));
  const missing = all.filter(l => l.result === 'unknown').map(l =>
    l.actual === undefined || l.actual === null ? `${l.label} bilgisini henüz vermediniz.` : `${l.label} yanıtınız henüz onaylanmadı veya doğrulanamadı; onaylanana kadar karar verilmez.`);
  const text = decision === 'applies' ? matched.join(' ')
    : decision === 'not_applicable' ? (against.length ? against.join(' ') + ' Bu yüzden bu şubede geçerli değil.' : 'Koşullar karşılanmadığı için bu şubede geçerli değil.')
    : decision === 'needs_info' ? missing.join(' ') + ' Bu bilgi gelene kadar yükümlülük “uygulanmaz” sayılmaz ve uygunluk verilmez.'
    : 'Uzman incelemesi gerekiyor; bu sürede yükümlülük geçerli kabul edilir.';
  return { text, matched, missing };
}

/** The rule's condition as sentences ("şu olmalı"), for the definition block. */
export function describeCondition(c: any): string[] {
  if (!c) return [];
  if ('all' in c) return c.all.flatMap(describeCondition);
  if ('any' in c) return [`Şunlardan biri sağlanmalı: ${c.any.flatMap(describeCondition).join(' / ')}`];
  if ('not' in c) return [`Şu sağlanmamalı: ${describeCondition(c.not).join(', ')}`];
  const label = isFactKey(c.fact as string) ? FACTS[c.fact as keyof typeof FACTS].label : String(c.fact);
  return [`${label} ${OPS[c.op] ?? c.op}: ${show(c.value)}`];
}

const FREQ: Record<string, string> = { daily: 'Her gün', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık', hourly: 'Saatlik' };
export const frequencyText = (r: any) => (r ? `${FREQ[r.freq] ?? String(r.freq)}${r.at ? ` · ${r.at}` : ''}` : '—');
