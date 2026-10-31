import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/db/pool';
import { localDay } from '../../src/domain/schedule';
import { buildApp } from '../../src/http/app';
import { checkRestored, createBackup, restoreBackup, verifyBackup } from '../../src/ops/backup';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { DevOutboxMailer } from '../../src/services/mail';
import { LocalStore } from '../../src/storage/local';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Restore drill, automated: real data with stored evidence → backup → restore
 * into a second, empty database and evidence directory → the restored system
 * answers the same and its chains and files verify. Plus the refusals.
 * Needs TEST_RESTORE_DATABASE_OWNER_URL / TEST_RESTORE_DATABASE_URL (a separate, throwaway database).
 */
const target = { owner: process.env.TEST_RESTORE_DATABASE_OWNER_URL!, app: process.env.TEST_RESTORE_DATABASE_URL! };
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let work: string;
let taskId: string;
const C = () => `/companies/${demo.companyId}`;

async function emptyTarget() {
  const c = new pg.Client({ connectionString: target.owner });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

beforeAll(async () => {
  if (!target.owner || !target.app) throw new Error('Set TEST_RESTORE_DATABASE_OWNER_URL and TEST_RESTORE_DATABASE_URL (see server/README.md).');
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  work = await mkdtemp(join(tmpdir(), 'gh-restore-'));
  // Real activity: a fridge check with a stored photo.
  const owner = client(env, demo.users.owner.token);
  const day = localDay(new Date(), 'Europe/Istanbul');
  await owner.post(`${C()}/tasks/generate`, { siteId: demo.siteId, fromDay: day, toDay: day });
  taskId = (await owner.get(`${C()}/tasks?siteId=${demo.siteId}`)).body.find((t: any) => t.equipment_id === demo.fridgeId).id;
  await owner.post(`${C()}/tasks/${taskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId });
  const img = fakeJpeg('restore-drill');
  const ev = (await owner.post(`${C()}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(img).digest('hex'), sizeBytes: img.length })).body;
  expect((await owner.put(`${C()}/evidence/${ev.id}/content`, img, 'image/jpeg')).status).toBe(200);
  expect((await owner.post(`${C()}/tasks/${taskId}/complete`, {})).status).toBe(200);
});
afterAll(async () => { await env?.close(); if (work) await rm(work, { recursive: true, force: true }); });

describe('restore drill', () => {
  it('backs up, restores into an empty system, and the restored system answers the same', async () => {
    const dir = join(work, 'yedek-1');
    const m = await createBackup({ ownerUrl: process.env.TEST_DATABASE_OWNER_URL!, evidenceDir: env.evidenceDir, outDir: dir });
    expect(m.evidence).toHaveLength(1);
    expect(m.missingAtBackup).toEqual([]);
    expect((await verifyBackup(dir)).ok).toBe(true);

    await emptyTarget();
    const restoredFiles = join(work, 'kanit-geri');
    const r = await restoreBackup({ dir, targetOwnerUrl: target.owner, targetEvidenceDir: restoredFiles });
    expect(r.checks.filter(c => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);

    // A second API instance on the restored database serves the same records to the same session.
    const db = Db.connect(target.app);
    const app = buildApp({ db, store: new LocalStore(restoredFiles), mailer: new DevOutboxMailer(db),
      config: { demoMode: true, allowExampleRules: true, maxUploadBytes: 15 * 1024 * 1024, mfaEncryptionKey: Buffer.alloc(32, 7).toString('base64'), mfaRequiredForPlatform: false } });
    try {
      const restored = { ...env, app } as Env;
      const a = await client(env, demo.users.owner.token).get(`${C()}/tasks/${taskId}`);
      const b = await client(restored, demo.users.owner.token).get(`${C()}/tasks/${taskId}`);
      expect(b.status).toBe(200);
      expect(b.body).toEqual(a.body);
      expect((await client(restored, demo.users.owner.token).get(`${C()}/audit-chain/verify`)).body).toMatchObject({ ok: true });
      // Isolation still holds after restore: the staff member does not see the owner's company-wide data.
      expect((await client(restored, demo.users.staff.token).get(`${C()}/members`)).status).toBe(403);
    } finally { await app.close(); await db.close(); }
  });

  it('refuses a backup whose evidence file or database dump was changed, and leaves the target untouched', async () => {
    const dir = join(work, 'yedek-2');
    const m = await createBackup({ ownerUrl: process.env.TEST_DATABASE_OWNER_URL!, evidenceDir: env.evidenceDir, outDir: dir });
    await writeFile(join(dir, 'evidence', m.evidence[0]!.key), Buffer.from('değiştirildi'));
    await emptyTarget();
    const r = await restoreBackup({ dir, targetOwnerUrl: target.owner, targetEvidenceDir: join(work, 'bos-1') });
    expect(r.ok).toBe(false);
    expect(r.checks[0]!.name).toContain('geri yükleme başlamadı');
    const c = new pg.Client({ connectionString: target.owner }); await c.connect();
    expect((await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n).toBe(0);
    await c.end();

    const dir3 = join(work, 'yedek-3');
    await createBackup({ ownerUrl: process.env.TEST_DATABASE_OWNER_URL!, evidenceDir: env.evidenceDir, outDir: dir3 });
    await writeFile(join(dir3, 'database.dump'), Buffer.from('bozuk'), { flag: 'a' });
    expect((await verifyBackup(dir3)).checks.find(x => x.name === 'veritabanı dökümü')!.ok).toBe(false);
  });

  it('refuses a non-empty target and a non-empty backup folder', async () => {
    const dir = join(work, 'yedek-4');
    await createBackup({ ownerUrl: process.env.TEST_DATABASE_OWNER_URL!, evidenceDir: env.evidenceDir, outDir: dir });
    await emptyTarget();
    expect((await restoreBackup({ dir, targetOwnerUrl: target.owner, targetEvidenceDir: join(work, 'kanit-4') })).ok).toBe(true);
    const again = await restoreBackup({ dir, targetOwnerUrl: target.owner, targetEvidenceDir: join(work, 'kanit-4b') });
    expect(again.ok).toBe(false);
    expect(again.checks[0]!.name).toBe('hedef veritabanı boş');
    await expect(createBackup({ ownerUrl: process.env.TEST_DATABASE_OWNER_URL!, evidenceDir: env.evidenceDir, outDir: dir })).rejects.toThrow('boş değil');
  });

  it('the integrity check notices a missing evidence file in a running system', async () => {
    const files = join(work, 'kanit-4');
    expect((await checkRestored({ ownerUrl: target.owner, evidenceDir: files })).ok).toBe(true);
    const company = (await readdir(files))[0]!;
    const f = (await readdir(join(files, company)))[0]!;
    await unlink(join(files, company, f));
    const r = await checkRestored({ ownerUrl: target.owner, evidenceDir: files });
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.name.startsWith('kayıtlı kanıtların'))!.detail).toContain('dosya yok');
  });

  it('the command-line tools work as separate processes (backup → verify → restore → integrity)', async () => {
    // Run exactly as an operator would, so nothing depends on modules this test process already loaded.
    const sh = promisify(execFile);
    const cli = (args: string[], e: Record<string, string>) => sh('npx', ['tsx', 'src/ops/cli.ts', ...args], { cwd: process.cwd(), env: { ...process.env, ...e } })
      .then(r => ({ code: 0, out: r.stdout }), (err: any) => ({ code: err.code as number, out: String(err.stdout) }));
    const dir = join(work, 'yedek-cli');
    const src = { DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL!, EVIDENCE_DIR: env.evidenceDir };
    const b = await cli(['backup', dir], src);
    expect(b.out).toContain('SONUÇ: TAMAM');
    expect(b.code).toBe(0);
    expect((await cli(['integrity'], src)).out).toContain('SONUÇ: TAMAM');
    await emptyTarget();
    const dst = { DATABASE_OWNER_URL: target.owner, EVIDENCE_DIR: join(work, 'kanit-cli') };
    const r = await cli(['restore', dir], dst);
    expect(r.out).not.toContain('✗');
    expect(r.code).toBe(0);
    const i = await cli(['integrity'], dst);
    expect(i.out).toMatch(/✓ denetim zincirleri \(\d+ zincir, \d+ olay\)/);
    expect(i.code).toBe(0);
  }, 120_000);
});

