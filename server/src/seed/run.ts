import { loadConfig } from '../config';
import { Db } from '../db/pool';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from './demo';

/** Loads demo data into a demo deployment and prints bearer tokens for trying the API. */
const config = loadConfig();
if (!config.demoMode) throw new Error('Demo data is only loaded when DEMO_MODE=true.');
const db = Db.connect(config.databaseUrl);
const platform = await seedPlatform(db);
const demo = await seedDemoCompany(db);
const provider = await seedDemoProvider(db, platform.marketReviewer.id);
console.log(JSON.stringify({ companyId: demo.companyId, siteId: demo.siteId, fridgeId: demo.fridgeId, thermometerId: demo.thermometerId,
  tokens: Object.fromEntries(Object.entries({ ...platform, ...demo.users, provider }).filter(([, v]) => typeof v === 'object' && 'token' in v).map(([k, v]: any) => [k, v.token])) }, null, 2));
await db.close();
