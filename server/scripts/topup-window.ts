/** Runs the hourly task top-up with a longer window (acceptance evidence: next period's task comes from the new rule version). Demo databases only. */
import { loadConfig } from '../src/config';
import { assertDemoDatabase } from '../src/db/guards';
import { Db } from '../src/db/pool';
import { topUpAllSites } from '../src/services/horizon';
const config = loadConfig(); if (!config.demoMode) throw new Error('DEMO_MODE=true required');
const db = Db.connect(config.databaseUrl); await assertDemoDatabase(db);
const days = Number(process.argv[2] ?? 45); const r = await topUpAllSites(db, days);
console.log(`top-up window ${days} days: ${r.created} tasks created on ${r.sites} sites`); process.exit(0);
