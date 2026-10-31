import { loadConfig } from './config';
import { Db } from './db/pool';
import { buildApp } from './http/app';
import { DevOutboxMailer } from './services/mail';
import { LocalStore } from './storage/local';

const config = loadConfig();
const db = Db.connect(config.databaseUrl);
const app = buildApp({ db, store: new LocalStore(config.evidenceDir), mailer: new DevOutboxMailer(db), config });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`GoverHub API http://localhost:${config.port} (demo mode: ${config.demoMode})`);
