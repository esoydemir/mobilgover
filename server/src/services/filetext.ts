import { createRequire } from 'node:module';
import path from 'node:path';

/*
 * Text from an uploaded file, inside the pilot (no paid service, nothing leaves the machine):
 *  - PDF with a text layer: the text is read directly (method `pdf_text`).
 *  - Scanned PDF: pages are rendered and read with the local OCR engine (`ocr_pdf`).
 *  - Photo (JPEG/PNG): read with the local OCR engine (`ocr_image`).
 * Limits keep one request bounded: file size, page count, a time budget per file.
 */

export type ReadMethod = 'pdf_text' | 'ocr_pdf' | 'ocr_image';
export type LowWord = { text: string; confidence: number };
export type FileReading = { method: ReadMethod; text: string; pages: number; confidence: number | null; lowWords: LowWord[] };
export class FileReadError extends Error {
  constructor(readonly kind: 'unsupported' | 'unreadable' | 'too_large' | 'timeout', message: string) { super(message); }
}

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 5;
const OCR_TIMEOUT_MS = 90_000;
const MIN_TEXT = 20;
export const LOW_WORD_CONFIDENCE = 70;

const require_ = createRequire(import.meta.url);
const tessDir = () => path.dirname(require_.resolve('@tesseract.js-data/tur/package.json'));

export const ocrEngine = { name: 'Tesseract (Türkçe, yerel)', version: '7' };

// One recognition worker per process; recognitions are queued so concurrent requests never share it.
let workerP: Promise<import('tesseract.js').Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
async function worker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('tur', 1, { langPath: path.join(tessDir(), '4.0.0'), gzip: true, cacheMethod: 'none' });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}
export async function stopOcr() { const w = workerP; workerP = null; if (w) await (await w).terminate().catch(() => undefined); }

async function recognize(png: Buffer): Promise<{ text: string; confidence: number; lowWords: LowWord[] }> {
  const run = async () => {
    const w = await worker();
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new FileReadError('timeout', 'Okuma çok uzun sürdü.')), OCR_TIMEOUT_MS).unref());
    const r = await Promise.race([w.recognize(png, {}, { blocks: true }), timeout]);
    const words: LowWord[] = [];
    for (const b of r.data.blocks ?? []) for (const para of b.paragraphs) for (const line of para.lines) for (const wd of line.words) words.push({ text: wd.text, confidence: wd.confidence });
    return { text: r.data.text ?? '', confidence: r.data.confidence ?? 0, lowWords: words.filter(x => x.confidence < LOW_WORD_CONFIDENCE && /[\p{L}\p{N}]/u.test(x.text)) };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  try { return await next; } catch (e) {
    if (e instanceof FileReadError) { await stopOcr(); throw e; } // a timed-out worker is discarded
    throw new FileReadError('unreadable', 'Görüntü okunamadı.');
  }
}

const normalise = (t: string) => t.replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] ?? '')).join('\n').trim();
const longEnough = (t: string) => t.replace(/\s/g, '').length >= MIN_TEXT;

async function openPdf(bytes: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const std = path.join(path.dirname(require_.resolve('pdfjs-dist/package.json')), 'standard_fonts').split(path.sep).join('/') + '/';
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: std, verbosity: 0 });
    return { doc: await task.promise, task };
  } catch (e) { if (process.env.FT_DEBUG) console.error(e); throw new FileReadError('unreadable', 'PDF açılamadı; dosya bozuk ya da şifreli olabilir.'); }
}

async function readPdf(bytes: Buffer): Promise<FileReading> {
  const { doc, task } = await openPdf(bytes);
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    let direct = '';
    for (let i = 1; i <= pages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      direct += tc.items.map((it: any) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('') + '\n';
    }
    direct = normalise(direct);
    if (longEnough(direct)) return { method: 'pdf_text', text: direct, pages, confidence: null, lowWords: [] };
    // No usable text layer: a scan. Render each page and read it.
    const parts: string[] = []; const low: LowWord[] = []; let conf = 0, n = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2.5 });
      const { createCanvas } = await import('@napi-rs/canvas');
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport: vp }).promise;
      const r = await recognize(canvas.toBuffer('image/png'));
      parts.push(r.text); low.push(...r.lowWords); conf += r.confidence; n++;
    }
    return { method: 'ocr_pdf', text: normalise(parts.join('\n')), pages: n, confidence: n ? Math.round(conf / n) : 0, lowWords: low };
  } finally { await task.destroy().catch(() => undefined); }
}

async function readImage(bytes: Buffer): Promise<FileReading> {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  let img;
  try { img = await loadImage(bytes); } catch { throw new FileReadError('unreadable', 'Görüntü açılamadı.'); }
  // Bring the photo to a size the engine reads well (long side up to ~2000 px), on a white ground.
  const k = Math.min(2, 2000 / Math.max(img.width, img.height)); const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  const r = await recognize(canvas.toBuffer('image/png'));
  return { method: 'ocr_image', text: normalise(r.text), pages: 1, confidence: Math.round(r.confidence), lowWords: r.lowWords };
}

/** Reads the text of a stored file. Throws FileReadError (unsupported / unreadable / too_large / timeout); a successful result always has enough text. */
export async function readFileText(mime: string, bytes: Buffer): Promise<FileReading> {
  if (bytes.length > MAX_BYTES) throw new FileReadError('too_large', 'Dosya 10 MB sınırını aşıyor.');
  let r: FileReading;
  if (mime === 'application/pdf') r = await readPdf(bytes);
  else if (mime === 'image/jpeg' || mime === 'image/png') r = await readImage(bytes);
  else throw new FileReadError('unsupported', 'Bu dosya türünden metin okunamaz (PDF, JPEG ya da PNG olmalı).');
  if (!longEnough(r.text)) throw new FileReadError('unreadable', 'Dosyadan okunabilir metin çıkmadı. Daha net bir fotoğraf çek ya da alanları elle gir.');
  return r;
}
