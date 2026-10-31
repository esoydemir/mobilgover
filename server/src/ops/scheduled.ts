import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkRestored, createBackup, pruneBackups, pruneEvidence, readHead, verifyBackup, writeHead, type Manifest } from './backup';
import { notifyAll, redact, type Alert, type Notifier } from './notify';
import type { BackupTarget } from './target';

/*
 * Jobs for a scheduler (cron / systemd timer):
 *   every 30 min: runScheduledBackup – backup → verify → mark as usable in the
 *                 target → prune old backups and unreferenced evidence → integrity check
 *   every 5 min, preferably on another machine: runAgeWatch – reads the marker
 *                 from the target and alerts in steps before the RPO is at risk.
 */
export type BackupStatus = { lastSuccessAt: string | null; lastBackupId: string | null; lastErrorAt: string | null; lastError: string | null; lastDurationMs: number | null };

export async function readStatus(path: string): Promise<BackupStatus> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return { lastSuccessAt: null, lastBackupId: null, lastErrorAt: null, lastError: null, lastDurationMs: null }; }
}
async function writeJson(path: string, v: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(v, null, 2));
  await rename(path + '.tmp', path);
}

/** One run at a time. A lock older than `staleMs` (crashed run) is taken over. */
async function withLock<T>(path: string, staleMs: number, fn: () => Promise<T>): Promise<T | 'locked'> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const fh = await open(path, 'wx'); await fh.writeFile(String(process.pid)); await fh.close();
  } catch {
    const age = Date.now() - (await stat(path)).mtimeMs;
    if (age < staleMs) return 'locked';
    await rm(path, { force: true });
    return withLock(path, staleMs, fn);
  }
  try { return await fn(); } finally { await rm(path, { force: true }); }
}

export type ScheduledOptions = {
  ownerUrl: string; evidenceDir: string; target: BackupTarget; key: Buffer;
  statusFile: string; notifiers: Notifier[];
  /** Every backup of the last `hourly` hours, one per day for `daily` days. */
  keep?: { hourly: number; daily: number };
  deepSample?: number;
  now?: () => Date;
  log?: (m: string) => void;
};

export async function runScheduledBackup(o: ScheduledOptions): Promise<{ ok: boolean; manifest?: Manifest; locked?: boolean }> {
  const log = o.log ?? console.log;
  const now = o.now ?? (() => new Date());
  const r = await withLock(o.statusFile + '.lock', 2 * 3_600_000, async () => {
    const status = await readStatus(o.statusFile);
    let manifest: Manifest | undefined;
    try {
      manifest = await createBackup({ ownerUrl: o.ownerUrl, evidenceDir: o.evidenceDir, target: o.target, key: o.key });
      const v = await verifyBackup(o.target, o.key, manifest.id, o.deepSample ?? 20);
      if (!v.ok) throw new Error(`Yedek doğrulanamadı: ${v.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}`);
      // Only now is it usable: the watchdog measures from this marker in the target.
      await writeHead(o.target, manifest, now());
      const removed = await pruneBackups(o.target, now(), o.keep ?? { hourly: 48, daily: 30 });
      const removedEvidence = await pruneEvidence(o.target, o.key);
      await writeJson(o.statusFile, { ...status, lastSuccessAt: now().toISOString(), lastBackupId: manifest.id, lastDurationMs: manifest.durationMs });
      log(`yedek tamam: ${manifest.id} · ${manifest.evidence.length} kanıt · ${manifest.durationMs} ms · silinen eski yedek: ${removed.length} · kullanılmayan kanıt nesnesi: ${removedEvidence.length}`);
    } catch (e) {
      const msg = redact((e as Error).message);
      await writeJson(o.statusFile, { ...status, lastErrorAt: now().toISOString(), lastError: msg });
      await notifyAll(o.notifiers, { kind: 'backup_failed', subject: 'Yedekleme başarısız', details: [msg, `Hedef: ${o.target.description}`, `Son başarılı yedek: ${status.lastSuccessAt ?? 'yok'}`] }, log);
      return { ok: false };
    }
    const integrity = await checkRestored({ ownerUrl: o.ownerUrl, evidenceDir: o.evidenceDir }).catch(e => ({ ok: false, checks: [{ name: 'bütünlük kontrolü çalışmadı', ok: false, detail: (e as Error).message }] }));
    if (!integrity.ok) {
      await notifyAll(o.notifiers, { kind: 'integrity_failed', subject: 'Bütünlük kontrolü başarısız', details: integrity.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? `: ${c.detail}` : ''}`) }, log);
      return { ok: false, manifest };
    }
    return { ok: true, manifest };
  });
  if (r === 'locked') {
    log('önceki yedekleme hâlâ çalışıyor; bu çalıştırma atlandı');
    return { ok: true, locked: true };
  }
  return r;
}

export type AgeLevel = 'ok' | 'warning' | 'critical' | 'breach';
export type AgeThresholds = { warnMinutes: number; criticalMinutes: number; rpoMinutes: number };
export const DEFAULT_THRESHOLDS: AgeThresholds = { warnMinutes: 40, criticalMinutes: 50, rpoMinutes: 60 };
const RANK: Record<AgeLevel, number> = { ok: 0, warning: 1, critical: 2, breach: 3 };

export function ageLevel(ageMin: number, t: AgeThresholds): AgeLevel {
  if (ageMin >= t.rpoMinutes) return 'breach';
  if (ageMin >= t.criticalMinutes) return 'critical';
  if (ageMin >= t.warnMinutes) return 'warning';
  return 'ok';
}

/**
 * Watches the age of the newest backup that reached the separate location and
 * passed verification — measured from the moment its snapshot was taken, which
 * is exactly how much data would be lost if the server failed now.
 * Alerts when the level rises, repeats at critical/breach every `repeatMinutes`,
 * and sends one notice when it recovers.
 */
export async function runAgeWatch(o: {
  target: BackupTarget; stateFile: string; notifiers: Notifier[]; thresholds?: AgeThresholds; repeatMinutes?: number;
  now?: () => Date; log?: (m: string) => void;
}) {
  const t = o.thresholds ?? DEFAULT_THRESHOLDS;
  const now = (o.now ?? (() => new Date()))();
  const head = await readHead(o.target).catch(() => null);
  // A marker whose manifest is gone is not a usable backup.
  const usable = head && (await o.target.exists(`db/${head.backupId}.manifest.enc`).catch(() => false)) ? head : null;
  const ageMin = usable ? (now.getTime() - Date.parse(usable.snapshotAt)) / 60_000 : Infinity;
  const level = ageLevel(ageMin, t);
  let prev: { level: AgeLevel; notifiedAt: string | null } = { level: 'ok', notifiedAt: null };
  try { prev = JSON.parse(await readFile(o.stateFile, 'utf8')); } catch { /* first run */ }

  const repeatDue = prev.notifiedAt !== null && now.getTime() - Date.parse(prev.notifiedAt) >= (o.repeatMinutes ?? 60) * 60_000;
  let alert: Alert | null = null;
  const age = Number.isFinite(ageMin) ? `${Math.round(ageMin)} dakika` : 'bilinmiyor (hedefte doğrulanmış yedek yok)';
  const details = [`Ayrı konumdaki son kullanılabilir yedeğin yaşı: ${age}`, `Eşikler: uyarı ${t.warnMinutes} dk · kritik ${t.criticalMinutes} dk · hedef ${t.rpoMinutes} dk`,
    usable ? `Yedek: ${usable.backupId} · doğrulandı ${usable.verifiedAt}` : 'Hedefte doğrulanmış yedek işareti yok', `Konum: ${o.target.description}`];
  if (RANK[level] > RANK[prev.level] || (RANK[level] >= RANK.critical && repeatDue)) {
    const kind = level === 'warning' ? 'backup_age_warning' : level === 'critical' ? 'backup_age_critical' : 'backup_rpo_breached';
    const subject = level === 'warning' ? `Yedek gecikiyor (${age})` : level === 'critical' ? `Bir saatlik veri kaybı hedefi tehlikede (${age})` : `Bir saatlik veri kaybı hedefi aşıldı (${age})`;
    alert = { kind, subject, details };
  } else if (level === 'ok' && prev.level !== 'ok') {
    alert = { kind: 'backup_recovered', subject: `Yedekler yeniden güncel (${age})`, details };
  }
  if (alert) await notifyAll(o.notifiers, alert, o.log);
  await writeJson(o.stateFile, { level, notifiedAt: alert ? now.toISOString() : prev.notifiedAt, ageMinutes: Number.isFinite(ageMin) ? Math.round(ageMin) : null });
  return { level, ageMinutes: ageMin, alerted: alert?.kind ?? null };
}
