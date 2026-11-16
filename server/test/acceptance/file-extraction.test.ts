import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { stopOcr } from '../../src/services/filetext';
import { blankPng, corruptPdf, photoJpeg, scannedPdf, textPdf, SAMPLE_LINES } from '../support/doc-fixtures';
import { client, freshEnv, type Env } from '../support/env';

/** AM-2: fields come from the uploaded file itself (text-layer PDF directly, scan and photo through the local OCR engine); a person confirms. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const reviewer = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await stopOcr(); await env?.close(); });

/** A document with one stored version holding `bytes`. */
async function withFile(title: string, mime: string, bytes: Buffer, upload = true) {
  const docId = (await owner().post(`${C()}/documents`, { docType: 'other', title, siteId: demo.siteId })).body.id as string;
  const v = (await owner().post(`${C()}/documents/${docId}/versions`, { validFrom: null, validUntil: null, file: { mime, sha256: sha(bytes), sizeBytes: bytes.length } })).body;
  if (upload) expect((await owner().put(`${C()}/evidence/${v.evidenceId}/content`, bytes, mime)).status).toBe(200);
  return { docId, versionId: v.versionId as string };
}
const read = (f: { docId: string; versionId: string }, c = owner()) => c.post(`${C()}/documents/${f.docId}/versions/${f.versionId}/extract-file`, {});
const field = (body: any, name: string) => body.suggestions.find((s: any) => s.field === name);

describe('fields come from the file', () => {
  it('text-layer PDF: read directly, no OCR', async () => {
    const f = await withFile('Metinli PDF', 'application/pdf', await textPdf());
    const r = await read(f);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ method: 'pdf_text', status: 'pending', reused: false });
    expect(r.body.sourceText).toContain('RHS-2031-0457');
    expect(field(r.body, 'documentNo')?.value).toBe('RHS-2031-0457');
    expect(field(r.body, 'docType')?.value).toBe('business_license');
    expect(field(r.body, 'issuer')?.value).toMatch(/BELEDİYESİ/);
    expect(field(r.body, 'validUntil')?.value).toBe('2036-03-04');
  });

  it('scanned PDF (no text layer): OCR reads the page', async () => {
    const f = await withFile('Taranmış PDF', 'application/pdf', await scannedPdf());
    const r = await read(f);
    expect(r.status).toBe(201);
    expect(r.body.method).toBe('ocr_pdf');
    expect(r.body.readConfidence).toBeGreaterThan(70);
    expect(r.body.sourceText).toContain('RHS-2031-0457');
    expect(field(r.body, 'documentNo')?.value).toBe('RHS-2031-0457');
    expect(field(r.body, 'validUntil')?.value).toBe('2036-03-04');
  }, 60000);

  it('Turkish photo (slightly skewed, noisy): OCR reads Turkish letters; the reading is bound to the version', async () => {
    const f = await withFile('Fotoğraf', 'image/jpeg', photoJpeg());
    const r = await read(f);
    expect(r.status).toBe(201);
    expect(r.body.method).toBe('ocr_image');
    expect(r.body.sourceText).toMatch(/İŞYERİ AÇMA VE ÇALIŞMA RUHSATI/);
    expect(field(r.body, 'documentNo')?.value).toBe('RHS-2031-0457');
    const list = (await owner().get(`${C()}/documents/${f.docId}/extractions`)).body;
    expect(list.items[0]).toMatchObject({ versionId: f.versionId, method: 'ocr_image', source: 'file', status: 'pending' });
    expect(list.items[0].sourceText).toContain('Düzenleme Tarihi');
    expect(list.items[0].fileSha256).toHaveLength(64);
  }, 60000);

  it('a different document: values differ, so they come from the file and not from a template', async () => {
    const other = SAMPLE_LINES.map(l => l.replace('RHS-2031-0457', 'RHS-2044-0912').replace('04.03.2036', '17.09.2041'));
    const f = await withFile('Başka PDF', 'application/pdf', await textPdf(other));
    const r = await read(f);
    expect(field(r.body, 'documentNo')?.value).toBe('RHS-2044-0912');
    expect(field(r.body, 'validUntil')?.value).toBe('2041-09-17');
  });
});

describe('review, confirmation and repeats', () => {
  it('reading again returns the same pending reading; no second reading, no second document', async () => {
    const f = await withFile('Tekrar', 'application/pdf', await textPdf());
    const a = await read(f); const b = await read(f);
    expect(a.status).toBe(201); expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: a.body.id, reused: true });
    const items = (await owner().get(`${C()}/documents/${f.docId}/extractions`)).body.items;
    expect(items).toHaveLength(1);
    const n = (await env.db.system(tx => tx.query(`SELECT count(*)::int AS n FROM documents WHERE company_id = $1 AND title = 'Tekrar'`, [demo.companyId]))).rows[0].n;
    expect(n).toBe(1);
  });

  it('confirming writes the corrected fields; the version stays unreviewed', async () => {
    const f = await withFile('Onay', 'application/pdf', await textPdf());
    const r = (await read(f)).body;
    const ok = await owner().post(`${C()}/extractions/${r.id}/decision`, { confirm: true, fields: { docType: 'business_license', documentNo: 'RHS-2031-0458', validUntil: '2036-03-04' } });
    expect(ok.status).toBe(200);
    expect(ok.body.applied).toMatchObject({ documentNo: 'RHS-2031-0458' });
    const d = (await owner().get(`${C()}/documents/${f.docId}`)).body;
    expect(d.documentNo).toBe('RHS-2031-0458');
    expect(d.versions[0]).toMatchObject({ review_status: 'unreviewed' });
  });

  it('on a reviewed version the dates stay: confirming a date change is refused, the document details still apply', async () => {
    const f = await withFile('İncelenmiş', 'application/pdf', await textPdf());
    const rv = await reviewer().post(`${C()}/documents/${f.docId}/versions/${f.versionId}/review`, { decision: 'verified', notes: 'Aslına bakıldı.', validFrom: '2031-03-05', validUntil: '2036-03-04' });
    expect(rv.status).toBe(200);
    const r = (await read(f)).body;
    expect(r.versionReviewStatus).not.toBe('unreviewed');
    const bad = await owner().post(`${C()}/extractions/${r.id}/decision`, { confirm: true, fields: { validUntil: '2040-01-01' } });
    expect(bad.status).toBe(409);
    expect((await owner().post(`${C()}/extractions/${r.id}/decision`, { confirm: true, fields: { documentNo: 'RHS-2031-0457' } })).status).toBe(200);
    const v = (await owner().get(`${C()}/documents/${f.docId}`)).body.versions[0];
    expect(v.review_status).not.toBe('unreviewed');
    expect(String(v.valid_until).slice(0, 10)).toBe('2036-03-04');
  });

  it('someone without write rights on the document cannot read the file into suggestions', async () => {
    const f = await withFile('Yetki', 'application/pdf', await textPdf());
    expect((await read(f, staff())).status).toBe(404);
  });
});

describe('unreadable and unsupported files: a clear error, retry or manual entry', () => {
  it('a blank image: 422 with a retry hint; nothing is recorded', async () => {
    const f = await withFile('Boş', 'image/png', blankPng());
    const r = await read(f);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'FILE_UNREADABLE', details: { retry: true, manual: true } });
    expect(r.body.error.message).toMatch(/elle gir/);
    expect((await owner().get(`${C()}/documents/${f.docId}/extractions`)).body.items).toHaveLength(0);
  }, 60000);

  it('a corrupt PDF: 422, and typing the text by hand still works on the same version', async () => {
    const f = await withFile('Bozuk', 'application/pdf', corruptPdf());
    const r = await read(f);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('FILE_UNREADABLE');
    const manual = await owner().post(`${C()}/documents/${f.docId}/versions/${f.versionId}/extractions`, { text: SAMPLE_LINES.join('\n'), source: 'typed_text' });
    expect(manual.status).toBe(201);
  });

  it('a version with no stored file: 409 pointing to manual entry', async () => {
    const f = await withFile('Dosyasız', 'application/pdf', await textPdf(), false);
    const r = await read(f);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_FILE');
  });
});
