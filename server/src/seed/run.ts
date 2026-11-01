import { loadConfig } from '../config';
import { Db } from '../db/pool';
import { localDay } from '../domain/schedule';
import { generateTasks } from '../services/tasks';
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
  // On every start: top up today's and the next 30 days' tasks for demo businesses, so a demo
  // started weeks later still has work for today. Only adds missing tasks; never changes or deletes.
  const today = localDay(new Date(), 'Europe/Istanbul');
  const in30 = localDay(new Date(Date.now() + 30 * 86_400_000), 'Europe/Istanbul');
  const sites = await db.system(async tx => (await tx.query<{ company_id: string; id: string }>(
    `SELECT s.company_id, s.id FROM sites s JOIN companies c ON c.id = s.company_id WHERE c.is_demo`)).rows);
  let created = 0;
  for (const s of sites) {
    try {
      const r = await db.tenant(s.company_id, tx => generateTasks(tx, s.company_id, s.id, today, in30));
      created += Number((r as { created?: number }).created ?? 0);
    } catch (e) {
      console.log(`Görev üretimi atlandı (şube ${s.id}): ${(e as Error).message}`);
    }
  }
  console.log(`Demo görevleri: ${created} yeni görev eklendi (${today} – ${in30}).`);
} finally { await db.close(); }
