import { loadConfig } from '../config';
import { Db } from '../db/pool';
import { topUpAllSites } from '../services/horizon';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from './demo';

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
} finally { await db.close(); }
