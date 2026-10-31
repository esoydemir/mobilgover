import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app';
import { buildMessage, maskEmail, SmtpMailer } from '../../src/services/smtp';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Provider-independent SMTP sending, against a local SMTP server that speaks
 * STARTTLS with a throwaway certificate; and the sign-in code rules through
 * that real path: expiry, single use, attempt limit, and no code in logs.
 */
type Received = { from: string; to: string; data: string; secured: boolean; auth: string | null };
let tlsKey: Buffer, tlsCert: Buffer, work: string;

function fakeSmtp(opts: { starttls?: boolean; rejectRcpt?: boolean } = {}) {
  const got: Received[] = [];
  const server = createServer(raw => {
    let sock: Socket | TLSSocket = raw;
    let secured = false, auth: string | null = null, from = '', to = '', inData = false, data = '', buf = '';
    const write = (s: string) => sock.write(s + '\r\n');
    const onData = (d: Buffer | string) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; got.push({ from, to, data, secured, auth }); write('250 2.0.0 kuyruğa alındı'); }
          else data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { write('250-fake.smtp'); if (opts.starttls !== false && !secured) write('250-STARTTLS'); write('250 AUTH PLAIN'); }
        else if (line.toUpperCase() === 'STARTTLS') {
          write('220 2.0.0 hazır');
          sock.removeListener('data', onData);
          const t = new TLSSocket(sock, { isServer: true, key: tlsKey, cert: tlsCert });
          sock = t; secured = true; t.on('data', onData); t.on('error', () => {});
        }
        else if (cmd === 'AUTH') { auth = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString(); write('235 2.7.0 tamam'); }
        else if (cmd === 'MAIL') { from = line; write('250 ok'); }
        else if (cmd === 'RCPT') { to = line; write(opts.rejectRcpt ? `550 5.1.1 <${line.slice(9, -1)}> kullanıcı yok` : '250 ok'); }
        else if (cmd === 'DATA') { inData = true; data = ''; write('354 devam'); }
        else if (cmd === 'QUIT') { write('221 güle güle'); sock.end(); }
        else write('500 bilinmiyor');
      }
    };
    raw.on('data', onData); raw.on('error', () => {});
    write('220 fake.smtp hazır');
  });
  return { server, got, listen: () => new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))) };
}
const bodyOf = (data: string) => Buffer.from(data.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
const codeIn = (data: string) => /(\d{6})/.exec(bodyOf(data))![1]!;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'gh-smtp-'));
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', join(work, 'k.pem'), '-out', join(work, 'c.pem')]);
  tlsKey = await readFile(join(work, 'k.pem')); tlsCert = await readFile(join(work, 'c.pem'));
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe('SMTP adapter', () => {
  let s: ReturnType<typeof fakeSmtp>, port: number;
  beforeAll(async () => { s = fakeSmtp(); port = await s.listen(); });
  afterAll(() => new Promise<void>(r => s.server.close(() => r())));

  it('upgrades to TLS before authenticating and sends a UTF-8 message', async () => {
    const logs: any[] = [];
    const m = new SmtpMailer({ host: '127.0.0.1', port, security: 'starttls', user: 'goverhub', pass: 'smtp-parola', from: 'giris@ornek.com.tr', insecureTls: true }, l => logs.push(l));
    await m.send('ayse@kafe.com.tr', 'GoverHub giriş kodun', 'Giriş kodun: 123456\nÇğüşöı');
    const g = s.got.at(-1)!;
    expect(g.secured).toBe(true);
    expect(g.auth).toBe('\0goverhub\0smtp-parola');
    expect(g.to).toBe('RCPT TO:<ayse@kafe.com.tr>');
    expect(g.data).toContain('Subject: =?UTF-8?B?');
    expect(bodyOf(g.data)).toBe('Giriş kodun: 123456\nÇğüşöı');
    expect(logs).toEqual([expect.objectContaining({ event: 'mail_sent', to: 'a***@k***.com.tr' })]);
    expect(JSON.stringify(logs)).not.toContain('123456');
  });

  it('refuses to send without encryption, and never sends credentials in clear', async () => {
    const plain = fakeSmtp({ starttls: false }); const p = await plain.listen();
    try {
      const m = new SmtpMailer({ host: '127.0.0.1', port: p, security: 'starttls', user: 'u', pass: 'gizli', from: 'giris@ornek.com.tr', insecureTls: true });
      await expect(m.send('a@b.co', 'x', 'y')).rejects.toThrow('E-posta gönderilemedi');
      expect(plain.got).toEqual([]);
    } finally { plain.server.close(); }
    expect(() => new SmtpMailer({ host: 'smtp.ornek.com.tr', port: 25, security: 'none', from: 'a@b.co' })).toThrow('yerel');
  });

  it('rejects header injection and masks addresses', () => {
    expect(() => buildMessage('a@b.co', 'kurban@x.co\r\nBcc: herkes@x.co', 's', 'b', '<id@x>')).toThrow('satır sonu');
    expect(maskEmail('ayse.yilmaz@kafe.com.tr')).toBe('a***@k***.com.tr');
  });
});

describe('sign-in codes through SMTP', () => {
  let env: Env, s: ReturnType<typeof fakeSmtp>;
  const logs: Record<string, unknown>[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let call: (url: string, body: unknown) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    env = await freshEnv();
    s = fakeSmtp(); const port = await s.listen();
    const mailer = new SmtpMailer({ host: '127.0.0.1', port, security: 'starttls', user: 'u', pass: 'p', from: 'giris@ornek.com.tr', insecureTls: true }, l => logs.push(l));
    app = buildApp({ db: env.db, store: env.store, mailer, log: l => logs.push(l),
      config: { demoMode: false, allowExampleRules: false, maxUploadBytes: 1024 * 1024, mfaEncryptionKey: null, mfaRequiredForPlatform: true } });
    call = async (url, body) => { const r = await app.inject({ method: 'POST', url, payload: body as object }); return { status: r.statusCode, body: r.json() }; };
  });
  afterAll(async () => { await app?.close(); s?.server.close(); await env?.close(); });

  const lastCode = (email: string) => codeIn(s.got.filter(g => g.to.includes(email)).at(-1)!.data);

  it('the code goes out by SMTP only; nothing is kept in the dev outbox; only a hash is stored', async () => {
    expect((await call('/auth/email/start', { email: 'sahip@kafe.com.tr' })).status).toBe(200);
    const code = lastCode('sahip@kafe.com.tr');
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM dev_mail_outbox`)).rows[0].n).toBe(0);
    const stored = (await env.ownerDb.query(`SELECT code_hash FROM login_challenges WHERE email = 'sahip@kafe.com.tr'`)).rows[0].code_hash;
    expect(stored).not.toContain(code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    // Pilot mode: the dev outbox endpoint does not exist.
    expect((await app.inject({ method: 'GET', url: '/dev/outbox/latest?email=sahip@kafe.com.tr' })).statusCode).toBe(404);
  });

  it('a code works once', async () => {
    await call('/auth/email/start', { email: 'tek@kafe.com.tr' });
    const code = lastCode('tek@kafe.com.tr');
    expect((await call('/auth/email/verify', { email: 'tek@kafe.com.tr', code })).status).toBe(200);
    expect((await call('/auth/email/verify', { email: 'tek@kafe.com.tr', code })).status).toBe(401);
  });

  it('a code expires after 10 minutes', async () => {
    await call('/auth/email/start', { email: 'sure@kafe.com.tr' });
    const code = lastCode('sure@kafe.com.tr');
    const row = (await env.ownerDb.query(`SELECT created_at, expires_at FROM login_challenges WHERE email = 'sure@kafe.com.tr'`)).rows[0];
    expect((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 60_000).toBeCloseTo(10, 0);
    await env.ownerDb.query(`UPDATE login_challenges SET expires_at = now() - interval '1 second' WHERE email = 'sure@kafe.com.tr'`);
    const r = await call('/auth/email/verify', { email: 'sure@kafe.com.tr', code });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('CODE_INVALID');
  });

  it('five wrong attempts lock the code, even the right one afterwards', async () => {
    await call('/auth/email/start', { email: 'deneme@kafe.com.tr' });
    const code = lastCode('deneme@kafe.com.tr');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await call('/auth/email/verify', { email: 'deneme@kafe.com.tr', code: wrong })).status).toBe(401);
    expect((await call('/auth/email/verify', { email: 'deneme@kafe.com.tr', code })).status).toBe(429);
  });

  it('a newer code replaces the older one', async () => {
    await call('/auth/email/start', { email: 'yeni@kafe.com.tr' });
    const first = lastCode('yeni@kafe.com.tr');
    await call('/auth/email/start', { email: 'yeni@kafe.com.tr' });
    const second = lastCode('yeni@kafe.com.tr');
    if (first !== second) expect((await call('/auth/email/verify', { email: 'yeni@kafe.com.tr', code: first })).status).toBe(401);
    expect((await call('/auth/email/verify', { email: 'yeni@kafe.com.tr', code: second })).status).toBe(200);
  });

  it('when the provider refuses, the user gets a 503 and no detail leaks', async () => {
    const bad = fakeSmtp({ rejectRcpt: true }); const port = await bad.listen();
    const badLogs: Record<string, unknown>[] = [];
    const badApp = buildApp({ db: env.db, store: env.store, log: l => badLogs.push(l),
      mailer: new SmtpMailer({ host: '127.0.0.1', port, security: 'starttls', from: 'giris@ornek.com.tr', insecureTls: true }, l => badLogs.push(l)),
      config: { demoMode: false, allowExampleRules: false, maxUploadBytes: 1024 * 1024, mfaEncryptionKey: null, mfaRequiredForPlatform: true } });
    try {
      const r = await badApp.inject({ method: 'POST', url: '/auth/email/start', payload: { email: 'yok@kafe.com.tr' } });
      expect(r.statusCode).toBe(503);
      expect(r.json().error.code).toBe('MAIL_UNAVAILABLE');
      expect(badLogs.find(l => l.event === 'mail_failed')).toMatchObject({ to: 'y***@k***.com.tr', reason: 'SMTP sunucusu 550 döndü (beklenen 250).' });
      expect(JSON.stringify(badLogs)).not.toContain('yok@kafe.com.tr');
    } finally { await badApp.close(); bad.server.close(); }
  });

  it('logs never contain codes, session tokens or full addresses', async () => {
    logs.length = 0;
    await call('/auth/email/start', { email: 'gunluk@kafe.com.tr' });
    const code = lastCode('gunluk@kafe.com.tr');
    await call('/auth/email/verify', { email: 'gunluk@kafe.com.tr', code: code === '999999' ? '888888' : '999999' });
    const ok = await call('/auth/email/verify', { email: 'gunluk@kafe.com.tr', code });
    const text = JSON.stringify(logs);
    expect(logs.some(l => l.route === '/auth/email/verify' && l.status === 401)).toBe(true);
    expect(logs.some(l => l.event === 'mail_sent')).toBe(true);
    expect(text).not.toContain(code);
    expect(text).not.toContain(ok.body.token);
    expect(text).not.toContain('gunluk@kafe.com.tr');
  });

  it('/env says SMTP is not production-ready until a person confirms a real delivery', async () => {
    expect((await app.inject({ method: 'GET', url: '/env' })).json()).toMatchObject({ mode: 'pilot', mailTransport: 'smtp', mailProductionReady: false });
  });
});

describe('dev outbox stays the default', () => {
  it('/env reports dev_outbox and not production-ready', async () => {
    const env = await freshEnv();
    try { expect((await client(env, '').get('/env')).body).toMatchObject({ mailTransport: 'dev_outbox', mailProductionReady: false }); }
    finally { await env.close(); }
  });
});
