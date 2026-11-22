/**
 * Acceptance helper (DEMO database only): runs the SAME hourly job the API runs (topUpAllSites) at a chosen TEST time, twice, and prints
 * how many tasks each run created. Usage: DEMO_MODE=true DATABASE_URL=... DATABASE_OWNER_URL=... npx tsx scripts/synthetic-horizon-run.ts 2026-12-24T09:00:00+03:00 [days]
 */
import { loadConfig } from '../src/config';
import { assertDemoDatabase } from '../src/db/guards';
import { Db } from '../src/db/pool';
import { topUpAllSites } from '../src/services/horizon';

const config = loadConfig();
if (!config.demoMode) throw new Error('Runs only with DEMO_MODE=true.');
const db = Db.connect(config.databaseUrl);
await assertDemoDatabase(db);
const at = new Date(process.argv[2] ?? ''); if (Number.isNaN(at.getTime())) throw new Error('Pass an ISO time, e.g. 2026-12-24T09:00:00+03:00');
const days = Number(process.argv[3] ?? 14);
const first = await topUpAllSites(db, days, at); const second = await topUpAllSites(db, days, at);
console.log(JSON.stringify({ at: at.toISOString(), days, first: { created: first.created, failed: first.failed.length }, second: { created: second.created, failed: second.failed.length } }));
await db.close();
