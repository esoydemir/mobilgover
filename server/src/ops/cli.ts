import { checkRestored, createBackup, listBackups, restoreBackup, verifyBackup, type Report } from './backup';
import { parseBackupKey } from './crypto';
import { WebhookNotifier, type Notifier } from './notify';
import { runScheduledBackup, runWatchdog } from './scheduled';
import { assertSeparate, DirTarget } from './target';

/*
 * Backup operations (run in server/, with the environment's variables):
 *   npm run backup                     one encrypted backup into BACKUP_TARGET_DIR
 *   npm run backup:list                backups in the target
 *   npm run backup:verify -- [id] [n]  decrypts and checks a backup (default: newest; n evidence objects deep-checked)
 *   npm run restore -- [id]            into the EMPTY database/evidence dir of this environment; resumable
 *   npm run check:integrity            audit chains + evidence files of this environment
 *   npm run backup:scheduled           hourly job: backup → verify → prune → integrity; alerts on failure
 *   npm run backup:watchdog            alerts when the last success is older than BACKUP_RPO_MINUTES
 */
const [cmd, a1, a2] = process.argv.slice(2);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} tanımlı değil`); return v; };
const print = (r: Report) => { for (const c of r.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`); console.log(r.ok ? 'SONUÇ: TAMAM' : 'SONUÇ: SORUN VAR'); process.exitCode = r.ok ? 0 : 1; };
const target = () => {
  const dir = env('BACKUP_TARGET_DIR');
  assertSeparate(dir, [process.env.EVIDENCE_DIR ?? './var/evidence', process.cwd()]);
  return new DirTarget(dir);
};
const key = () => parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
const notifiers = (): Notifier[] => (process.env.ALERT_WEBHOOK_URL ? [new WebhookNotifier(process.env.ALERT_WEBHOOK_URL)] : []);
const newest = async () => { const ids = await listBackups(target()); if (!ids.length) throw new Error('Hedefte yedek yok.'); return ids.at(-1)!; };

if (cmd === 'backup') {
  const m = await createBackup({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR'), target: target(), key: key() });
  console.log(`Yedek ${m.id} · döküm ${m.dump.size} bayt · ${m.evidence.length} kanıt · ${m.durationMs} ms`);
  print(await verifyBackup(target(), key(), m.id, 20));
} else if (cmd === 'list') {
  for (const id of await listBackups(target())) console.log(id);
} else if (cmd === 'verify') {
  print(await verifyBackup(target(), key(), a1 || await newest(), a2 ? Number(a2) : Infinity));
} else if (cmd === 'restore') {
  const t0 = Date.now();
  print(await restoreBackup({ target: target(), key: key(), backupId: a1 || await newest(), targetOwnerUrl: env('DATABASE_OWNER_URL'), targetEvidenceDir: env('EVIDENCE_DIR'), log: m => console.log(m) }));
  console.log(`Süre: ${Math.round((Date.now() - t0) / 1000)} sn`);
} else if (cmd === 'integrity') {
  print(await checkRestored({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR') }));
} else if (cmd === 'scheduled') {
  const r = await runScheduledBackup({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR'), target: target(), key: key(),
    statusFile: env('BACKUP_STATUS_FILE'), notifiers: notifiers(), deepSample: Number(process.env.BACKUP_DEEP_SAMPLE ?? 20) });
  process.exitCode = r.ok ? 0 : 1;
} else if (cmd === 'watchdog') {
  const r = await runWatchdog({ statusFile: env('BACKUP_STATUS_FILE'), maxAgeMinutes: Number(process.env.BACKUP_RPO_MINUTES ?? 60) + Number(process.env.BACKUP_GRACE_MINUTES ?? 15), notifiers: notifiers() });
  console.log(r.ok ? `son başarılı yedek ${Math.round(r.ageMinutes)} dk önce` : 'UYARI gönderildi');
  process.exitCode = r.ok ? 0 : 1;
} else {
  console.error('Kullanım: backup | list | verify [id] [n] | restore [id] | integrity | scheduled | watchdog');
  process.exitCode = 2;
}
