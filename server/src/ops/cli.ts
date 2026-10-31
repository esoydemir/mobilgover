import { checkRestored, createBackup, restoreBackup, verifyBackup, type Report } from './backup';

/*
 * npm run backup -- <out-dir>        DATABASE_OWNER_URL + EVIDENCE_DIR → new backup
 * npm run backup:verify -- <dir>     checks a backup against its manifest (no database)
 * npm run restore -- <dir>           into the EMPTY database/evidence dir of this environment
 * npm run check:integrity            audit chains + evidence files of this environment
 */
const [cmd, arg] = process.argv.slice(2);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} tanımlı değil`); return v; };
const print = (r: Report) => { for (const c of r.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`); console.log(r.ok ? 'SONUÇ: TAMAM' : 'SONUÇ: SORUN VAR'); process.exitCode = r.ok ? 0 : 1; };

if (cmd === 'backup') {
  if (!arg) throw new Error('Yedek klasörü ver: npm run backup -- <klasör>');
  const m = await createBackup({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR'), outDir: arg });
  console.log(`Yedek: ${arg} · döküm ${m.database.size} bayt · ${m.evidence.length} kanıt dosyası · ${m.migrations.length} migration`);
  print(await verifyBackup(arg));
} else if (cmd === 'verify') {
  print(await verifyBackup(arg!));
} else if (cmd === 'restore') {
  print(await restoreBackup({ dir: arg!, targetOwnerUrl: env('DATABASE_OWNER_URL'), targetEvidenceDir: env('EVIDENCE_DIR') }));
} else if (cmd === 'integrity') {
  print(await checkRestored({ ownerUrl: env('DATABASE_OWNER_URL'), evidenceDir: env('EVIDENCE_DIR') }));
} else {
  console.error('Kullanım: backup <klasör> | verify <klasör> | restore <klasör> | integrity');
  process.exitCode = 2;
}
