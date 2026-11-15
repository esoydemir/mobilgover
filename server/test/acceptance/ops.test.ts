import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeRole, listAdmins } from '../../src/ops/admin';
import { writeHead } from '../../src/ops/backup';
import { pilotCheck } from '../../src/ops/pilotcheck';
import { DirTarget } from '../../src/ops/target';
import { EXAMPLE_RULES, seedPlatform } from '../../src/seed/demo';
import { approve, areaReview, createDraft, publish, submitForReview } from '../../src/services/rules';
import { freshEnv, type Env } from '../support/env';

/** Real PostgreSQL. Role administration from the shell, and the pilot readiness check. */
let env: Env, owner: pg.Client, work: string;
beforeAll(async () => {
  env = await freshEnv({ demoMode: false, allowExampleRules: false });
  owner = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL }); await owner.connect();
  work = await mkdtemp(join(tmpdir(), 'gh-ops-'));
});
afterAll(async () => { await owner?.end(); await env?.close(); await rm(work, { recursive: true, force: true }); });

describe('platform roles from the shell', () => {
  it('grants a role to an address (creating the account without a password) and records who did it and why', async () => {
    const r = await changeRole(owner, 'grant', 'Yazar@Ornek.com.tr', 'rule_author', 'Pilot kural yazarı', 'ops-test');
    expect(r.changed).toBe(true);
    expect((await changeRole(owner, 'grant', 'yazar@ornek.com.tr', 'rule_author', 'tekrar deneme', 'ops-test')).changed).toBe(false);
    const ev = (await owner.query(`SELECT event_type, payload, company_id FROM audit_events WHERE entity_id = $1`, [r.userId])).rows;
    expect(ev).toEqual([{ event_type: 'platform.role_granted', company_id: null, payload: { role: 'rule_author', reason: 'Pilot kural yazarı', operator: 'ops-test' } }]);
    expect((await owner.query(`SELECT email FROM users WHERE id = $1`, [r.userId])).rows[0].email).toBe('yazar@ornek.com.tr');
  });

  it('grants areas, refuses unknown roles and missing reasons, and revokes', async () => {
    await changeRole(owner, 'grant', 'uzman@ornek.com.tr', 'alan:food_safety', 'Gıda mühendisi', 'ops-test');
    await expect(changeRole(owner, 'grant', 'x@ornek.com.tr', 'superuser', 'deneme amaçlı', 'ops-test')).rejects.toThrow('Bilinmeyen');
    await expect(changeRole(owner, 'grant', 'x@ornek.com.tr', 'rule_author', '', 'ops-test')).rejects.toThrow('Gerekçe');
    expect((await changeRole(owner, 'revoke', 'yazar@ornek.com.tr', 'rule_author', 'Görev değişti', 'ops-test')).changed).toBe(true);
    const list = await listAdmins(owner);
    expect(list.find(a => a.email === 'uzman@ornek.com.tr')).toMatchObject({ areas: ['food_safety'], mfa: false });
    expect(list.find(a => a.email === 'yazar@ornek.com.tr')).toBeUndefined();
  });
});

describe('pilot readiness check', () => {
  const pilotEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL, EVIDENCE_DIR: env.evidenceDir, DEMO_MODE: 'false',
    PUBLIC_BASE_URL: 'https://pilot.ornek.com.tr', MAIL_TRANSPORT: 'smtp', MAIL_PRODUCTION_READY: 'true', MFA_ENCRYPTION_KEY: 'x',
    BACKUP_TARGET_DIR: join(work, 'hedef'), BACKUP_ENCRYPTION_KEY_FILE: '/kasa/anahtar', ALERT_WEBHOOK_URL: 'https://hook.example/x', HOST: '127.0.0.1', TRUST_PROXY: '127.0.0.1', ...extra });
  const liveApi = (body: object) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const failing = (items: Awaited<ReturnType<typeof pilotCheck>>) => items.filter(i => i.status === 'fail').map(i => i.name);

  it('lists every blocker of an unprepared environment', async () => {
    const items = await pilotCheck({ DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL, EVIDENCE_DIR: env.evidenceDir, DEMO_MODE: 'true' });
    expect(failing(items)).toEqual(expect.arrayContaining([
      'Demo modu kapalı', 'Genel adres HTTPS', 'E-posta: SMTP', 'E-posta: gerçek gönderim doğrulandı', 'Ek doğrulama anahtarı tanımlı',
      'Yayında onaylı gerçek kural var', 'Rol atanmış ve ek doğrulama kurulu: rule_author', 'Yedek konumu tanımlı', 'Bildirim adresi tanımlı']));
  });

  it('example rules published in this database block the pilot', async () => {
    const demoEnv = await freshEnv({ demoMode: true, allowExampleRules: true });
    try {
      await seedPlatform(demoEnv.db);
      expect(failing(await pilotCheck(pilotEnv(), { fetchImpl: liveApi({ mode: 'pilot', mailTransport: 'smtp', mailProductionReady: true }) }))).toContain('Yayında örnek kural yok');
    } finally { await demoEnv.close(); }
  });

  it('passes when every condition is met, and catches a demo-mode API behind HTTPS', async () => {
    // Fresh pilot database: no example content.
    env = await (async () => { await env.close(); return freshEnv({ demoMode: false, allowExampleRules: false }); })();
    await owner.end(); owner = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL }); await owner.connect();
    const ids: Record<string, string> = {};
    for (const [email, role] of [['yazar@ornek.com.tr', 'rule_author'], ['onay@ornek.com.tr', 'rule_reviewer'], ['yonetici@ornek.com.tr', 'platform_admin'], ['uzman@ornek.com.tr', 'rule_reviewer']] as const) {
      ids[email] = (await changeRole(owner, 'grant', email, role, 'Pilot rolü', 'ops-test')).userId;
      await owner.query(`INSERT INTO mfa_totp (user_id, secret_enc, confirmed_at) VALUES ($1, 'x', now()) ON CONFLICT DO NOTHING`, [ids[email]]);
    }
    await changeRole(owner, 'grant', 'uzman@ornek.com.tr', 'alan:food_safety', 'Gıda mühendisi', 'ops-test');
    // A non-example rule through the real review flow (content here is a test fixture, not legislation).
    const p = (id: string, roles: string[]) => ({ userId: id, platformRoles: roles as any, memberships: [], grants: [] });
    await env.db.system(async tx => {
      const src = (await tx.query(`INSERT INTO legal_sources (code, title, issuer, kind, is_example) VALUES ('T-SRC', 'Test kaynağı', 'Test', 'regulation', false) RETURNING id`)).rows[0].id;
      const sv = (await tx.query(`INSERT INTO source_versions (source_id, version_label, published_on, effective_from) VALUES ($1, 't1', '2024-01-01', '2024-01-01') RETURNING id`, [src])).rows[0].id;
      const prov = (await tx.query(`INSERT INTO provisions (source_version_id, ref, excerpt) VALUES ($1, 'Md. 1', 'Test hükmü') RETURNING id`, [sv])).rows[0].id;
      const base = { ...EXAMPLE_RULES[0]!, code: 'T-COLD', title: 'Test kuralı', isExample: false, provisionIds: [prov] };
      const d = await createDraft(tx, p(ids['yazar@ornek.com.tr']!, ['rule_author']), base);
      await submitForReview(tx, p(ids['yazar@ornek.com.tr']!, ['rule_author']), d.id);
      await areaReview(tx, p(ids['uzman@ornek.com.tr']!, ['rule_reviewer']), d.id, 'food_safety', 'approved', 'Kaynakla karşılaştırıldı');
      await approve(tx, p(ids['onay@ornek.com.tr']!, ['rule_reviewer']), d.id, 'Test: onay gerekçesi');
      await publish(tx, p(ids['yonetici@ornek.com.tr']!, ['platform_admin']), d.id, { allowExampleRules: false, reason: 'Test: yayın gerekçesi' });
    });
    await writeHead(new DirTarget(join(work, 'hedef')), { id: '20261101T000000Z', snapshotAt: new Date(Date.now() - 10 * 60_000).toISOString(), evidence: [] } as any, new Date());
    await new DirTarget(join(work, 'hedef')).put('db/20261101T000000Z.manifest.enc', join(work, 'hedef', 'status', 'latest-verified.json'));

    const ready = await pilotCheck(pilotEnv(), { fetchImpl: liveApi({ mode: 'pilot', mailTransport: 'smtp', mailProductionReady: true }) });
    expect(failing(ready)).toEqual([]);
    expect(ready.find(i => i.name === 'Saklama süreleri onaylı')!.status).toBe('warn');

    const demoBehind = await pilotCheck(pilotEnv(), { fetchImpl: liveApi({ mode: 'demo', mailTransport: 'dev_outbox', mailProductionReady: false }) });
    expect(failing(demoBehind)).toEqual(['API pilot modunda', 'Canlı API: e-posta üretime hazır']);

    const stale = await pilotCheck(pilotEnv(), { fetchImpl: liveApi({ mode: 'pilot', mailTransport: 'smtp', mailProductionReady: true }), now: new Date(Date.now() + 60 * 60_000) });
    expect(failing(stale)).toEqual(['Ayrı konumda kullanılabilir yedek, 60 dakikadan yeni']);
  });
});
