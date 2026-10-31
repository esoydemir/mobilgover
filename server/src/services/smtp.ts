import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { Mailer } from './mail';

/*
 * Provider-independent SMTP sending. Every Turkey-hosted mail provider offers
 * SMTP, so choosing one later only means filling in host, port, user and
 * password. No third-party library: the client below speaks the small part of
 * SMTP needed to send one message (EHLO, STARTTLS / implicit TLS, AUTH PLAIN,
 * MAIL, RCPT, DATA, QUIT) and nothing else.
 *
 * Not production-ready until a real delivery through the chosen provider has
 * been confirmed (see MAIL_PRODUCTION_READY); the API reports this in /env.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  /** 'tls' = implicit TLS (465), 'starttls' = upgrade on 587, 'none' only for local tests. */
  security: 'tls' | 'starttls' | 'none';
  user?: string;
  pass?: string;
  from: string;
  /** Accept self-signed certificates (tests only). */
  insecureTls?: boolean;
  timeoutMs?: number;
};

export type MailLog = (line: Record<string, unknown>) => void;

/** e-posta → e***@a***.com.tr : enough to trace a delivery, not enough to read the address. */
export function maskEmail(e: string) {
  const [u = '', d = ''] = e.split('@');
  const [first = '', ...rest] = d.split('.');
  return `${u.slice(0, 1)}***@${first.slice(0, 1)}***${rest.length ? '.' + rest.join('.') : ''}`;
}

const CRLF = /[\r\n]/;
function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

export function buildMessage(from: string, to: string, subject: string, body: string, messageId: string) {
  if (CRLF.test(to) || CRLF.test(subject) || CRLF.test(from)) throw new Error('E-posta başlığında satır sonu olamaz.');
  const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64',
    '', b64,
  ].join('\r\n');
}

/** Minimal line-based SMTP conversation on one socket. */
class Conversation {
  private buf = '';
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];
  private error: Error | null = null;
  constructor(public sock: Socket | TLSSocket, private readonly timeoutMs: number) { this.attach(sock); }
  attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\r\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2);
        const w = this.waiters.shift();
        if (w) w(line); else this.lines.push(line);
      }
    });
    sock.on('error', e => { this.error = e; });
  }
  private nextLine(): Promise<string> {
    if (this.error) return Promise.reject(this.error);
    const l = this.lines.shift();
    if (l !== undefined) return Promise.resolve(l);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('SMTP sunucusu yanıt vermedi (zaman aşımı).')), this.timeoutMs);
      this.waiters.push(line => { clearTimeout(t); res(line); });
    });
  }
  /** Reads one (possibly multi-line) reply and checks its code. */
  async reply(expect: number): Promise<string[]> {
    const out: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      out.push(line);
      if (line.length < 4 || line[3] !== '-') break;
    }
    const code = Number(out.at(-1)!.slice(0, 3));
    // The server's text is not echoed: it can contain the recipient address.
    if (code !== expect) throw new Error(`SMTP sunucusu ${code} döndü (beklenen ${expect}).`);
    return out;
  }
  async cmd(line: string, expect: number) { this.sock.write(line + '\r\n'); return this.reply(expect); }
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  constructor(private readonly c: SmtpConfig, private readonly log: MailLog = () => {}) {
    if (c.security === 'none' && !c.insecureTls && !['127.0.0.1', 'localhost', '::1'].includes(c.host)) {
      throw new Error('Şifresiz SMTP yalnızca yerel testte kullanılabilir.');
    }
  }

  async send(to: string, subject: string, body: string) {
    const messageId = `<${randomBytes(12).toString('hex')}@${this.c.from.split('@')[1] ?? 'goverhub'}>`;
    const message = buildMessage(this.c.from, to, subject, body, messageId);
    const t0 = Date.now();
    const timeout = this.c.timeoutMs ?? 15_000;
    const tlsOpts = { servername: this.c.host, rejectUnauthorized: !this.c.insecureTls };
    const sock: Socket | TLSSocket = this.c.security === 'tls'
      ? tlsConnect({ host: this.c.host, port: this.c.port, ...tlsOpts })
      : netConnect({ host: this.c.host, port: this.c.port });
    const conv = new Conversation(sock, timeout);
    try {
      await conv.reply(220);
      const name = 'goverhub.local';
      let ehlo = await conv.cmd(`EHLO ${name}`, 250);
      if (this.c.security === 'starttls') {
        if (!ehlo.some(l => /STARTTLS/i.test(l))) throw new Error('SMTP sunucusu STARTTLS sunmuyor; şifresiz gönderim yapılmaz.');
        await conv.cmd('STARTTLS', 220);
        const secured = tlsConnect({ socket: sock as Socket, ...tlsOpts });
        await new Promise<void>((res, rej) => { secured.once('secureConnect', () => res()); secured.once('error', rej); });
        conv.attach(secured);
        ehlo = await conv.cmd(`EHLO ${name}`, 250);
      }
      if (this.c.user) {
        if (this.c.security === 'none' && !this.c.insecureTls) throw new Error('Kimlik bilgisi şifresiz bağlantıda gönderilmez.');
        await conv.cmd(`AUTH PLAIN ${Buffer.from(`\0${this.c.user}\0${this.c.pass ?? ''}`).toString('base64')}`, 235);
      }
      await conv.cmd(`MAIL FROM:<${this.c.from}>`, 250);
      await conv.cmd(`RCPT TO:<${to}>`, 250);
      await conv.cmd('DATA', 354);
      await conv.cmd(message.replace(/\r\n\./g, '\r\n..') + '\r\n.', 250);
      await conv.cmd('QUIT', 221).catch(() => undefined);
      this.log({ event: 'mail_sent', to: maskEmail(to), messageId, ms: Date.now() - t0 });
    } catch (e) {
      this.log({ event: 'mail_failed', to: maskEmail(to), messageId, reason: (e as Error).message });
      throw new Error('E-posta gönderilemedi.');
    } finally {
      conv.sock.destroy();
    }
  }
}
