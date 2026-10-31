import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
// Loads the shared type parsers (bigint → number, timestamptz → ISO text). The audit
// chain is hashed over those exact representations, so verification needs them too.
import '../db/pool';
import { verifyCompanyChain } from '../services/audit';
import { decryptFile, encryptFile, keyFingerprint } from './crypto';
import type { BackupTarget } from './target';

/*
 * Backups, format 2.
 *
 * Consistency: one REPEATABLE READ transaction exports a snapshot; pg_dump
 * runs on that snapshot, and the list of stored evidence files is read in the
 * same snapshot. The backup therefore contains exactly the evidence that the
 * dumped database calls "stored" — no more, no less — even while people keep
 * recording tasks and uploading photos.
 *
 * Location and encryption: everything is encrypted on this machine (AES-256-GCM)
 * before it reaches the target, which is a different location from the server.
 * Evidence files are immutable, so each is uploaded once (named by a hash of its
 * storage key) and later backups only add new ones. Each backup is one encrypted
 * database dump plus an encrypted manifest; the manifest is written last and
 * marks the backup as complete.
 */

const run = promisify(execFile);
const shaBuf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function shaFile(p: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest('hex');
}
export const evidenceObject = (storageKey: string) => `evidence/${shaBuf(Buffer.from(storageKey))}.enc`;
const dumpObject = (id: string) => `db/${id}.dump.enc`;
const manifestObject = (id: string) => `db/${id}.manifest.enc`;

export type Manifest = {
  format: 'goverhub-backup-2';
  id: string;
  createdAt: string;
  /** Database time inside the snapshot: the point the backup represents. */
  snapshotAt: string;
  keyFingerprint: string;
  pgDumpVersion: string;
  serverVersion: string;
  migrations: string[];
  rowCounts: Record<string, number>;
  dump: { object: string; sha256: string; size: number };
  evidence: { key: string; sha256: string; object: string }[];
  durationMs: number;
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

export type BackupOptions = {
  ownerUrl: string; evidenceDir: string; target: BackupTarget; key: Buffer;
  /** Test hook: runs after the snapshot is taken, while pg_dump has not started yet. */
  afterSnapshot?: () => Promise<void>;
};

/** Takes one consistent, encrypted backup into the target. Throws on any problem. */
export async function createBackup(o: BackupOptions): Promise<Manifest> {
  const started = Date.now();
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const work = await mkdtemp(join(tmpdir(), 'gh-backup-'));
  try {
    const dumpPath = join(work, 'database.dump');
    const pgDumpVersion = (await run('pg_dump', ['--version'])).stdout.trim();
    const snap = await withClient(o.ownerUrl, async c => {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const snapshot = (await c.query(`SELECT pg_export_snapshot() AS s`)).rows[0].s as string;
        const meta = {
          snapshotAt: (await c.query(`SELECT now() AS t`)).rows[0].t as string,
          serverVersion: (await c.query(`SHOW server_version`)).rows[0].server_version as string,
          migrations: (await c.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map(r => r.name as string),
          rowCounts: await tableCounts(c),
          stored: (await c.query(`SELECT storage_key, sha256 FROM evidence WHERE status = 'stored' AND storage_key IS NOT NULL ORDER BY storage_key`)).rows as { storage_key: string; sha256: string }[],
        };
        await o.afterSnapshot?.();
        // Same snapshot as the queries above; the transaction stays open until pg_dump is done.
        await run('pg_dump', ['--format=custom', '--no-owner', `--snapshot=${snapshot}`, '--file', dumpPath, '--dbname', o.ownerUrl], { maxBuffer: 64 * 1024 * 1024 });
        return meta;
      } finally { await c.query('COMMIT'); }
    });

    const evidence: Manifest['evidence'] = [];
    for (const r of snap.stored) {
      const object = evidenceObject(r.storage_key);
      evidence.push({ key: r.storage_key, sha256: r.sha256, object });
      if (await o.target.exists(object)) continue;
      const src = join(o.evidenceDir, r.storage_key);
      let actual: string;
      try { actual = await shaFile(src); } catch { throw new Error(`Kayıtlı kanıtın dosyası yok: ${r.storage_key}`); }
      if (actual !== r.sha256) throw new Error(`Kanıt dosyası kayıttaki özetle eşleşmiyor: ${r.storage_key}`);
      const enc = join(work, 'e.enc');
      await encryptFile(o.key, object, src, enc);
      await o.target.put(object, enc);
    }

    const dumpEnc = join(work, 'database.dump.enc');
    await encryptFile(o.key, dumpObject(id), dumpPath, dumpEnc);
    await o.target.put(dumpObject(id), dumpEnc);
    const manifest: Manifest = {
      format: 'goverhub-backup-2', id, createdAt: new Date().toISOString(), snapshotAt: snap.snapshotAt,
      keyFingerprint: keyFingerprint(o.key).toString('hex'), pgDumpVersion, serverVersion: snap.serverVersion,
      migrations: snap.migrations, rowCounts: snap.rowCounts,
      dump: { object: dumpObject(id), sha256: await shaFile(dumpPath), size: (await stat(dumpPath)).size },
      evidence, durationMs: Date.now() - started,
    };
    const mPath = join(work, 'manifest.json');
    await writeFile(mPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await encryptFile(o.key, manifestObject(id), mPath, mPath + '.enc');
    // Written last: a backup without a manifest is incomplete and ignored.
    await o.target.put(manifestObject(id), mPath + '.enc');
    return manifest;
  } finally { await rm(work, { recursive: true, force: true }); }
}

export async function listBackups(target: BackupTarget): Promise<string[]> {
  return (await target.list('db')).filter(n => n.endsWith('.manifest.enc')).map(n => n.slice(3, -'.manifest.enc'.length)).sort();
}

export async function readManifest(target: BackupTarget, key: Buffer, id: string): Promise<Manifest> {
  const work = await mkdtemp(join(tmpdir(), 'gh-manifest-'));
  try {
    await target.get(manifestObject(id), join(work, 'm.enc'));
    await decryptFile(key, manifestObject(id), join(work, 'm.enc'), join(work, 'm.json'));
    return JSON.parse(await readFile(join(work, 'm.json'), 'utf8'));
  } finally { await rm(work, { recursive: true, force: true }); }
}

/**
 * Checks a backup in the target: the dump decrypts and matches its digest, and
 * every evidence object exists. `deepEvidence` also decrypts that many evidence
 * objects (all when Infinity) and compares their digests.
 */
export async function verifyBackup(target: BackupTarget, key: Buffer, id: string, deepEvidence = 0): Promise<Report & { manifest: Manifest | null }> {
  const checks: Check[] = [];
  let manifest: Manifest;
  try { manifest = await readManifest(target, key, id); } catch (e) {
    return { ok: false, manifest: null, checks: [{ name: 'manifest', ok: false, detail: (e as Error).message }] };
  }
  const work = await mkdtemp(join(tmpdir(), 'gh-verify-'));
  try {
    try {
      await target.get(manifest.dump.object, join(work, 'd.enc'));
      await decryptFile(key, manifest.dump.object, join(work, 'd.enc'), join(work, 'd'));
      const ok = (await shaFile(join(work, 'd'))) === manifest.dump.sha256;
      checks.push({ name: 'veritabanı dökümü (şifre çözüldü)', ok, detail: ok ? undefined : 'özet eşleşmiyor' });
    } catch (e) { checks.push({ name: 'veritabanı dökümü (şifre çözüldü)', ok: false, detail: (e as Error).message }); }
    const missing: string[] = [];
    for (const e of manifest.evidence) if (!(await target.exists(e.object))) missing.push(e.key);
    checks.push({ name: `kanıt nesneleri mevcut (${manifest.evidence.length})`, ok: missing.length === 0, detail: missing.slice(0, 10).join(', ') || undefined });
    const sample = [...manifest.evidence].sort(() => Math.random() - 0.5).slice(0, Math.min(deepEvidence, manifest.evidence.length));
    const bad: string[] = [];
    for (const e of sample) {
      try {
        await target.get(e.object, join(work, 'e.enc'));
        await decryptFile(key, e.object, join(work, 'e.enc'), join(work, 'e'));
        if ((await shaFile(join(work, 'e'))) !== e.sha256) bad.push(`${e.key}: özet`);
      } catch (err) { bad.push(`${e.key}: ${(err as Error).message}`); }
      await rm(join(work, 'e'), { force: true });
    }
    if (sample.length) checks.push({ name: `kanıt nesneleri şifre çözülerek denendi (${sample.length})`, ok: bad.length === 0, detail: bad.slice(0, 10).join('; ') || undefined });
  } finally { await rm(work, { recursive: true, force: true }); }
  return { ok: checks.every(c => c.ok), checks, manifest };
}

/**
 * The database and evidence directory agree: chains verify, every stored
 * evidence row has its file with the recorded digest, and (with `manifest`)
 * migrations and row counts match the backup. `strict` also fails on files
 * that no stored row refers to (expected right after a restore).
 */
export async function checkRestored(o: { ownerUrl: string; evidenceDir: string; manifest?: Manifest; strict?: boolean }): Promise<Report> {
  const checks: Check[] = [];
  await withClient(o.ownerUrl, async c => {
    if (o.manifest) {
      const migrations = (await c.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map(r => r.name);
      checks.push({ name: 'migration listesi', ok: JSON.stringify(migrations) === JSON.stringify(o.manifest.migrations) });
      const counts = await tableCounts(c);
      const diff = Object.keys({ ...counts, ...o.manifest.rowCounts }).filter(t => counts[t] !== o.manifest!.rowCounts[t]);
      checks.push({ name: 'tablo satır sayıları', ok: diff.length === 0, detail: diff.map(t => `${t}: ${o.manifest!.rowCounts[t]} → ${counts[t]}`).join('; ') || undefined });
    }
    const companies = (await c.query(`SELECT DISTINCT company_id FROM audit_events`)).rows.map(r => r.company_id as string | null);
    const broken: string[] = [];
    let events = 0;
    for (const id of companies) {
      const v = await verifyCompanyChain(c as unknown as pg.PoolClient, id);
      events += v.count;
      if (!v.ok) broken.push(`${id ?? 'platform'} @${v.brokenAtSeq}: ${v.reason}`);
    }
    checks.push({ name: `denetim zincirleri (${companies.length} zincir, ${events} olay)`, ok: broken.length === 0, detail: broken.join('; ') || undefined });
    const rows = (await c.query(`SELECT id, storage_key, sha256 FROM evidence WHERE status = 'stored' AND storage_key IS NOT NULL`)).rows;
    const bad: string[] = [];
    for (const r of rows) {
      try { if ((await shaFile(join(o.evidenceDir, r.storage_key))) !== r.sha256) bad.push(`${r.id}: özet eşleşmiyor`); } catch { bad.push(`${r.id}: dosya yok`); }
    }
    checks.push({ name: `kayıtlı kanıtların dosyaları (${rows.length})`, ok: bad.length === 0, detail: bad.slice(0, 10).join('; ') || undefined });
    const known = new Set(rows.map(r => r.storage_key as string));
    const orphans = (await listFiles(o.evidenceDir)).filter(f => !known.has(f));
    // In a running system an orphan is a file whose upload did not finish recording; it is reported, not fatal.
    checks.push({ name: 'kayda bağlı olmayan dosya', ok: !o.strict || orphans.length === 0, detail: orphans.length ? `${orphans.length}: ${orphans.slice(0, 5).join(', ')}` : undefined });
  });
  return { ok: checks.every(c => c.ok), checks };
}

export type RestorePhase = 'staging' | 'staged' | 'db_committed' | 'files_in_place';
export type RestoreOptions = {
  target: BackupTarget; key: Buffer; backupId: string; targetOwnerUrl: string; targetEvidenceDir: string;
  /** Test hook to simulate a crash: throws right after reaching this point. */
  crashAt?: 'mid_staging' | 'staged' | 'db_committed' | 'files_in_place';
  log?: (m: string) => void;
};

/**
 * Restores a backup into an EMPTY database and evidence directory.
 *
 * The database restore is one PostgreSQL transaction; the file system is not
 * part of it. The steps are ordered so that every interruption leaves a state
 * the next run can finish or undo, recorded in a journal next to the evidence
 * directory:
 *   1. staging   – files are decrypted into a staging folder beside the target
 *                  (database untouched). On a rerun, staged files whose digest
 *                  matches the manifest are reused; anything else is deleted.
 *   2. staged    – all files verified. Then pg_restore runs in one transaction:
 *                  it either commits fully or leaves the database empty.
 *   3. db_committed – the staging folder is renamed onto the evidence directory
 *                  (one atomic rename on the same file system).
 *   4. files_in_place – final checks; the journal is removed on success.
 */
export async function restoreBackup(o: RestoreOptions): Promise<Report> {
  const log = o.log ?? (() => {});
  const staging = `${o.targetEvidenceDir}.restore-staging`;
  const journalPath = `${o.targetEvidenceDir}.restore-journal.json`;
  type Journal = { backupId: string; phase: RestorePhase };
  let journal: Journal | null = null;
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch { /* none */ }
  const setPhase = async (phase: RestorePhase) => { journal = { backupId: o.backupId, phase }; await writeFile(journalPath, JSON.stringify(journal)); log(`aşama: ${phase}`); };
  const crash = (at: RestoreOptions['crashAt']) => { if (o.crashAt === at) throw new Error(`[test] yapay kesinti: ${at}`); };

  const v = await verifyBackup(o.target, o.key, o.backupId);
  if (!v.ok) return { ok: false, checks: [{ name: 'yedek doğrulaması (geri yükleme başlamadı)', ok: false }, ...v.checks] };
  const m = v.manifest!;
  const tables = async () => withClient(o.targetOwnerUrl, async c => (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n as number);

  if (journal && journal.backupId !== o.backupId) {
    return { ok: false, checks: [{ name: 'yarım kalmış başka geri yükleme', ok: false, detail: `${journal.backupId} (${journal.phase}); önce onu tamamla ya da hedefi elle temizle` }] };
  }
  let resumeAfterDb = journal?.phase === 'db_committed' || journal?.phase === 'files_in_place';
  // Crash between pg_restore's commit and the journal update: the database already matches this backup.
  if (journal?.phase === 'staged' && (await tables()) > 0) {
    const same = await withClient(o.targetOwnerUrl, async c => {
      const mig = (await c.query(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map(r => r.name);
      return JSON.stringify(mig) === JSON.stringify(m.migrations) && JSON.stringify(await tableCounts(c)) === JSON.stringify(m.rowCounts);
    }).catch(() => false);
    if (!same) return { ok: false, checks: [{ name: 'yarım geri yükleme', ok: false, detail: 'veritabanı dolu ama bu yedekle eşleşmiyor; elle incele' }] };
    await setPhase('db_committed');
    resumeAfterDb = true;
  }
  if (!resumeAfterDb) {
    if ((await tables()) > 0) return { ok: false, checks: [{ name: 'hedef veritabanı boş', ok: false, detail: 'geri yükleme yalnızca boş veritabanına yapılır' }] };
    if ((await listFiles(o.targetEvidenceDir)).length) return { ok: false, checks: [{ name: 'hedef kanıt klasörü boş', ok: false }] };

    // 1. Stage files, reusing verified leftovers of an interrupted run.
    await setPhase('staging');
    await mkdir(staging, { recursive: true });
    const wanted = new Map(m.evidence.map(e => [e.key, e]));
    let reused = 0, removed = 0;
    for (const f of await listFiles(staging)) {
      const e = wanted.get(f);
      if (e && (await shaFile(join(staging, f))) === e.sha256) reused++;
      else { await rm(join(staging, f), { force: true }); removed++; }
    }
    if (reused || removed) log(`önceki denemeden ${reused} dosya yeniden kullanıldı, ${removed} dosya silindi`);
    const work = await mkdtemp(join(tmpdir(), 'gh-restore-'));
    try {
      let n = 0;
      for (const e of m.evidence) {
        const dst = join(staging, e.key);
        try { if ((await shaFile(dst)) === e.sha256) continue; } catch { /* not staged yet */ }
        await mkdir(dirname(dst), { recursive: true });
        await o.target.get(e.object, join(work, 'e.enc'));
        // Decrypt to a temporary name, verify, then rename: a staged file is always complete.
        await decryptFile(o.key, e.object, join(work, 'e.enc'), dst + '.part');
        if ((await shaFile(dst + '.part')) !== e.sha256) throw new Error(`Kanıt dosyası özeti tutmuyor: ${e.key}`);
        await rename(dst + '.part', dst);
        if (++n === Math.ceil(m.evidence.length / 2)) crash('mid_staging');
      }
      for (const f of await listFiles(staging)) if (f.endsWith('.part')) await rm(join(staging, f), { force: true });
      await setPhase('staged');
      crash('staged');

      // 2. Database, one transaction.
      await o.target.get(m.dump.object, join(work, 'd.enc'));
      await decryptFile(o.key, m.dump.object, join(work, 'd.enc'), join(work, 'd'));
      if ((await shaFile(join(work, 'd'))) !== m.dump.sha256) throw new Error('Döküm özeti tutmuyor.');
      await run('pg_restore', ['--no-owner', '--exit-on-error', '--single-transaction', '--dbname', o.targetOwnerUrl, join(work, 'd')], { maxBuffer: 64 * 1024 * 1024 });
      await setPhase('db_committed');
      crash('db_committed');
    } finally { await rm(work, { recursive: true, force: true }); }
  }

  // 3. Files into place with one rename.
  if ((journal as Journal | null)?.phase === 'db_committed') {
    try { await rmdir(o.targetEvidenceDir); } catch { /* absent, or not empty (checked below) */ }
    if ((await listFiles(o.targetEvidenceDir)).length) return { ok: false, checks: [{ name: 'hedef kanıt klasörü boş', ok: false, detail: 'veritabanı geri yüklendi ama kanıt klasörüne başka dosya konmuş; elle incele' }] };
    await mkdir(dirname(o.targetEvidenceDir), { recursive: true });
    await rename(staging, o.targetEvidenceDir);
    await setPhase('files_in_place');
    crash('files_in_place');
  }

  // 4. Final checks.
  const after = await checkRestored({ ownerUrl: o.targetOwnerUrl, evidenceDir: o.targetEvidenceDir, manifest: m, strict: true });
  if (after.ok) await rm(journalPath, { force: true });
  return { ok: after.ok, checks: [...v.checks, ...after.checks] };
}

/** Which backups to keep: every backup of the last `hourly` hours, then the newest one per day for `daily` days. */
export function selectToKeep(ids: string[], now: Date, keep: { hourly: number; daily: number }): Set<string> {
  const ts = (id: string) => Date.parse(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`);
  const out = new Set<string>();
  const days = new Map<string, string>();
  for (const id of [...ids].sort()) {
    const age = now.getTime() - ts(id);
    if (age <= keep.hourly * 3_600_000) out.add(id);
    if (age <= keep.daily * 86_400_000) days.set(id.slice(0, 8), id);
  }
  for (const id of days.values()) out.add(id);
  if (ids.length) out.add([...ids].sort().at(-1)!);
  return out;
}

/** Removes database backups outside the retention window. Evidence objects are never removed here. */
export async function pruneBackups(target: BackupTarget, now: Date, keep: { hourly: number; daily: number }) {
  const ids = await listBackups(target);
  const keepSet = selectToKeep(ids, now, keep);
  const removed: string[] = [];
  for (const id of ids) {
    if (keepSet.has(id)) continue;
    // Manifest first, so a half-removed backup is never listed as complete.
    await target.remove(manifestObject(id));
    await target.remove(dumpObject(id));
    removed.push(id);
  }
  return removed;
}
