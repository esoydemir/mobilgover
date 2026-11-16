/** Writes the synthetic sample files used for AM-2 evidence (no real document, person or number): npx tsx scripts/write-doc-samples.ts <dir> */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blankPng, corruptPdf, photoJpeg, scannedPdf, textPdf } from '../test/support/doc-fixtures';

const dir = path.resolve(process.argv[2] ?? 'ornekler');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'metinli.pdf'), await textPdf());
writeFileSync(path.join(dir, 'taranmis.pdf'), await scannedPdf());
writeFileSync(path.join(dir, 'fotograf.jpg'), photoJpeg());
writeFileSync(path.join(dir, 'bos.png'), blankPng());
writeFileSync(path.join(dir, 'bozuk.pdf'), corruptPdf());
console.log('yazildi:', dir);
