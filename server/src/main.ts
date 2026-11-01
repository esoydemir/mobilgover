import { loadConfig } from './config';
import { assertDemoDatabase } from './db/guards';
import { Db } from './db/pool';
import { buildApp } from './http/app';
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
