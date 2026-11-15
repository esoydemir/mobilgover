import type { SmtpConfig } from './services/smtp';
import { llmConfigFromEnv, type LlmConfig } from './services/llm';
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
  /** Test environment: only addresses in this domain can sign in or be invited (demo mode only). */
  demoLoginDomain?: string;
  /** Web origins allowed to call the API (the web build of the app). */
  corsOrigins: string[];
  /** Reverse proxy addresses whose X-Forwarded-For is trusted. Explicit IP addresses or CIDR ranges only. */
  trustProxy: string[];
  /** Optional language model for the assistant (LLM_BASE_URL + LLM_MODEL); null = answers from the sources alone. */
  llm: LlmConfig | null;
  /** Address the API listens on. Loopback in pilot: only the reverse proxy on the same server reaches it. */
  host: string;
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
    mailTransport: mailTransportFor(process.env.MAIL_TRANSPORT, demoMode),
    smtp: mailTransportFor(process.env.MAIL_TRANSPORT, demoMode) === 'smtp' ? smtpConfig() : null,
    mailProductionReady: process.env.MAIL_PRODUCTION_READY === 'true',
    demoLoginDomain: demoLoginDomain(process.env.DEMO_LOGIN_DOMAIN, demoMode),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    host: listenHost(process.env.HOST, demoMode),
    llm: llmConfigFromEnv(),
  };
}

/**
 * Demo sign-in (codes read from the dev outbox) exists only in a demo deployment,
 * and a demo deployment never sends real mail. A pilot without a real mail
 * provider does not start, so the demo sign-in cannot leak into it.
 */
export function mailTransportFor(raw: string | undefined, demoMode: boolean): 'dev_outbox' | 'smtp' {
  const t = raw ?? (demoMode ? 'dev_outbox' : 'smtp');
  if (t !== 'dev_outbox' && t !== 'smtp') throw new Error(`MAIL_TRANSPORT=${t} is not supported (dev_outbox | smtp).`);
  if (!demoMode && t === 'dev_outbox') throw new Error('Pilot ortamında (DEMO_MODE=false) giriş kodları gerçek e-postayla gönderilir: MAIL_TRANSPORT=smtp gerekli. Demo girişi yalnızca ayrı demo/test ortamında çalışır.');
  if (demoMode && t === 'smtp') throw new Error('Demo ortamı (DEMO_MODE=true) gerçek e-posta göndermez: MAIL_TRANSPORT=dev_outbox olmalı.');
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

export function demoLoginDomain(raw: string | undefined, demoMode: boolean): string | undefined {
  const d = (raw ?? '').trim().toLowerCase();
  if (!d) return undefined;
  if (!demoMode) throw new Error('DEMO_LOGIN_DOMAIN yalnızca DEMO_MODE=true ile kullanılır.');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(`DEMO_LOGIN_DOMAIN geçersiz: ${raw}`);
  return d;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
const IPV6 = /^[0-9a-f:]+(\/(12[0-8]|1[01]\d|\d?\d))?$/i;

/**
 * Only explicit proxy addresses are trusted. Values that would trust every
 * hop (true, *, all, loopback-keywords of the proxy library) are refused, so a
 * client can never choose its own address by sending X-Forwarded-For.
 */
export function parseTrustProxy(raw: string | undefined): string[] {
  const list = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  for (const v of list) {
    if (!(IPV4.test(v) || (v.includes(':') && IPV6.test(v)))) throw new Error(`TRUST_PROXY yalnızca IP adresi ya da aralığı içerebilir (ör. 127.0.0.1); geçersiz değer: ${v}`);
    if (/^0\.0\.0\.0\/0$|^::\/0$/.test(v)) throw new Error('TRUST_PROXY bütün adreslere güvenemez.');
  }
  return list;
}

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
/** Loopback by default. A pilot (non-demo) deployment refuses to listen on a public address. */
export function listenHost(raw: string | undefined, demoMode: boolean): string {
  const host = (raw ?? '127.0.0.1').trim();
  if (!demoMode && !LOOPBACK.includes(host) && process.env.ALLOW_DIRECT_API !== 'true') {
    throw new Error(`Pilot ortamında API yalnızca yerel adreste dinler (HOST=127.0.0.1); dışarıdan erişim vekil sunucu (HTTPS) üzerindendir. Verilen: ${host}`);
  }
  return host;
}
