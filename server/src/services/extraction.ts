import { createHash } from 'node:crypto';
import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { DOC_TYPES, canReadDoc } from './documents';

/*
 * Reading fields from a document's text (Smart Vault).
 *  - There is no OCR engine in the pilot: the text comes from the phone's own text recognition or is typed/pasted. `ocrStatus` says so.
 *  - The server only proposes: each field carries the snippet it came from and a confidence. A person looks at it, edits it and confirms.
 *  - Confirming fills the document's fields (type, issuer, number) and the dates of that version. It never marks the document reviewed or valid:
 *    review stays a separate human step.
 */

export const ocrStatus = () => ({
  engine: null as string | null,
  available: false,
  note: 'Pilot sürümünde otomatik OCR motoru yok. Metin telefonun kendi metin tanımasından alınır ya da elle yapıştırılır; sistem yalnızca öneri çıkarır, kayda sen onaylarsın.',
});

export type Suggestion = { field: 'docType' | 'issuer' | 'documentNo' | 'validFrom' | 'validUntil'; value: string; snippet: string; confidence: 'medium' | 'low'; note?: string };

const TYPE_HINTS: [string, RegExp][] = [
  ['business_license', /i[sş]yeri\s+a[cç]ma|[cç]al[ıi][sş]ma\s+ruhsat/i], ['food_registration', /g[ıi]da\s+i[sş]letme\s+(kay[ıi]t|onay)|g[ıi]da\s+sicil/i],
  ['calibration_certificate', /kalibrasyon/i], ['maintenance_report', /servis\s+raporu|bak[ıi]m\s+raporu|periyodik\s+bak[ıi]m/i],
  ['training_certificate', /e[gğ]itim\s+(sertifika|belge)|kat[ıi]l[ıi]m\s+belge/i], ['health_certificate', /sa[gğ]l[ıi]k\s+rapor|por[tö]r/i],
  ['insurance', /sigorta|poli[cç]e/i], ['contract', /s[öo]zle[sş]me/i],
];
const ISSUER_RE = /(.{0,40}(belediye(si)?|m[üu]d[üu]rl[üu][gğ][üu]|bakanl[ıi][gğ][ıi]|odas[ıi]|ba[sş]kanl[ıi][gğ][ıi]|kurumu|akreditasyon|laboratuvar)[^\n]{0,40})/i;
const NO_RE = /(?:belge|ruhsat|sertifika|rapor|sicil|kay[ıi]t|onay|poli[cç]e|say[ıi])\s*(?:no|numaras[ıi])\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\/.\-]{2,30})/i;
const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})|(\d{4})-(\d{2})-(\d{2})/g;
const UNTIL_CTX = /ge[cç]erlilik|son\s+ge[cç]erli|biti[sş]|kadar\s+ge[cç]erli|ge[cç]erlidir|s[üu]resi|son\s+kullanma|vade/i;
const FROM_CTX = /d[üu]zenleme|veri[lş]|tanzim|ba[sş]lang[ıi][cç]|y[üu]r[üu]rl[üu][gğ]e|tarihi\s*:/i;

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1990 && y <= 2100
    ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};

/** Proposes fields from plain text. Rule-based and deliberately plain: it quotes where it found each value. */
export function suggestFields(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  const t = text.replace(/\r/g, '');
  // Matching runs on the Turkish-lowercased text (so "BELEDİYESİ" and "Belediyesi" are the same); values are cut from the original.
  const L = t.toLocaleLowerCase('tr-TR');
  const cut = (idx: number, len: number) => t.slice(idx, idx + len);
  const lines = t.split('\n');
  for (const [type, re] of TYPE_HINTS) {
    const m = L.match(re);
    if (m) { out.push({ field: 'docType', value: type, snippet: cut(m.index!, m[0].length).trim(), confidence: 'medium' }); break; }
  }
  const iss = L.match(ISSUER_RE);
  if (iss) { const v = cut(iss.index!, iss[1]!.length).trim().replace(/\s+/g, ' '); out.push({ field: 'issuer', value: v, snippet: v, confidence: 'low', note: 'Satırın tamamı alındı; kurum adını kontrol et.' }); }
  const no = L.match(NO_RE);
  if (no) { const at = no.index! + no[0].lastIndexOf(no[1]!); out.push({ field: 'documentNo', value: cut(at, no[1]!.length), snippet: cut(no.index!, no[0].length).trim(), confidence: 'medium' }); }

  const dates: { iso: string; line: string; kind: 'from' | 'until' | 'plain' }[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(DATE_RE)) {
      const v = m[4] ? iso(+m[4], +m[5]!, +m[6]!) : iso(+m[3]!, +m[2]!, +m[1]!);
      if (!v) continue;
      const before = line.slice(0, m.index ?? 0).toLocaleLowerCase('tr-TR');
      dates.push({ iso: v, line: line.trim(), kind: UNTIL_CTX.test(before) ? 'until' : FROM_CTX.test(before) ? 'from' : 'plain' });
    }
  }
  const untils = dates.filter(d => d.kind === 'until'), froms = dates.filter(d => d.kind === 'from');
  if (untils.length) {
    const latest = [...untils].sort((a, b) => b.iso.localeCompare(a.iso))[0]!;
    out.push({ field: 'validUntil', value: latest.iso, snippet: latest.line, confidence: untils.length === 1 ? 'medium' : 'low',
      note: untils.length > 1 ? `Birden çok bitiş tarihi bulundu (${untils.map(u => u.iso).join(', ')}); en geç olan önerildi, kontrol et.` : undefined });
  }
  if (froms.length) {
    const first = [...froms].sort((a, b) => a.iso.localeCompare(b.iso))[0]!;
    out.push({ field: 'validFrom', value: first.iso, snippet: first.line, confidence: froms.length === 1 ? 'medium' : 'low', note: froms.length > 1 ? 'Birden çok başlangıç tarihi bulundu; en erken olan önerildi.' : undefined });
  }
  return out;
}

async function docAndVersion(tx: Tx, p: Principal, companyId: string, documentId: string, versionId: string, need: 'read' | 'write') {
  const d = (await tx.query(`SELECT id, site_id FROM documents WHERE id = $1 AND company_id = $2 AND archived_at IS NULL`, [documentId, companyId])).rows[0];
  if (!d) throw notFound('Belge');
  const okRead = await canReadDoc(tx, p, companyId, d);
  if (!okRead) throw notFound('Belge');
  if (need === 'write' && !can(p, 'document.write', { companyId, siteId: d.site_id }).ok) throw forbidden('Bu belgeyi düzenleme yetkin yok.');
  const v = (await tx.query(`SELECT id, version, valid_from, valid_until, review_status FROM document_versions WHERE id = $1 AND document_id = $2`, [versionId, documentId])).rows[0];
  if (!v) throw notFound('Belge sürümü');
  return { d, v };
}

export async function createExtraction(tx: Tx, p: Principal, companyId: string, documentId: string, versionId: string, b: { text: string; source: 'device_text' | 'typed_text' }) {
  await docAndVersion(tx, p, companyId, documentId, versionId, 'write');
  const text = b.text.trim();
  if (text.length < 20) throw invalid('Okunan metin çok kısa; en az birkaç satır olmalı.');
  if (text.length > 20000) throw invalid('Metin 20.000 karakteri aşıyor.');
  const suggestions = suggestFields(text);
  const sha = createHash('sha256').update(text).digest('hex');
  // Older, still-pending suggestions for the same version are replaced by the newest reading.
  await tx.query(`UPDATE document_extractions SET status = 'dismissed', decided_by = $2, decided_at = now() WHERE version_id = $1 AND status = 'pending'`, [versionId, p.userId]);
  const r = (await tx.query<{ id: string }>(
    `INSERT INTO document_extractions (company_id, document_id, version_id, source, text_sha256, suggestions, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [companyId, documentId, versionId, b.source, sha, JSON.stringify(suggestions), p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.extraction_proposed', entityType: 'document', entityId: documentId, payload: { extractionId: r.id, versionId, fields: suggestions.map(s => s.field), source: b.source } });
  return { id: r.id, status: 'pending', suggestions, ocr: ocrStatus(), note: 'Bunlar öneridir; onaylamadıkça belgeye yazılmaz ve belge geçerli sayılmaz.' };
}

export async function listExtractions(tx: Tx, p: Principal, companyId: string, documentId: string) {
  const d = (await tx.query(`SELECT id, site_id FROM documents WHERE id = $1 AND company_id = $2`, [documentId, companyId])).rows[0];
  if (!d || !await canReadDoc(tx, p, companyId, d)) throw notFound('Belge');
  const rows = (await tx.query(`SELECT e.id, e.version_id, v.version, e.source, e.suggestions, e.status, e.confirmed_fields, e.created_at, e.decided_at, u.display_name AS created_by_name
     FROM document_extractions e JOIN document_versions v ON v.id = e.version_id JOIN users u ON u.id = e.created_by WHERE e.document_id = $1 ORDER BY e.created_at DESC`, [documentId])).rows;
  return { ocr: ocrStatus(), items: rows.map(r => ({ id: r.id, versionId: r.version_id, version: r.version, source: r.source, suggestions: r.suggestions, status: r.status, confirmedFields: r.confirmed_fields, createdAt: r.created_at, decidedAt: r.decided_at, createdBy: r.created_by_name })) };
}

export type ConfirmFields = { docType?: string | null; issuer?: string | null; documentNo?: string | null; validFrom?: string | null; validUntil?: string | null };

export async function decideExtraction(tx: Tx, p: Principal, companyId: string, extractionId: string, b: { confirm: boolean; fields?: ConfirmFields }) {
  const e = (await tx.query(`SELECT * FROM document_extractions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [extractionId, companyId])).rows[0];
  if (!e) throw notFound('Okuma önerisi');
  const { d, v } = await docAndVersion(tx, p, companyId, e.document_id, e.version_id, 'write');
  if (e.status !== 'pending') throw conflict('INVALID_STATE', 'Bu öneri zaten yanıtlanmış.');
  if (!b.confirm) {
    await tx.query(`UPDATE document_extractions SET status = 'dismissed', decided_by = $2, decided_at = now() WHERE id = $1`, [extractionId, p.userId]);
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.extraction_dismissed', entityType: 'document', entityId: e.document_id, payload: { extractionId } });
    return { status: 'dismissed' };
  }
  const f = b.fields ?? {};
  if (f.docType && !(DOC_TYPES as readonly string[]).includes(f.docType)) throw invalid('Belge türü geçersiz.');
  const isoOk = (s?: string | null) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (!isoOk(f.validFrom) || !isoOk(f.validUntil)) throw invalid('Tarihler YYYY-AA-GG olmalı.');
  const from = f.validFrom !== undefined ? f.validFrom : v.valid_from, until = f.validUntil !== undefined ? f.validUntil : v.valid_until;
  if (from && until && until < from) throw invalid('Bitiş tarihi başlangıçtan önce olamaz.');
  if (v.review_status !== 'unreviewed' && (f.validFrom !== undefined || f.validUntil !== undefined)) throw conflict('INVALID_STATE', 'İncelenmiş sürümün tarihleri okumayla değişmez; yeni sürüm yükle.');
  const applied: Record<string, unknown> = {};
  if (f.docType) { await tx.query(`UPDATE documents SET doc_type = $2 WHERE id = $1`, [d.id, f.docType]); applied.docType = f.docType; }
  if (f.issuer !== undefined) { await tx.query(`UPDATE documents SET issuer = $2 WHERE id = $1`, [d.id, f.issuer?.trim() || null]); applied.issuer = f.issuer?.trim() || null; }
  if (f.documentNo !== undefined) { await tx.query(`UPDATE documents SET document_no = $2 WHERE id = $1`, [d.id, f.documentNo?.trim() || null]); applied.documentNo = f.documentNo?.trim() || null; }
  if (f.validFrom !== undefined || f.validUntil !== undefined) {
    await tx.query(`UPDATE document_versions SET valid_from = $2, valid_until = $3 WHERE id = $1`, [v.id, from ?? null, until ?? null]);
    if (f.validFrom !== undefined) applied.validFrom = f.validFrom; if (f.validUntil !== undefined) applied.validUntil = f.validUntil;
  }
  await tx.query(`UPDATE document_extractions SET status = 'confirmed', confirmed_fields = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [extractionId, JSON.stringify(applied), p.userId]);
  const proposed = (e.suggestions as Suggestion[]).filter(s => s.field in applied).map(s => ({ field: s.field, proposed: s.value, confirmed: applied[s.field] }));
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'document.extraction_confirmed', entityType: 'document', entityId: e.document_id,
    payload: { extractionId, versionId: e.version_id, applied, changedFromProposal: proposed.filter(x => x.proposed !== x.confirmed) } });
  return { status: 'confirmed', applied, note: 'Alanlar kaydedildi. Belge hâlâ incelenmedi sayılır; geçerlilik için ayrıca incelenmesi gerekir.' };
}
