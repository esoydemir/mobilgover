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
  };
}
