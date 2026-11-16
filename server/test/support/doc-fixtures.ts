import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const require_ = createRequire(import.meta.url);
const ttf = path.join(path.dirname(require_.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(ttf, 'DejaVuSans.ttf');
GlobalFonts.registerFromPath(FONT, 'DejaVu Test');

/** Synthetic Turkish sample text: no real person, business or number. */
export const SAMPLE_LINES = [
  'ÖRNEK BELEDİYESİ FEN İŞLERİ MÜDÜRLÜĞÜ',
  'İŞYERİ AÇMA VE ÇALIŞMA RUHSATI',
  'Belge No: RHS-2031-0457',
  'Düzenleme Tarihi: 05.03.2031',
  'Geçerlilik Bitişi: 04.03.2036',
  'Bu belge deneme amaçlı üretilmiş sentetik bir örnektir.',
];

const pdfToBuffer = (doc: PDFKit.PDFDocument) => new Promise<Buffer>(res => { const c: Buffer[] = []; doc.on('data', d => c.push(d)); doc.on('end', () => res(Buffer.concat(c))); doc.end(); });

/** PDF with a real text layer. */
export async function textPdf(lines = SAMPLE_LINES) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 }); doc.font(FONT).fontSize(14);
  for (const l of lines) doc.text(l).moveDown(0.5);
  return pdfToBuffer(doc);
}

/** What a scan or photo shows: text drawn into pixels. `skew` and `noise` make it photo-like. */
export function pagePng(lines = SAMPLE_LINES, o: { skew?: number; noise?: number; w?: number; h?: number; size?: number } = {}) {
  const w = o.w ?? 1240, h = o.h ?? 1000; const c = createCanvas(w, h); const x = c.getContext('2d');
  x.fillStyle = o.noise ? '#f1ede4' : '#ffffff'; x.fillRect(0, 0, w, h);
  x.save(); x.translate(80, 90); if (o.skew) x.rotate(o.skew);
  x.fillStyle = '#1b1b1b'; x.font = `${o.size ?? 38}px "DejaVu Test"`;
  lines.forEach((l, i) => x.fillText(l, 0, i * 78));
  x.restore();
  if (o.noise) {
    const d = x.getImageData(0, 0, w, h); let s = 12345;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1664525 + 1013904223) >>> 0; const n = ((s >>> 24) - 128) * o.noise;
      for (let k = 0; k < 3; k++) d.data[i + k] = Math.max(0, Math.min(255, d.data[i + k]! + n));
    }
    x.putImageData(d, 0, 0);
  }
  return c;
}

/** PDF made only of a page image: no text layer. */
export async function scannedPdf(lines = SAMPLE_LINES) {
  const png = pagePng(lines).toBuffer('image/png');
  const doc = new PDFDocument({ size: [620, 500], margin: 0 }); doc.image(png, 0, 0, { width: 620 });
  return pdfToBuffer(doc);
}

export const photoJpeg = (lines = SAMPLE_LINES) => pagePng(lines, { skew: 0.012, noise: 0.18 }).toBuffer('image/jpeg', 80);
export const blankPng = () => { const c = createCanvas(600, 400); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400); return c.toBuffer('image/png'); };
export const corruptPdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('bu dosya bozuk, nesne yok '.repeat(10))]);
