import { loadConfig } from '../config';
import { Db } from '../db/pool';
import { topUpAllSites } from '../services/horizon';
import { ensureActivityDerivedFacts, ensureFoodScopeRevision, ensureReportRules, ensureSectorGateRevisions, ensureSectorRules, seedDemoCompany, seedDemoProvider, seedPlatform } from './demo';

/**
 * Loads demo data into a demo deployment (DEMO_MODE=true only). Runs once:
 * if rules already exist, nothing is loaded again. Demo people get
 * @demo.goverhub.test addresses so they can sign in through the demo outbox.
 * No real business data is ever created here.
 */
const DEMO_EMAILS: Record<string, string> = {
  author: 'yazar@demo.goverhub.test', reviewer: 'onay@demo.goverhub.test', specialist: 'alan-uzmani@demo.goverhub.test',
  admin: 'yonetici@demo.goverhub.test', marketReviewer: 'pazar@demo.goverhub.test',
  owner: 'sahip@demo.goverhub.test', manager: 'mudur@demo.goverhub.test', staff: 'personel@demo.goverhub.test', expert: 'danisman@demo.goverhub.test',
};

const config = loadConfig();
if (!config.demoMode) throw new Error('Demo data is only loaded when DEMO_MODE=true.');
const db = Db.connect(config.databaseUrl);
try {
  const already = await db.system(async tx => (await tx.query(`SELECT count(*)::int AS n FROM rule_versions`)).rows[0].n as number);
  if (already > 0) {
    console.log('Demo verisi zaten yüklü; tekrar yüklenmedi.');
  } else {
    const platform = await seedPlatform(db);
    const demo = await seedDemoCompany(db);
    await seedDemoProvider(db, platform.marketReviewer.id, 'uzman@demo.goverhub.test');
    const people: Record<string, unknown> = { ...platform, ...demo.users };
    await db.system(async tx => {
      for (const [role, email] of Object.entries(DEMO_EMAILS)) {
        const p = people[role];
        if (p && typeof p === 'object' && 'id' in p) await tx.query(`UPDATE users SET email = $2 WHERE id = $1`, [(p as { id: string }).id, email]);
      }
    });
    console.log('Demo verisi yüklendi. Giriş adresleri (kod demo kutusundan alınır):');
    for (const [role, email] of Object.entries({ ...DEMO_EMAILS, provider: 'uzman@demo.goverhub.test' })) console.log(`  ${role.padEnd(15)} ${email}`);
  }
  // GM-30 devamı: example rules whose document evidence accepts a reviewed service report. Added once; existing data is untouched.
  const reportRules = await ensureReportRules(db);
  await ensureSectorRules(db);
  console.log('activity-derived facts re-derived for sites:', await ensureActivityDerivedFacts(db));
  console.log('food-scope revision (v1→v2):', JSON.stringify(await ensureFoodScopeRevision(db)));
  console.log('sector-gate revision (v1→v2):', JSON.stringify(await ensureSectorGateRevisions(db)));
  if (reportRules) console.log(`Demo: ${reportRules} örnek servis raporu kuralı yayımlandı.`);
  // On every start: top up the next 30 days of tasks (adds missing ones; never changes or deletes).
  const r = await topUpAllSites(db, 30);
  console.log(`Demo görevleri: ${r.created} yeni görev eklendi (${r.sites} şube, önümüzdeki 30 gün).`);
  for (const f of r.failed) console.log(`Görev üretimi atlandı (şube ${f.siteId}): ${f.error}`);

  // Demo: make the staff member responsible for the daily glove check once, so the staff role has
  // work to see. Only when nobody has been made responsible for anything at that site yet.
  const assigned = await db.system(async tx => {
    const row = (await tx.query(
      `SELECT c.id AS company_id, s.id AS site_id, u.id AS staff_id, o.id AS owner_id
         FROM companies c JOIN sites s ON s.company_id = c.id
         JOIN users u ON u.email = 'personel@demo.goverhub.test'
         JOIN memberships m ON m.user_id = u.id AND m.company_id = c.id AND m.status = 'active'
         JOIN users o ON o.email = 'sahip@demo.goverhub.test'
        WHERE c.is_demo AND c.name = 'Kahve Durağı (DEMO)'
          AND NOT EXISTS (SELECT 1 FROM task_assignment_defaults d WHERE d.site_id = s.id)
        LIMIT 1`)).rows[0];
    if (!row) return 0;
    await tx.query(`INSERT INTO task_assignment_defaults (company_id, site_id, template_code, equipment_id, user_id, set_by) VALUES ($1,$2,'glove_daily',NULL,$3,$4)`,
      [row.company_id, row.site_id, row.staff_id, row.owner_id]);
    return (await tx.query(`UPDATE tasks SET assignee_id = $3, assigned_by = $4, assigned_at = now()
                             WHERE company_id = $1 AND site_id = $2 AND template_code = 'glove_daily' AND status = 'open' AND assignee_id IS NULL`,
      [row.company_id, row.site_id, row.staff_id, row.owner_id])).rowCount ?? 0;
  });
  if (assigned) console.log(`Demo: eldiven kontrolü personele (personel@) atandı; ${assigned} açık görev.`);

  // Demo: the outside expert (danisman@) may review "does not apply" requests on mandatory
  // obligations. Adds that one scope to the demo grant if it is missing; nothing else changes.
  const scoped = await db.system(async tx => (await tx.query(
    `UPDATE access_grants g SET scopes = array_append(g.scopes, 'obligation_review')
       FROM companies c, users u
      WHERE c.id = g.company_id AND c.is_demo AND c.name = 'Kahve Durağı (DEMO)' AND u.id = g.user_id AND u.email = 'danisman@demo.goverhub.test'
        AND NOT ('obligation_review' = ANY(g.scopes))`)).rowCount ?? 0);
  if (scoped) console.log('Demo: danışmana "uygulanmaz" isteklerini inceleme yetkisi eklendi.');

  // Demo, delivery 5B: a network moderator account and network profiles for the demo specialist and
  // consultant (declared information only). Added once; nothing existing is changed.
  const net = await db.system(async tx => {
    let added = 0;
    await tx.query(`INSERT INTO users (display_name, email) VALUES ('Moderatör (demo)', 'moderator@demo.goverhub.test') ON CONFLICT (email) DO NOTHING`);
    added += (await tx.query(`INSERT INTO platform_roles (user_id, role) SELECT id, 'network_moderator' FROM users WHERE email = 'moderator@demo.goverhub.test' ON CONFLICT DO NOTHING`)).rowCount ?? 0;
    added += (await tx.query(`INSERT INTO network_profiles (user_id, display_name, title, bio, city, specialties, categories)
       SELECT u.id, pp.display_name, 'Soğutma teknisyeni', 'Ticari soğutucu ve dondurucu bakımı. (Demo profil; beyan bilgisidir.)', pp.city, '{soğutma,kalibrasyon}',
              COALESCE((SELECT array_agg(a.category_code) FROM service_authorizations a WHERE a.profile_id = pp.id), '{}')
         FROM users u JOIN professional_profiles pp ON pp.user_id = u.id WHERE u.email = 'uzman@demo.goverhub.test' ON CONFLICT (user_id) DO NOTHING`)).rowCount ?? 0;
    added += (await tx.query(`INSERT INTO network_profiles (user_id, display_name, title, bio, city, specialties)
       SELECT u.id, u.display_name, 'Gıda güvenliği danışmanı', 'HACCP ve hijyen danışmanlığı. (Demo profil; beyan bilgisidir.)', 'İstanbul', '{gıda güvenliği,hijyen,HACCP}'
         FROM users u WHERE u.email = 'danisman@demo.goverhub.test' ON CONFLICT (user_id) DO NOTHING`)).rowCount ?? 0;
    return added;
  });
  if (net) console.log('Demo: mesleki ağ moderatörü (moderator@) ve örnek ağ profilleri eklendi.');
} finally { await db.close(); }
