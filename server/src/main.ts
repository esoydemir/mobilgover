import { loadConfig } from './config';
import { assertDemoDatabase } from './db/guards';
import { Db } from './db/pool';
import { buildApp } from './http/app';
import { startTaskHorizon } from './services/horizon';
import { legislationConfig, startLegislationScheduler } from './services/legislation';
import { DevOutboxMailer, type Mailer } from './services/mail';
import { SmtpMailer } from './services/smtp';
import { LocalStore } from './storage/local';

const config = loadConfig();
const db = Db.connect(config.databaseUrl);
if (config.demoMode) await assertDemoDatabase(db);
const log = (line: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line }));
const mailer: Mailer = config.smtp ? new SmtpMailer(config.smtp, log) : new DevOutboxMailer(db);
if (config.mailTransport === 'smtp' && !config.mailProductionReady) log({ level: 'warn', event: 'mail_not_production_ready', note: 'SMTP configured but a real delivery has not been confirmed (MAIL_PRODUCTION_READY)' });
const app = buildApp({ db, store: new LocalStore(config.evidenceDir), mailer, config, log });
await app.listen({ port: config.port, host: config.host });
console.log(`GoverHub API http://localhost:${config.port} (demo mode: ${config.demoMode})`);
// Keep each site's upcoming checks generated (adds missing tasks only; hourly).
const horizonDays = Number(process.env.TASK_HORIZON_DAYS ?? 14);
if (horizonDays > 0) startTaskHorizon(db, { days: Math.min(horizonDays, 62), everyMs: 60 * 60_000, log });

// Legislation watch: applies approved changes on their day (always) and runs the daily scan at 06:00 Istanbul when LEGISLATION_SCAN_ENABLED=1.
const legCfg = legislationConfig(process.env, { allowExampleRules: config.allowExampleRules });
startLegislationScheduler(db, legCfg, log);
if (legCfg.enabled) log({ level: 'info', event: 'legislation_scan_enabled', hour: legCfg.scanHour, tz: 'Europe/Istanbul' });
