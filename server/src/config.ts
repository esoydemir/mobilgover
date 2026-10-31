import type { SmtpConfig } from './services/smtp';
/** Runtime configuration from the environment. No secrets have defaults. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

export type Config = {
  databaseUrl: string;
  evidenceDir: string;
  port: number;
  demoMode: boolean;
  /** Example rules may only be published where demo data is expected. */
  allowExampleRules: boolean;
  maxUploadBytes: number;
  /** 32-byte base64 key that encrypts TOTP secrets at rest. MFA setup is refused without it. */
  mfaEncryptionKey: string | null;
  /** Platform roles (rule review/publishing, admin) need a second factor on the session. */
  mfaRequiredForPlatform: boolean;
  /** 'dev_outbox' keeps sign-in mails in the database (development and demo only); 'smtp' sends them. */
  mailTransport: 'dev_outbox' | 'smtp';
  smtp: SmtpConfig | null;
  /**
   * Set to true by a person only after a real delivery through the chosen
   * provider was confirmed. Never assumed; reported in /env.
   */
  mailProductionReady: boolean;
  /** Web origins allowed to call the API (the web build of the app). */
  corsOrigins: string[];
};

export function loadConfig(): Config {
  const demoMode = process.env.DEMO_MODE === 'true';
  return {
    databaseUrl: required('DATABASE_URL'),
    evidenceDir: process.env.EVIDENCE_DIR ?? './var/evidence',
    port: Number(process.env.PORT ?? 3000),
    demoMode,
    allowExampleRules: demoMode,
    maxUploadBytes: 15 * 1024 * 1024,
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY || null,
    mfaRequiredForPlatform: process.env.MFA_REQUIRED_FOR_PLATFORM !== 'false',
    mailTransport: mailTransport(),
    smtp: mailTransport() === 'smtp' ? smtpConfig() : null,
    mailProductionReady: process.env.MAIL_PRODUCTION_READY === 'true',
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

function mailTransport(): 'dev_outbox' | 'smtp' {
  const t = process.env.MAIL_TRANSPORT ?? 'dev_outbox';
  if (t !== 'dev_outbox' && t !== 'smtp') throw new Error(`MAIL_TRANSPORT=${t} is not supported (dev_outbox | smtp).`);
  return t;
}

function smtpConfig(): SmtpConfig {
  const security = process.env.MAIL_SMTP_SECURITY ?? 'starttls';
  if (security !== 'tls' && security !== 'starttls') throw new Error('MAIL_SMTP_SECURITY must be tls or starttls.');
  return {
    host: required('MAIL_SMTP_HOST'), port: Number(process.env.MAIL_SMTP_PORT ?? (security === 'tls' ? 465 : 587)), security,
    user: process.env.MAIL_SMTP_USER || undefined, pass: process.env.MAIL_SMTP_PASS || undefined, from: required('MAIL_FROM'),
  };
}
