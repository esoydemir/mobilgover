import { access, constants, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import '../db/pool';
import { readHead } from './backup';
import { DirTarget } from './target';

/*
 * Is this environment ready for the controlled pilot? Read-only; changes nothing.
 *   npm run pilot:check
 * ✓ ready · ✗ blocks the pilot · ! needs attention but does not block.
 */
export type Item = { name: string; status: 'ok' | 'fail' | 'warn'; detail?: string };

export async function pilotCheck(env: NodeJS.ProcessEnv, opts: { fetchImpl?: typeof fetch; migrationsDir?: string; now?: Date } = {}): Promise<Item[]> {
  const out: Item[] = [];
  const add = (name: string, ok: boolean, detail?: string, warnOnly = false) => out.push({ name, status: ok ? 'ok' : warnOnly ? 'warn' : 'fail', detail });
  const now = opts.now ?? new Date();

  add('Demo modu kapalı', env.DEMO_MODE !== 'true', env.DEMO_MODE === 'true' ? 'DEMO_MODE=true: örnek kurallar ve demo giriş kutusu açık' : undefined);
  const base = env.PUBLIC_BASE_URL ?? '';
  add('Genel adres HTTPS', base.startsWith('https://'), base || 'PUBLIC_BASE_URL tanımlı değil');
  if (base.startsWith('https://')) {
    try {
      const r = await (opts.fetchImpl ?? fetch)(`${base.replace(/\/$/, '')}/api/env`);
      const j = await r.json() as { mode?: string; mailTransport?: string; mailProductionReady?: boolean };
      add('API HTTPS üzerinden yanıt veriyor', r.ok, `mod: ${j.mode}`);
      add('API pilot modunda', j.mode === 'pilot', `mod: ${j.mode}`);
      add('Canlı API: e-posta üretime hazır', j.mailTransport === 'smtp' && j.mailProductionReady === true, `${j.mailTransport} · hazır: ${j.mailProductionReady}`);
    } catch (e) { add('API HTTPS üzerinden yanıt veriyor', false, (e as Error).message); }
  }
  add('E-posta: SMTP', env.MAIL_TRANSPORT === 'smtp', `MAIL_TRANSPORT=${env.MAIL_TRANSPORT ?? 'dev_outbox'}`);
  add('E-posta: gerçek gönderim doğrulandı', env.MAIL_PRODUCTION_READY === 'true', 'MAIL_PRODUCTION_READY ancak gerçek gönderim doğrulandıktan sonra true yapılır');
  add('Ek doğrulama anahtarı tanımlı', !!env.MFA_ENCRYPTION_KEY);
  add('Yöneticilere ek doğrulama zorunlu', env.MFA_REQUIRED_FOR_PLATFORM !== 'false');

  try { await access(env.EVIDENCE_DIR ?? '', constants.W_OK); add('Kanıt klasörü yazılabilir', true, env.EVIDENCE_DIR); }
  catch { add('Kanıt klasörü yazılabilir', false, env.EVIDENCE_DIR ?? 'EVIDENCE_DIR tanımlı değil'); }

  if (!env.DATABASE_OWNER_URL) { add('Veritabanına bağlanılabiliyor', false, 'DATABASE_OWNER_URL tanımlı değil'); return out; }
  const c = new pg.Client({ connectionString: env.DATABASE_OWNER_URL });
  try { await c.connect(); } catch (e) { add('Veritabanına bağlanılabiliyor', false, (e as Error).message.replace(/:[^:@/]+@/, ':***@')); return out; }
  try {
    const files = (await readdir(opts.migrationsDir ?? join(import.meta.dirname, '../../migrations'))).filter(f => f.endsWith('.sql')).sort();
    const applied = (await c.query(`SELECT name FROM schema_migrations`)).rows.map(r => r.name);
    const missing = files.filter(f => !applied.includes(f));
    add('Tüm migration\'lar uygulanmış', missing.length === 0, missing.join(', ') || `${files.length} migration`);

    const rules = (await c.query(`SELECT count(*) FILTER (WHERE NOT is_example)::int AS real, count(*) FILTER (WHERE is_example)::int AS example
                                    FROM rule_versions WHERE status = 'published'`)).rows[0];
    add('Yayında onaylı gerçek kural var', rules.real > 0, `${rules.real} kural`);
    add('Yayında örnek kural yok', rules.example === 0, rules.example ? `${rules.example} örnek kural yayında` : undefined);

    const roles = (await c.query(`SELECT p.role, count(*)::int AS n, count(m.confirmed_at)::int AS mfa FROM platform_roles p LEFT JOIN mfa_totp m ON m.user_id = p.user_id GROUP BY p.role`)).rows;
    for (const role of ['rule_author', 'rule_reviewer', 'platform_admin']) {
      const r = roles.find(x => x.role === role);
      add(`Rol atanmış ve ek doğrulama kurulu: ${role}`, !!r && r.mfa > 0, r ? `${r.n} kişi, ${r.mfa} kişide ek doğrulama` : 'atanmamış');
    }
    const areas = (await c.query(`SELECT array_agg(DISTINCT area) AS a FROM reviewer_areas`)).rows[0].a ?? [];
    add('Alan uzmanı tanımlı', areas.length > 0, areas.join(', ') || 'yok');
    const unreviewed = (await c.query(`SELECT count(*)::int AS n FROM rule_versions v WHERE v.status = 'published' AND NOT v.is_example AND EXISTS (
        SELECT 1 FROM unnest(v.required_review_areas) a WHERE NOT EXISTS (SELECT 1 FROM rule_area_reviews r WHERE r.rule_version_id = v.id AND r.area = a AND r.decision = 'approved'))`)).rows[0].n;
    add('Yayındaki kuralların alan incelemeleri tamam', unreviewed === 0, unreviewed ? `${unreviewed} kural` : undefined);
    const retention = (await c.query(`SELECT count(*) FILTER (WHERE status = 'approved')::int AS ok, count(*)::int AS n FROM retention_policies`)).rows[0];
    add('Saklama süreleri onaylı', retention.ok === retention.n && retention.n > 0, `${retention.ok}/${retention.n} kayıt türü (onaysız sürede hiçbir şey silinmez)`, true);
  } finally { await c.end(); }

  add('Yedek konumu tanımlı', !!env.BACKUP_TARGET_DIR, env.BACKUP_TARGET_DIR);
  add('Şifreleme anahtarı dosyadan', !!env.BACKUP_ENCRYPTION_KEY_FILE && !env.BACKUP_ENCRYPTION_KEY, env.BACKUP_ENCRYPTION_KEY ? 'anahtar ortam değişkeninde; dosya önerilir' : undefined, true);
  add('Bildirim adresi tanımlı', !!env.ALERT_WEBHOOK_URL);
  if (env.BACKUP_TARGET_DIR) {
    const head = await readHead(new DirTarget(env.BACKUP_TARGET_DIR)).catch(() => null);
    const age = head ? (now.getTime() - Date.parse(head.snapshotAt)) / 60_000 : Infinity;
    add('Ayrı konumda kullanılabilir yedek, 60 dakikadan yeni', age < Number(env.BACKUP_RPO_MINUTES ?? 60), head ? `${Math.round(age)} dk önce (${head.backupId})` : 'doğrulanmış yedek yok');
  }
  return out;
}

if (process.argv[1]?.endsWith('pilotcheck.ts')) {
  const items = await pilotCheck(process.env);
  for (const i of items) console.log(`${i.status === 'ok' ? '✓' : i.status === 'warn' ? '!' : '✗'} ${i.name}${i.detail ? ` — ${i.detail}` : ''}`);
  const fails = items.filter(i => i.status === 'fail').length;
  console.log(fails ? `PİLOTA HAZIR DEĞİL: ${fails} engel` : 'PİLOTA HAZIR (uyarıları gözden geçir)');
  process.exitCode = fails ? 1 : 0;
}
