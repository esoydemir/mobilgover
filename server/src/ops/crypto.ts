import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/*
 * Backup encryption: AES-256-GCM, streamed, one random IV per object.
 * File layout: "GHBK" | version(1) | key fingerprint(8) | IV(12) | ciphertext | tag(16).
 * The object name is authenticated data, so an encrypted file cannot be
 * swapped for another one without detection.
 */
const MAGIC = Buffer.from('GHBK');
const VERSION = 1;
const HEADER = MAGIC.length + 1 + 8 + 12;
const TAG = 16;

export function parseBackupKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error('BACKUP_ENCRYPTION_KEY tanımlı değil (32 bayt, base64: openssl rand -base64 32).');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY 32 bayt olmalı.');
  return k;
}

/** Reads the key from a file (preferred: kept outside the app data and the backup target) or from the variable. */
export async function loadBackupKey(env: NodeJS.ProcessEnv, forbiddenDirs: string[]): Promise<Buffer> {
  const file = env.BACKUP_ENCRYPTION_KEY_FILE;
  if (file) {
    const { resolve } = await import('node:path');
    const p = resolve(file) + '/';
    for (const d of forbiddenDirs.filter(Boolean)) {
      const r = resolve(d) + '/';
      if (p.startsWith(r)) throw new Error(`Şifreleme anahtarı yedeklerle ya da uygulama verisiyle aynı yerde tutulamaz: ${file}`);
    }
    const { readFile } = await import('node:fs/promises');
    return parseBackupKey((await readFile(file, 'utf8')).trim());
  }
  return parseBackupKey(env.BACKUP_ENCRYPTION_KEY);
}

export const keyFingerprint = (key: Buffer) => createHash('sha256').update(key).digest().subarray(0, 8);

export async function encryptFile(key: Buffer, name: string, src: string, dst: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name));
  const out = createWriteStream(dst, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), keyFingerprint(key), iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((res, rej) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? rej(e) : res())));
}

export async function decryptFile(key: Buffer, name: string, src: string, dst: string) {
  const size = (await stat(src)).size;
  if (size < HEADER + TAG) throw new Error(`${name}: şifreli dosya bozuk (çok kısa).`);
  const fh = await open(src, 'r');
  const head = Buffer.alloc(HEADER), tag = Buffer.alloc(TAG);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally { await fh.close(); }
  if (!head.subarray(0, 4).equals(MAGIC) || head[4] !== VERSION) throw new Error(`${name}: yedek biçimi tanınmadı.`);
  if (!head.subarray(5, 13).equals(keyFingerprint(key))) throw new Error(`${name}: bu dosya başka bir anahtarla şifrelenmiş.`);
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(13, 25));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(tag);
  // A failed tag check throws at the end; callers write to a temporary path and only use it after success.
  await pipeline(createReadStream(src, { start: HEADER, end: size - TAG - 1 }), decipher, createWriteStream(dst, { mode: 0o600 }));
}
