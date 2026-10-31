import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
// Loads the shared type parsers (bigint → number, timestamptz → ISO text). The audit
// chain is hashed over those exact representations, so verification needs them too.
import '../db/pool';
import { verifyCompanyChain } from '../services/audit';

/*
 * Backup and restore, independent of any hosting provider: PostgreSQL's own
 * dump format plus a plain copy of the evidence directory, tied together by a
 * manifest of SHA-256 digests. A restore refuses to start when anything in
 * the backup does not match its manifest, and refuses a non-empty target.
 *
 * Consistency: the database is dumped first, then evidence files are copied.
 * Files are write-once and written before their row is marked "stored", so
 * every stored row in the dump has its file in the copy.
 */

const run = promisify(execFile);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const DUMP = 'database.dump';
const FILES = 'evidence';
const MANIFEST = 'manifest.json';

export type Manifest = {
  format: 'goverhub-backup-1';
  createdAt: string;
  pgDumpVersion: string;
  serverVersion: string;
  migrations: string[];
  rowCounts: Record<string, number>;
  database: { file: string; sha256: string; size: number };
  evidence: { key: string; sha256: string; size: number }[];
  /** Stored evidence rows whose file was missing at backup time. Should be empty. */
  missingAtBackup: string[];
};

export type Check = { name: string; ok: boolean; detail?: string };
export type Report = { ok: boolean; checks: Check[] };

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (e.isFile()) out.push(relative(root, p));
    }
  }
  await walk(root);
  return out.sort();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function tableCounts(c: pg.Client): Promise<Record<string, number>> {
  const tables = (await c.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map(r => r.t);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = (await c.query(`SELECT count(*)::int AS n FROM public.${pg.escapeIdentifier(t)}`)).rows[0].n;
  return out;
}

/** Creates a backup in `outDir` (must not exist or be empty). Uses the owner connection. */
export async function createBackup(o: { ownerUrl: string; evidenceDir: string; outDir: string }): Promise<Manifest> {
  await mkdir(o.outDir, { recursive: true });
  if ((await readdir(o.outDir)).length) throw new Error(`Yedek klasörü boş değil: ${o.outDir}`);
  const dumpPath = join(o.outDir, DUMP);
  const pgDumpVersion = (await run('pg_dump', ['--version'])).stdout.trim();
  // Custom format, no ownership: the restoring owner role owns the objects; grants to goverhub_app are kept.
  await run('pg_dump', ['--format=custom', '--no-owner', '--file', dumpPath, '--dbname', o.ownerUrl], { maxBuffer: 64 * 1024 * 1024 });
  const dump = await readFile(dumpPath);

  const meta = await withClient(o.ownerUrl, async c => ({
    serverVersion: (await c.query(`SHOW server_version`)).rows[0].server_version as string,
    migrations: (await c.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map(r => r.name as string),
    rowCounts: await tableCounts(c),
    stored: (await c.query(`SELECT storage_key FROM evidence WHERE status = 'stored' AND storage_key IS NOT NULL`)).rows.map(r => r.storage_key as string),
  }));

  const evidence: Manifest['evidence'] = [];
  for (const key of await listFiles(o.evidenceDir)) {
    const bytes = await readFile(join(o.evidenceDir, key));
    const target = join(o.outDir, FILES, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    evidence.push({ key, sha256: sha(bytes), size: bytes.length });
  }
  const have = new Set(evidence.map(e => e.key));
  const manifest: Manifest = {
    format: 'goverhub-backup-1', createdAt: new Date().toISOString(), pgDumpVersion, serverVersion: meta.serverVersion,
    migrations: meta.migrations, rowCounts: meta.rowCounts,
    database: { file: DUMP, sha256: sha(dump), size: dump.length },
    evidence, missingAtBackup: meta.stored.filter(k => !have.has(k)),
  };
  await writeFile(join(o.outDir, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return manifest;
}

/** Checks every file of a backup against its manifest without touching any database. */
export async function verifyBackup(dir: string): Promise<Report & { manifest: Manifest | null }> {
  const checks: Check[] = [];
  let manifest: Manifest | null = null;
  try { manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')); } catch (e) {
    return { ok: false, manifest: null, checks: [{ name: 'manifest', ok: false, detail: `okunamadı: ${(e as Error).message}` }] };
  }
  if (manifest!.format !== 'goverhub-backup-1') checks.push({ name: 'manifest', ok: false, detail: `bilinmeyen biçim ${manifest!.format}` });
  try {
    const d = await readFile(join(dir, manifest!.database.file));
    checks.push({ name: 'veritabanı dökümü', ok: sha(d) === manifest!.database.sha256, detail: sha(d) === manifest!.database.sha256 ? undefined : 'özet eşleşmiyor' });
  } catch { checks.push({ name: 'veritabanı dökümü', ok: false, detail: 'dosya yok' }); }
  const listed = new Set(manifest!.evidence.map(e => e.key));
  const bad: string[] = [];
  for (const e of manifest!.evidence) {
    try { if (sha(await readFile(join(dir, FILES, e.key))) !== e.sha256) bad.push(`${e.key}: özet eşleşmiyor`); } catch { bad.push(`${e.key}: dosya yok`); }
  }
  for (const k of await listFiles(join(dir, FILES))) if (!listed.has(k)) bad.push(`${k}: manifestte yok`);
  checks.push({ name: `kanıt dosyaları (${manifest!.evidence.length})`, ok: bad.length === 0, detail: bad.slice(0, 10).join('; ') || undefined });
  checks.push({ name: 'yedek anında eksik kanıt dosyası', ok: manifest!.missingAtBackup.length === 0, detail: manifest!.missingAtBackup.join(', ') || undefined });
  return { ok: checks.every(c => c.ok), checks, manifest };
}

/** After a restore (or at any time): the database and evidence directory agree with each other and with the manifest. */
export async function checkRestored(o: { ownerUrl: string; evidenceDir: string; manifest?: Manifest }): Promise<Report> {
  const checks: Check[] = [];
  await withClient(o.ownerUrl, async c => {
    if (o.manifest) {
      const migrations = (await c.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map(r => r.name);
      checks.push({ name: 'migration listesi', ok: JSON.stringify(migrations) === JSON.stringify(o.manifest.migrations) });
      const counts = await tableCounts(c);
      const diff = Object.keys({ ...counts, ...o.manifest.rowCounts }).filter(t => counts[t] !== o.manifest!.rowCounts[t]);
      checks.push({ name: 'tablo satır sayıları', ok: diff.length === 0, detail: diff.map(t => `${t}: ${o.manifest!.rowCounts[t]} → ${counts[t]}`).join('; ') || undefined });
    }
    // Hash chains, per company and the platform chain.
    const companies = (await c.query(`SELECT DISTINCT company_id FROM audit_events`)).rows.map(r => r.company_id as string | null);
    const broken: string[] = [];
    let events = 0;
    for (const id of companies) {
      const v = await verifyCompanyChain(c as unknown as pg.PoolClient, id);
      events += v.count;
      if (!v.ok) broken.push(`${id ?? 'platform'} @${v.brokenAtSeq}: ${v.reason}`);
    }
    checks.push({ name: `denetim zincirleri (${companies.length} zincir, ${events} olay)`, ok: broken.length === 0, detail: broken.join('; ') || undefined });
    // Every stored evidence row has its file, with the recorded digest.
    const rows = (await c.query(`SELECT id, storage_key, sha256 FROM evidence WHERE status = 'stored' AND storage_key IS NOT NULL`)).rows;
    const bad: string[] = [];
    for (const r of rows) {
      try { if (sha(await readFile(join(o.evidenceDir, r.storage_key))) !== r.sha256) bad.push(`${r.id}: özet eşleşmiyor`); } catch { bad.push(`${r.id}: dosya yok`); }
    }
    checks.push({ name: `kayıtlı kanıtların dosyaları (${rows.length})`, ok: bad.length === 0, detail: bad.slice(0, 10).join('; ') || undefined });
  });
  return { ok: checks.every(c => c.ok), checks };
}

/**
 * Restores into an EMPTY database and an EMPTY evidence directory. The target
 * cluster must already have the goverhub_app role (grants are restored).
 */
export async function restoreBackup(o: { dir: string; targetOwnerUrl: string; targetEvidenceDir: string }): Promise<Report> {
  const v = await verifyBackup(o.dir);
  if (!v.ok) return { ok: false, checks: [{ name: 'yedek doğrulaması (geri yükleme başlamadı)', ok: false }, ...v.checks] };
  const tables = await withClient(o.targetOwnerUrl, async c => (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n as number);
  if (tables > 0) return { ok: false, checks: [{ name: 'hedef veritabanı boş', ok: false, detail: `${tables} tablo var; geri yükleme yalnızca boş veritabanına yapılır` }] };
  await mkdir(o.targetEvidenceDir, { recursive: true });
  if ((await listFiles(o.targetEvidenceDir)).length) return { ok: false, checks: [{ name: 'hedef kanıt klasörü boş', ok: false }] };

  await run('pg_restore', ['--no-owner', '--exit-on-error', '--single-transaction', '--dbname', o.targetOwnerUrl, join(o.dir, DUMP)], { maxBuffer: 64 * 1024 * 1024 });
  for (const e of v.manifest!.evidence) {
    const target = resolve(o.targetEvidenceDir, e.key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(o.dir, FILES, e.key), target);
  }
  const after = await checkRestored({ ownerUrl: o.targetOwnerUrl, evidenceDir: o.targetEvidenceDir, manifest: v.manifest! });
  return { ok: after.ok, checks: [...v.checks, ...after.checks] };
}

export async function isDirectory(p: string) { try { return (await stat(p)).isDirectory(); } catch { return false; } }
