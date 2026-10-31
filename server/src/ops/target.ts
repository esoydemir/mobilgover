import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Where encrypted backups live. It must be a different location from the
 * application server (another machine, a mounted remote disk, or object
 * storage). Only encrypted objects ever reach it. An object-storage adapter
 * implements the same six methods once a provider is chosen.
 */
export interface BackupTarget {
  readonly description: string;
  put(name: string, localFile: string): Promise<void>;
  get(name: string, localFile: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  remove(name: string): Promise<void>;
  /** When the object was written; null if it does not exist. */
  modifiedAt(name: string): Promise<Date | null>;
}

/** A directory target: a mounted remote volume, a separate disk, or (in tests) a separate folder. */
export class DirTarget implements BackupTarget {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  get description() { return `klasör ${this.root}`; }
  private path(name: string) {
    const p = resolve(this.root, name);
    if (!p.startsWith(this.root + '/')) throw new Error('geçersiz nesne adı');
    return p;
  }
  async put(name: string, localFile: string) {
    const p = this.path(name);
    await mkdir(dirname(p), { recursive: true });
    // Write under a temporary name, then rename: a reader never sees half an object.
    const tmp = `${p}.partial-${process.pid}-${Date.now()}`;
    await copyFile(localFile, tmp);
    await rename(tmp, p);
  }
  async get(name: string, localFile: string) { await copyFile(this.path(name), localFile); }
  async exists(name: string) { try { return (await stat(this.path(name))).isFile(); } catch { return false; } }
  async list(prefix: string) {
    const dir = this.path(prefix);
    try { return (await readdir(dir)).filter(n => !n.includes('.partial-')).map(n => join(prefix, n)).sort(); } catch { return []; }
  }
  async remove(name: string) { await rm(this.path(name), { force: true }); }
  async modifiedAt(name: string) { try { return (await stat(this.path(name))).mtime; } catch { return null; } }
}

/** Refuses a target inside the application's own data directories. */
export function assertSeparate(target: string, appPaths: string[]) {
  const t = resolve(target) + '/';
  for (const a of appPaths) {
    const p = resolve(a) + '/';
    if (t.startsWith(p) || p.startsWith(t)) throw new Error(`Yedek hedefi uygulama verisiyle aynı yerde olamaz: ${target} ↔ ${a}`);
  }
}
