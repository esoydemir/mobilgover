import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Evidence file storage on local disk. The interface is small on purpose so
 * an object-storage adapter (with object lock / versioning) can replace it.
 */
export interface EvidenceStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export class LocalStore implements EvidenceStore {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('invalid storage key');
    return p;
  }

  async put(key: string, bytes: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    // 'wx' refuses to overwrite: a stored file is never replaced in place.
    await writeFile(p, bytes, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string) {
    try { return await readFile(this.path(key)); } catch { return null; }
  }
}

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Accepted upload types, checked by content signature, not by the declared MIME alone. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': b => b.subarray(0, 5).toString('latin1') === '%PDF-',
};
export const ALLOWED_MIME = Object.keys(SIGNATURES);
export const contentMatchesMime = (mime: string, b: Buffer) => SIGNATURES[mime]?.(b) ?? false;
