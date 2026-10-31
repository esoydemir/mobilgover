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
  /** 'dev_outbox' keeps sign-in mails in the database (development and demo only). */
  mailTransport: 'dev_outbox';
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
  };
}

function mailTransport(): 'dev_outbox' {
  const t = process.env.MAIL_TRANSPORT ?? 'dev_outbox';
  if (t !== 'dev_outbox') throw new Error(`MAIL_TRANSPORT=${t} is not implemented yet; only dev_outbox exists until a mail provider is chosen.`);
  return t;
}
