import { checkKey, checkRestored, createBackup, listBackups, restoreBackup, verifyBackup, type Report } from './backup';
import { loadBackupKey } from './crypto';
import { notifyAll, WebhookNotifier, type Notifier } from './notify';
import { DEFAULT_THRESHOLDS, runAgeWatch, runScheduledBackup, withLock } from './scheduled';
import { assertSeparate, DirTarget } from './target';

/*
 * Backup operations (run in server/, with the environment's variables):
 *   npm run backup                     one encrypted backup into BACKUP_TARGET_DIR
 *   npm run backup:list                backups in the target
 *   npm run backup:verify -- [id] [n]  decrypts and checks a backup (default: newest; all evidence)
 *   npm run backup:key-check -- [id]   recovered key matches the backups? (run before a restore)
 *   npm run restore -- [id]            into the EMPTY database/evidence dir of this environment; resumable
 *   npm run check:integrity            audit chains + evidence files of this environment
 *   npm run backup:scheduled           every 30 min: backup → verify → mark usable → prune → integrity
 *   npm run backup:watchdog            every 5 min, preferably elsewhere: age of the last usable backup
 */
const [cmd, a1, a2] = process.argv.slice(2);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} tanımlı değil`); return v; };
const print = (r: Report) => { for (const c of r.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`); console.log(r.ok ? 'SONUÇ: TAMAM' : 'SONUÇ: SORUN VAR'); process.exitCode = r.ok ? 0 : 1; };
const target = () => {
  const dir = env('BACKUP_TARGET_DIR');
  assertSeparate(dir, [process.env.EVIDENCE_DIR ?? './var/evidence', process.cwd()]);
  return new DirTarget(dir);
};
const key = () => loadBackupKey(process.env, [process.env.BACKUP_TARGET_DIR ?? '', process.env.EVIDENCE_DIR ?? '']);
const notifiers = (): Notifier[] => (process.env.ALERT_WEBHOOK_URL ? [new WebhookNotifier(process.env.ALERT_WEBHOOK_URL)] : []);
const newest = async () => { const ids = await listBackups(target()); if (!ids.length) throw new Error('Hedefte yedek yok.'); return ids.at(-1)!; };
const num = (k: string, d: number) => Number(process.env[k] ?? d);

if (cmd === 'backup') {
  const k = await key();
  // Same lock as the scheduled job: a manual backup never runs alongside pruning.
  const r = await withLock((process.env.BACKUP_STATUS_FILE ?? './var/backup-status.json') + '.lock', 2 * 3_600_000, async () => {
    const m = await createBackup({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR'), target: target(), key: k });
    console.log(`Yedek ${m.id} · döküm ${m.dump.size} bayt · ${m.evidence.length} kanıt · ${m.durationMs} ms`);
    print(await verifyBackup(target(), k, m.id, 20));
  });
  if (r === 'locked') { console.log('Başka bir yedekleme çalışıyor; daha sonra tekrar dene.'); process.exitCode = 1; }
} else if (cmd === 'list') {
  for (const id of await listBackups(target())) console.log(id);
} else if (cmd === 'verify') {
  const id = a1 || await newest();
  const r = await verifyBackup(target(), await key(), id, a2 ? Number(a2) : Infinity);
  print(r);
  if (!r.ok) await notifyAll(notifiers(), { kind: 'backup_failed', subject: 'Yedeğin tam doğrulaması başarısız', details: [`Yedek: ${id}`, ...r.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? `: ${c.detail}` : ''}`)] });
} else if (cmd === 'key-check') {
  print(await checkKey(target(), await key(), a1 || await newest()));
} else if (cmd === 'restore') {
  const t0 = Date.now();
  print(await restoreBackup({ target: target(), key: await key(), backupId: a1 || await newest(), targetOwnerUrl: env('DATABASE_OWNER_URL'), targetEvidenceDir: env('EVIDENCE_DIR'), log: m => console.log(m) }));
  console.log(`Süre: ${Math.round((Date.now() - t0) / 1000)} sn`);
} else if (cmd === 'integrity') {
  print(await checkRestored({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR') }));
} else if (cmd === 'scheduled') {
  const r = await runScheduledBackup({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR'), target: target(), key: await key(),
    statusFile: env('BACKUP_STATUS_FILE'), notifiers: notifiers(), deepSample: num('BACKUP_DEEP_SAMPLE', 20),
    keep: { hourly: num('BACKUP_KEEP_HOURS', 48), daily: num('BACKUP_KEEP_DAYS', 30) } });
  process.exitCode = r.ok ? 0 : 1;
} else if (cmd === 'watchdog') {
  // Needs only read access to the target; no database, no key.
  const r = await runAgeWatch({ target: new DirTarget(env('BACKUP_TARGET_DIR')), stateFile: env('BACKUP_WATCH_STATE_FILE'), notifiers: notifiers(),
    thresholds: { warnMinutes: num('BACKUP_AGE_WARN_MINUTES', DEFAULT_THRESHOLDS.warnMinutes), criticalMinutes: num('BACKUP_AGE_CRITICAL_MINUTES', DEFAULT_THRESHOLDS.criticalMinutes), rpoMinutes: num('BACKUP_RPO_MINUTES', DEFAULT_THRESHOLDS.rpoMinutes) } });
  console.log(`son kullanılabilir yedeğin yaşı: ${Number.isFinite(r.ageMinutes) ? Math.round(r.ageMinutes) + ' dk' : 'bilinmiyor'} · düzey: ${r.level}${r.alerted ? ` · bildirim: ${r.alerted}` : ''}`);
  process.exitCode = r.level === 'ok' ? 0 : 1;
} else {
  console.error('Kullanım: backup | list | verify [id] [n] | key-check [id] | restore [id] | integrity | scheduled | watchdog');
  process.exitCode = 2;
}
