import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/db/pool';
import { localDay } from '../../src/domain/schedule';
import { buildApp } from '../../src/http/app';
import { checkRestored, createBackup, evidenceObject, listBackups, pruneBackups, restoreBackup, selectToKeep, verifyBackup } from '../../src/ops/backup';
import { WebhookNotifier, type Alert } from '../../src/ops/notify';
import { readStatus, runScheduledBackup, runWatchdog } from '../../src/ops/scheduled';
import { assertSeparate, DirTarget } from '../../src/ops/target';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { DevOutboxMailer } from '../../src/services/mail';
import { LocalStore } from '../../src/storage/local';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Backups, format 2, against real PostgreSQL: encryption, a separate target,
 * snapshot consistency while people keep writing, interrupted restores,
 * retention, alerts. Needs TEST_RESTORE_DATABASE_OWNER_URL / TEST_RESTORE_DATABASE_URL
 * (a separate, throwaway database).
 */
const restoreDb = { owner: process.env.TEST_RESTORE_DATABASE_OWNER_URL!, app: process.env.TEST_RESTORE_DATABASE_URL! };
const sourceOwner = () => process.env.TEST_DATABASE_OWNER_URL!;
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let work: string;
let targetDir: string;
let target: DirTarget;
const key = randomBytes(32);
let tasks: string[] = [];
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const q = async (url: string, sql: string, args: unknown[] = []) => {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
};

async function emptyRestoreTarget(evidenceDir: string) {
  await q(restoreDb.owner, 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  for (const p of [evidenceDir, `${evidenceDir}.restore-staging`, `${evidenceDir}.restore-journal.json`]) await rm(p, { recursive: true, force: true });
}

let photoN = 0;
/** Registers a photo on a task; optionally uploads its bytes. */
async function photo(taskId: string, upload = true) {
  const img = fakeJpeg(`photo-${++photoN}-${Date.now()}`);
  const ev = (await owner().post(`${C()}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(img), sizeBytes: img.length })).body;
  if (upload) expect((await owner().put(`${C()}/evidence/${ev.id}/content`, img, 'image/jpeg')).status).toBe(200);
  return { id: ev.id as string, img };
}
async function fridgeCheck(taskId: string) {
  await owner().post(`${C()}/tasks/${taskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId });
  await photo(taskId);
  await owner().post(`${C()}/tasks/${taskId}/complete`, {});
}

beforeAll(async () => {
  if (!restoreDb.owner || !restoreDb.app) throw new Error('Set TEST_RESTORE_DATABASE_OWNER_URL and TEST_RESTORE_DATABASE_URL (see server/README.md).');
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  work = await mkdtemp(join(tmpdir(), 'gh-bk2-'));
  targetDir = join(work, 'uzak-hedef');
  target = new DirTarget(targetDir);
  const today = localDay(new Date(), 'Europe/Istanbul');
  await owner().post(`${C()}/tasks/generate`, { siteId: demo.siteId, fromDay: today, toDay: localDay(new Date(Date.now() + 20 * 86400_000), 'Europe/Istanbul') });
  tasks = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body.filter((t: any) => t.equipment_id === demo.fridgeId).map((t: any) => t.id);
  await fridgeCheck(tasks.shift()!);
  await fridgeCheck(tasks.shift()!);
});
afterAll(async () => { await env?.close(); if (work) await rm(work, { recursive: true, force: true }); });

describe('encrypted backups in a separate location', () => {
  it('only ciphertext reaches the target; wrong key, altered and swapped objects are rejected', async () => {
    const m = await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key });
    expect(m.evidence).toHaveLength(2);
    expect((await verifyBackup(target, key, m.id, Infinity)).ok).toBe(true);

    // No plaintext: neither the company name from the database nor photo bytes appear in any stored object.
    const files = [...(await readdir(join(targetDir, 'db'))).map(f => join(targetDir, 'db', f)), ...(await readdir(join(targetDir, 'evidence'))).map(f => join(targetDir, 'evidence', f))];
    const firstPhoto = (await readFile(join(env.evidenceDir, m.evidence[0]!.key)));
    for (const f of files) {
      const b = await readFile(f);
      expect(b.includes(Buffer.from('Kahve Durağı'))).toBe(false);
      expect(b.includes(firstPhoto.subarray(4))).toBe(false);
      expect(b.subarray(0, 4).toString()).toBe('GHBK');
    }

    expect((await verifyBackup(target, randomBytes(32), m.id)).checks[0]!.detail).toContain('başka bir anahtarla');

    // One flipped byte in an evidence object fails authentication.
    const obj = join(targetDir, m.evidence[0]!.object);
    const orig = await readFile(obj);
    const flipped = Buffer.from(orig); flipped[40] = flipped[40]! ^ 1;
    await writeFile(obj, flipped);
    expect((await verifyBackup(target, key, m.id, Infinity)).ok).toBe(false);
    // Putting another (valid) encrypted object in its place fails too: the name is authenticated.
    await writeFile(obj, await readFile(join(targetDir, m.evidence[1]!.object)));
    expect((await verifyBackup(target, key, m.id, Infinity)).ok).toBe(false);
    await writeFile(obj, orig);
    expect((await verifyBackup(target, key, m.id, Infinity)).ok).toBe(true);
  });

  it('an older manifest renamed as a newer backup is rejected (the object name is authenticated)', async () => {
    const a = await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key });
    await new Promise(r => setTimeout(r, 1100)); // backup ids have one-second resolution
    const b = await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key });
    const bPath = join(targetDir, 'db', `${b.id}.manifest.enc`);
    const bOrig = await readFile(bPath);
    await writeFile(bPath, await readFile(join(targetDir, 'db', `${a.id}.manifest.enc`)));
    const v = await verifyBackup(target, key, b.id);
    expect(v.ok).toBe(false);
    expect(v.manifest).toBeNull();
    await writeFile(bPath, bOrig);
    expect((await verifyBackup(target, key, b.id)).ok).toBe(true);
  });

  it('refuses a target inside the application data', () => {
    expect(() => assertSeparate(join(env.evidenceDir, 'yedek'), [env.evidenceDir])).toThrow('aynı yerde');
    expect(() => assertSeparate(targetDir, [env.evidenceDir])).not.toThrow();
  });

  it('evidence objects are uploaded once; later backups add only new files', async () => {
    const before = (await readdir(join(targetDir, 'evidence'))).length;
    await fridgeCheck(tasks.shift()!);
    const m = await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key });
    expect(m.evidence).toHaveLength(3);
    expect((await readdir(join(targetDir, 'evidence'))).length).toBe(before + 1);
  });
});

describe('1 · backup while people keep recording tasks and uploading photos', () => {
  it('the database and the evidence files in a backup belong to the same moment', async () => {
    const pendingBefore = await photo(tasks.shift()!, false); // registered, bytes not yet sent
    const during: { id: string; img: Buffer }[] = [];
    let stop = false;
    let background = 0;
    // Writes that keep coming the whole time.
    const writer = (async () => {
      while (!stop) { const t = tasks.shift(); if (!t) break; await fridgeCheck(t); background++; }
    })();
    const m = await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key,
      // Deterministic writes after the snapshot and before pg_dump/file copying start.
      afterSnapshot: async () => {
        during.push(await photo(tasks.shift()!));
        expect((await owner().put(`${C()}/evidence/${pendingBefore.id}/content`, pendingBefore.img, 'image/jpeg')).status).toBe(200);
      } });
    stop = true; await writer;
    expect(background).toBeGreaterThan(0);

    const evDir = join(work, 'r-concurrent');
    await emptyRestoreTarget(evDir);
    const r = await restoreBackup({ target, key, backupId: m.id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: evDir });
    expect(r.checks.filter(c => !c.ok)).toEqual([]);

    // Exactly the snapshot: stored rows and files are the same set, nothing more.
    const stored = (await q(restoreDb.owner, `SELECT id, storage_key FROM evidence WHERE status = 'stored'`)).map(r => r.storage_key).sort();
    const files: string[] = [];
    for (const c of await readdir(evDir)) for (const f of await readdir(join(evDir, c))) files.push(`${c}/${f}`);
    expect(files.sort()).toEqual(stored);
    expect(stored).toEqual(m.evidence.map(e => e.key).sort());
    // Written after the snapshot: absent from the restored system, row and file.
    for (const d of during) expect(await q(restoreDb.owner, `SELECT 1 FROM evidence WHERE id = $1`, [d.id])).toEqual([]);
    // In flight at the snapshot: still waiting for its bytes after restore, and the phone's retry completes it.
    expect(await q(restoreDb.owner, `SELECT status FROM evidence WHERE id = $1`, [pendingBefore.id])).toEqual([{ status: 'pending_upload' }]);
    const db = Db.connect(restoreDb.app);
    const app = buildApp({ db, store: new LocalStore(evDir), mailer: new DevOutboxMailer(db),
      config: { demoMode: true, allowExampleRules: true, maxUploadBytes: 15 * 1024 * 1024, mfaEncryptionKey: Buffer.alloc(32, 7).toString('base64'), mfaRequiredForPlatform: false } });
    try {
      const restored = client({ ...env, app } as Env, demo.users.owner.token);
      expect((await restored.put(`${C()}/evidence/${pendingBefore.id}/content`, pendingBefore.img, 'image/jpeg')).status).toBe(200);
      expect((await restored.get(`${C()}/audit-chain/verify`)).body).toMatchObject({ ok: true });
    } finally { await app.close(); await db.close(); }
  });

  it('a retried upload whose file was written but not recorded succeeds; different bytes are refused', async () => {
    const t = tasks.shift()!;
    const a = await photo(t, false);
    // Simulate a crash after the file write and before the database update.
    await mkdir(join(env.evidenceDir, demo.companyId), { recursive: true });
    await writeFile(join(env.evidenceDir, demo.companyId, a.id), a.img);
    expect((await owner().put(`${C()}/evidence/${a.id}/content`, a.img, 'image/jpeg')).status).toBe(200);
    const b = await photo(t, false);
    await writeFile(join(env.evidenceDir, demo.companyId, b.id), fakeJpeg('başka içerik'));
    const r = await owner().put(`${C()}/evidence/${b.id}/content`, b.img, 'image/jpeg');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EVIDENCE_FILE_CONFLICT');
    await unlink(join(env.evidenceDir, demo.companyId, b.id));
  });
});

describe('2 · interrupted restores: the database is one transaction, the files are not', () => {
  let id: string;
  beforeAll(async () => { id = (await createBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key })).id; });
  const tables = async () => (await q(restoreDb.owner, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`))[0].n;
  const journal = async (d: string) => JSON.parse(await readFile(`${d}.restore-journal.json`, 'utf8'));
  const count = async (d: string) => { let n = 0; try { for (const c of await readdir(d)) n += (await readdir(join(d, c))).length; } catch { /* none */ } return n; };

  it('cut while files are being staged: database untouched; the rerun reuses verified files and drops a damaged one', async () => {
    const d = join(work, 'r-mid');
    await emptyRestoreTarget(d);
    await expect(restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, crashAt: 'mid_staging' })).rejects.toThrow('yapay kesinti');
    expect(await tables()).toBe(0);
    expect(await journal(d)).toMatchObject({ phase: 'staging' });
    const staged = await count(`${d}.restore-staging`);
    expect(staged).toBeGreaterThan(1);
    // Damage one staged file, as a power cut during a write could.
    const c = (await readdir(`${d}.restore-staging`))[0]!;
    const f = (await readdir(join(`${d}.restore-staging`, c)))[0]!;
    await writeFile(join(`${d}.restore-staging`, c, f), Buffer.from('yarım'));
    const logs: string[] = [];
    const r = await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, log: m => logs.push(m) });
    expect(r.checks.filter(x => !x.ok)).toEqual([]);
    expect(logs.join('\n')).toContain(`${staged - 1} dosya yeniden kullanıldı, 1 dosya silindi`);
    await expect(readFile(`${d}.restore-journal.json`)).rejects.toThrow();
    await expect(readdir(`${d}.restore-staging`)).rejects.toThrow();
  });

  it('cut after the database commit: files are moved into place on the rerun', async () => {
    const d = join(work, 'r-afterdb');
    await emptyRestoreTarget(d);
    await expect(restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, crashAt: 'db_committed' })).rejects.toThrow();
    expect(await tables()).toBeGreaterThan(0);
    expect(await count(d)).toBe(0);
    // The integrity check sees the half state for what it is.
    expect((await checkRestored({ ownerUrl: restoreDb.owner, evidenceDir: d })).ok).toBe(false);
    const r = await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d });
    expect(r.ok).toBe(true);
  });

  it('cut between the database commit and the journal update: detected by comparing with the backup', async () => {
    const d = join(work, 'r-gap');
    await emptyRestoreTarget(d);
    await expect(restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, crashAt: 'db_committed' })).rejects.toThrow();
    await writeFile(`${d}.restore-journal.json`, JSON.stringify({ backupId: id, phase: 'staged' }));
    expect((await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d })).ok).toBe(true);
  });

  it('cut after the files moved: the rerun only runs the final checks', async () => {
    const d = join(work, 'r-final');
    await emptyRestoreTarget(d);
    await expect(restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, crashAt: 'files_in_place' })).rejects.toThrow();
    expect((await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d })).ok).toBe(true);
  });

  it('a database restore that fails inside its transaction leaves no table behind, and the rerun completes', async () => {
    const d = join(work, 'r-dbfail');
    await emptyRestoreTarget(d);
    // A function the dump also creates (not a table, so the "empty" check passes): pg_restore fails part-way.
    await q(restoreDb.owner, `CREATE FUNCTION public.demo_reset() RETURNS void LANGUAGE sql AS 'SELECT 1'`);
    await expect(restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d })).rejects.toThrow();
    expect(await tables()).toBe(0);
    expect(await journal(d)).toMatchObject({ phase: 'staged' });
    expect(await count(d)).toBe(0);
    await q(restoreDb.owner, `DROP FUNCTION public.demo_reset()`);
    const logs: string[] = [];
    expect((await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d, log: m => logs.push(m) })).ok).toBe(true);
    expect(logs.join('\n')).toMatch(/\d+ dosya yeniden kullanıldı, 0 dosya silindi/);
  });

  it('refuses a non-empty target and a different half-finished restore', async () => {
    const d = join(work, 'r-final');
    const r = await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d });
    expect(r.checks[0]!.name).toBe('hedef veritabanı boş');
    await writeFile(`${d}.restore-journal.json`, JSON.stringify({ backupId: 'baska', phase: 'staging' }));
    expect((await restoreBackup({ target, key, backupId: id, targetOwnerUrl: restoreDb.owner, targetEvidenceDir: d })).checks[0]!.name).toBe('yarım kalmış başka geri yükleme');
    await rm(`${d}.restore-journal.json`);
  });
});

describe('retention', () => {
  it('keeps every backup of the last 48 hours and one per day for 30 days', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const ids: string[] = [];
    for (let h = 0; h < 24 * 40; h++) ids.push(new Date(now.getTime() - h * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
    const keep = selectToKeep(ids, now, { hourly: 48, daily: 30 });
    expect(keep.size).toBeGreaterThanOrEqual(48 + 28);
    expect(keep.size).toBeLessThanOrEqual(49 + 31);
    expect(keep.has(ids.at(-1)!)).toBe(false);
  });

  it('prunes only old database backups; evidence objects stay', async () => {
    const ev = (await readdir(join(targetDir, 'evidence'))).length;
    const ids = await listBackups(target);
    const removed = await pruneBackups(target, new Date(Date.now() + 90 * 86_400_000), { hourly: 48, daily: 30 });
    expect(removed.length).toBe(ids.length - 1);
    expect(await listBackups(target)).toEqual([ids.at(-1)]);
    expect((await readdir(join(targetDir, 'evidence'))).length).toBe(ev);
  });
});

describe('alerts', () => {
  let server: Server;
  const alerts: Alert[] = [];
  let hook: WebhookNotifier;
  const statusFile = () => join(work, 'durum', 'backup-status.json');
  beforeAll(async () => {
    server = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { alerts.push(JSON.parse(b)); res.end('ok'); }); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    hook = new WebhookNotifier(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`);
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('a successful hourly run records the time and sends nothing', async () => {
    alerts.length = 0;
    const r = await runScheduledBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key, statusFile: statusFile(), notifiers: [hook], log: () => {} });
    expect(r.ok).toBe(true);
    expect(alerts).toEqual([]);
    expect((await readStatus(statusFile())).lastBackupId).toBe(r.manifest!.id);
  });

  it('a failed backup sends an alert without the database password', async () => {
    alerts.length = 0;
    const bad = sourceOwner().replace(/:[^:@/]+@/, ':gizli-parola-123@');
    const r = await runScheduledBackup({ ownerUrl: bad, evidenceDir: env.evidenceDir, target, key, statusFile: statusFile(), notifiers: [hook], log: () => {} });
    expect(r.ok).toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'backup_failed', subject: 'Yedekleme başarısız' });
    expect(JSON.stringify(alerts[0])).not.toContain('gizli-parola-123');
    expect((await readStatus(statusFile())).lastError).toBeTruthy();
  });

  it('a failed integrity check sends an alert', async () => {
    alerts.length = 0;
    const row = (await q(sourceOwner(), `SELECT storage_key FROM evidence WHERE status = 'stored' LIMIT 1`))[0];
    const p = join(env.evidenceDir, row.storage_key);
    const bytes = await readFile(p);
    await unlink(p);
    try {
      const r = await runScheduledBackup({ ownerUrl: sourceOwner(), evidenceDir: env.evidenceDir, target, key, statusFile: statusFile(), notifiers: [hook], log: () => {} });
      expect(r.ok).toBe(false);
      expect(alerts.map(a => a.kind)).toEqual(['integrity_failed']);
      expect(alerts[0]!.details.join(' ')).toContain('dosya yok');
    } finally { await writeFile(p, bytes); }
  });

  it('the watchdog alerts when the last success is older than the target', async () => {
    alerts.length = 0;
    const later = (min: number) => () => new Date(Date.now() + min * 60_000);
    expect((await runWatchdog({ statusFile: statusFile(), maxAgeMinutes: 75, notifiers: [hook], now: later(30) })).ok).toBe(true);
    expect((await runWatchdog({ statusFile: statusFile(), maxAgeMinutes: 75, notifiers: [hook], now: later(120), log: () => {} })).ok).toBe(false);
    expect(alerts.map(a => a.kind)).toEqual(['backup_stale']);
    expect((await runWatchdog({ statusFile: join(work, 'yok.json'), maxAgeMinutes: 75, notifiers: [hook], log: () => {} })).ok).toBe(false);
  });
});

describe('command line, as separate processes', () => {
  it('backup → verify → restore → integrity', async () => {
    const sh = promisify(execFile);
    const cli = (args: string[], e: Record<string, string>) => sh('npx', ['tsx', 'src/ops/cli.ts', ...args], { cwd: process.cwd(), env: { ...process.env, ...e } })
      .then(r => ({ code: 0, out: r.stdout }), (err: any) => ({ code: err.code as number, out: `${err.stdout}${err.stderr}` }));
    const common = { BACKUP_TARGET_DIR: join(work, 'cli-hedef'), BACKUP_ENCRYPTION_KEY: key.toString('base64') };
    const src = { ...common, DATABASE_OWNER_URL: sourceOwner(), EVIDENCE_DIR: env.evidenceDir };
    const b = await cli(['backup'], src);
    expect(b.out).toContain('SONUÇ: TAMAM');
    expect((await cli(['verify'], src)).code).toBe(0);
    expect((await cli(['integrity'], src)).out).toContain('SONUÇ: TAMAM');
    const d = join(work, 'r-cli');
    await emptyRestoreTarget(d);
    const r = await cli(['restore'], { ...common, DATABASE_OWNER_URL: restoreDb.owner, EVIDENCE_DIR: d });
    expect(r.out).not.toContain('✗');
    expect(r.code).toBe(0);
    expect((await cli(['backup'], { ...src, BACKUP_ENCRYPTION_KEY: '' })).out).toContain('BACKUP_ENCRYPTION_KEY');
  }, 120_000);
});

it('evidence object names do not reveal storage keys', () => {
  expect(evidenceObject('company/evidence-id')).toMatch(/^evidence\/[0-9a-f]{64}\.enc$/);
});
