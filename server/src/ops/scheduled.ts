import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkRestored, createBackup, pruneBackups, verifyBackup, type Manifest } from './backup';
import { notifyAll, redact, type Notifier } from './notify';
import type { BackupTarget } from './target';

/*
 * The jobs a scheduler (cron / systemd timer) runs:
 *   hourly:      runScheduledBackup  – backup → verify → prune → integrity check
 *   every 15 min (preferably from another machine): runWatchdog – alerts when
 *                the last successful backup is older than the RPO target.
 * Every failure produces an alert. The status file records the last success.
 */
export type BackupStatus = { lastSuccessAt: string | null; lastBackupId: string | null; lastErrorAt: string | null; lastError: string | null; lastDurationMs: number | null };

export async function readStatus(path: string): Promise<BackupStatus> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return { lastSuccessAt: null, lastBackupId: null, lastErrorAt: null, lastError: null, lastDurationMs: null }; }
}
async function writeStatus(path: string, s: BackupStatus) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(s, null, 2));
  await rename(path + '.tmp', path);
}

export type ScheduledOptions = {
  ownerUrl: string; evidenceDir: string; target: BackupTarget; key: Buffer;
  statusFile: string; notifiers: Notifier[];
  keep?: { hourly: number; daily: number };
  /** Evidence objects decrypted and compared on every run (a rotating sample). */
  deepSample?: number;
  now?: () => Date;
  log?: (m: string) => void;
};

export async function runScheduledBackup(o: ScheduledOptions): Promise<{ ok: boolean; manifest?: Manifest }> {
  const log = o.log ?? console.log;
  const now = o.now ?? (() => new Date());
  const status = await readStatus(o.statusFile);
  let manifest: Manifest | undefined;
  try {
    manifest = await createBackup({ ownerUrl: o.ownerUrl, evidenceDir: o.evidenceDir, target: o.target, key: o.key });
    const v = await verifyBackup(o.target, o.key, manifest.id, o.deepSample ?? 20);
    if (!v.ok) throw new Error(`Yedek doğrulanamadı: ${v.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}`);
    const removed = await pruneBackups(o.target, now(), o.keep ?? { hourly: 48, daily: 30 });
    await writeStatus(o.statusFile, { ...status, lastSuccessAt: now().toISOString(), lastBackupId: manifest.id, lastDurationMs: manifest.durationMs });
    log(`yedek tamam: ${manifest.id} · ${manifest.evidence.length} kanıt · ${manifest.durationMs} ms · silinen eski yedek: ${removed.length}`);
  } catch (e) {
    const msg = redact((e as Error).message);
    await writeStatus(o.statusFile, { ...status, lastErrorAt: now().toISOString(), lastError: msg });
    await notifyAll(o.notifiers, { kind: 'backup_failed', subject: 'Yedekleme başarısız', details: [msg, `Hedef: ${o.target.description}`, `Son başarılı yedek: ${status.lastSuccessAt ?? 'yok'}`] }, log);
    return { ok: false };
  }
  const integrity = await checkRestored({ ownerUrl: o.ownerUrl, evidenceDir: o.evidenceDir }).catch(e => ({ ok: false, checks: [{ name: 'bütünlük kontrolü çalışmadı', ok: false, detail: (e as Error).message }] }));
  if (!integrity.ok) {
    await notifyAll(o.notifiers, { kind: 'integrity_failed', subject: 'Bütünlük kontrolü başarısız', details: integrity.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? `: ${c.detail}` : ''}`) }, log);
    return { ok: false, manifest };
  }
  return { ok: true, manifest };
}

/** Alerts when no backup succeeded within `maxAgeMinutes` (the RPO target). */
export async function runWatchdog(o: { statusFile: string; maxAgeMinutes: number; notifiers: Notifier[]; now?: () => Date; log?: (m: string) => void }) {
  const s = await readStatus(o.statusFile);
  const now = (o.now ?? (() => new Date()))();
  const ageMin = s.lastSuccessAt ? (now.getTime() - Date.parse(s.lastSuccessAt)) / 60_000 : Infinity;
  if (ageMin <= o.maxAgeMinutes) return { ok: true, ageMinutes: ageMin };
  await notifyAll(o.notifiers, { kind: 'backup_stale', subject: `Son başarılı yedek ${Number.isFinite(ageMin) ? `${Math.round(ageMin)} dakika` : 'hiç alınmamış'} önce`,
    details: [`Hedef: en fazla ${o.maxAgeMinutes} dakika veri kaybı`, `Son hata: ${s.lastError ?? '—'}`] }, o.log);
  return { ok: false, ageMinutes: ageMin };
}
