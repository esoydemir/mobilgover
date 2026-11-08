import { loadConfig } from '../config';
import { Db } from '../db/pool';
import { topUpAllSites } from '../services/horizon';
import { seedDemoCompany } from './demo';

/**
 * A fresh, separate demo business for one browser-test run (DEMO_MODE only).
 * Every run gets its own company and its own sign-in addresses
 * (<role>.<run>@<demo domain>), so runs never share notifications, cases or
 * counters, and the existing demo business is not touched.
 * The business is marked as demo: "reset demo data" removes it with the rest.
 *
 *   node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts <run-id>
 * prints one JSON line: { companyId, siteId, emails: { owner, manager, staff, expert, hq } }.
 */
const config = loadConfig();
if (!config.demoMode) throw new Error('Test işletmesi yalnızca DEMO_MODE=true iken oluşturulur.');
const run = (process.argv[2] ?? '').toLowerCase();
// --single: a business with ONE manager (the owner) and staff; no site or HQ manager.
const single = process.argv.includes('--single');
if (!/^[a-z0-9-]{3,32}$/.test(run)) throw new Error('Çalıştırma kimliği 3–32 karakter: a-z, 0-9, -');
const domain = config.demoLoginDomain ?? 'demo.goverhub.test';
const db = Db.connect(config.databaseUrl);
try {
  const exists = await db.system(async tx => (await tx.query(`SELECT 1 FROM users WHERE email = $1`, [`sahip.${run}@${domain}`])).rowCount);
  if (exists) throw new Error(`Bu çalıştırma kimliği zaten kullanılmış: ${run}`);
  const demo = await seedDemoCompany(db, { name: `Test işletmesi ${run} (DEMO)`, isDemo: true });
  const emails = { owner: `sahip.${run}@${domain}`, manager: `mudur.${run}@${domain}`, staff: `personel.${run}@${domain}`,
    expert: `danisman.${run}@${domain}`, hq: `merkez.${run}@${domain}` };
  await db.system(async tx => {
    for (const k of ['owner', 'manager', 'staff', 'expert'] as const) {
      await tx.query(`UPDATE users SET email = $2 WHERE id = $1`, [demo.users[k].id, emails[k]]);
    }
    if (single) {
      // The site manager left: only the owner manages (suspension kept with its reason, nothing deleted).
      await tx.query(`UPDATE memberships SET status = 'suspended', suspended_at = now(), suspended_by = $3, suspend_reason = 'Tek yöneticili test işletmesi'
         WHERE user_id = $1 AND company_id = $2`, [demo.users.manager.id, demo.companyId, demo.users.owner.id]);
      // The demo expert grant is not used here; the owner invites an outside verifier in the app.
      await tx.query(`UPDATE access_grants SET revoked_at = now() WHERE company_id = $1`, [demo.companyId]);
    } else {
      // A second company-wide manager: someone who did none of the work and can verify it independently.
      const hq = (await tx.query<{ id: string }>(`INSERT INTO users (display_name, email) VALUES ('Deniz (merkez yöneticisi)', $1) RETURNING id`, [emails.hq])).rows[0]!.id;
      await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,NULL,'hq_manager','active',now())`, [hq, demo.companyId]);
    }
    // Same starting point as the demo business: the daily glove check is the staff member's.
    await tx.query(`INSERT INTO task_assignment_defaults (company_id, site_id, template_code, equipment_id, user_id, set_by) VALUES ($1,$2,'glove_daily',NULL,$3,$4)`,
      [demo.companyId, demo.siteId, demo.users.staff.id, demo.users.owner.id]);
  });
  await topUpAllSites(db, 30); // adds only missing tasks; never changes existing ones
  console.log(JSON.stringify({ companyId: demo.companyId, siteId: demo.siteId, single, emails: { ...emails, verifier: `dogrulayici.${run}@${domain}` } }));
} finally { await db.close(); }
