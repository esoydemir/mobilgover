import { createHash, randomBytes } from 'node:crypto';
import { Db } from '../db/pool';
import type { Principal } from '../domain/permissions';
import { localDay } from '../domain/schedule';
import { seedDemoCompany, seedPlatform } from '../seed/demo';
import { uploadContent } from '../services/evidence';
import { addEvidence, completeTask, generateTasks, recordMeasurement } from '../services/tasks';
import { LocalStore } from '../storage/local';

/*
 * Synthetic pilot-scale data for measuring backup and restore times. It goes
 * through the real services, so audit chains, evidence rows and files are
 * genuine. Demo data only; refuses to run without LOADGEN_ALLOW=true.
 *   LOADGEN_ALLOW=true npm run ops:loadgen -- <companies> <days> <photoKB>
 */
if (process.env.LOADGEN_ALLOW !== 'true') throw new Error('Yalnızca ölçüm veritabanında: LOADGEN_ALLOW=true gerekir.');
const [companies = 20, days = 180, photoKb = 300] = process.argv.slice(2).map(Number);
const db = Db.connect(process.env.DATABASE_URL!);
const store = new LocalStore(process.env.EVIDENCE_DIR!);
const t0 = Date.now();
await seedPlatform(db);
let photos = 0, bytes = 0;

async function oneCompany(i: number) {
  const demo = await seedDemoCompany(db, { name: `Ölçüm Kafe ${i + 1} (DEMO)` });
  const p: Principal = { userId: demo.users.owner.id, platformRoles: [], memberships: [{ companyId: demo.companyId, siteId: null, role: 'owner' }], grants: [] };
  const today = new Date();
  const from = localDay(new Date(today.getTime() - (days - 1) * 86400_000), 'Europe/Istanbul');
  await db.tenant(demo.companyId, tx => generateTasks(tx, demo.companyId, demo.siteId, from, localDay(today, 'Europe/Istanbul')));
  const fridgeTasks = await db.tenant(demo.companyId, async tx => (await tx.query(
    `SELECT id FROM tasks WHERE company_id = $1 AND equipment_id = $2 AND status = 'open' ORDER BY due_at`, [demo.companyId, demo.fridgeId])).rows.map(r => r.id as string));
  for (const taskId of fridgeTasks) {
    await db.tenant(demo.companyId, tx => recordMeasurement(tx, p, demo.companyId, taskId, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId }));
    const img = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(photoKb * 1024 - 4)]);
    const ev = await db.tenant(demo.companyId, tx => addEvidence(tx, p, demo.companyId, taskId, { kind: 'photo', mime: 'image/jpeg', sha256: createHash('sha256').update(img).digest('hex'), sizeBytes: img.length }));
    await uploadContent(db, store, p, demo.companyId, (ev as { id: string }).id, img);
    await db.tenant(demo.companyId, tx => completeTask(tx, p, demo.companyId, taskId));
    photos++; bytes += img.length;
  }
}

const queue = [...Array(companies).keys()];
await Promise.all([...Array(4)].map(async () => { for (let i = queue.shift(); i !== undefined; i = queue.shift()) await oneCompany(i); }));
console.log(JSON.stringify({ companies, days, photoKb, photos, evidenceMB: Math.round(bytes / 1048576), seconds: Math.round((Date.now() - t0) / 1000) }));
await db.close();
