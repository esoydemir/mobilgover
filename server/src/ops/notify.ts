import { hostname } from 'node:os';
import type { Mailer } from '../services/mail';

/**
 * Operational alerts (failed backup, failed integrity check, stale backup).
 * Messages never contain secrets, connection strings or personal data.
 */
export type Alert = { kind: 'backup_failed' | 'integrity_failed' | 'backup_stale' | 'backup_ok'; subject: string; details: string[] };

export interface Notifier { notify(a: Alert): Promise<void> }

/** Strips anything that looks like a credential before a message leaves the server. */
export function redact(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1***@')
    .replace(/(key|token|secret|password|parola)(["'\s:=]+)[^\s"',]+/gi, '$1$2***');
}

/** POSTs a JSON alert to a URL (chat webhook, on-call tool, monitoring). */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async notify(a: Alert) {
    const body = { ...a, subject: redact(a.subject), details: a.details.map(redact), host: hostname(), at: new Date().toISOString() };
    const r = await this.fetchImpl(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Bildirim adresi ${r.status} döndü.`);
  }
}

export class MailNotifier implements Notifier {
  constructor(private readonly mailer: Mailer, private readonly to: string[]) {}
  async notify(a: Alert) {
    for (const t of this.to) await this.mailer.send(t, `[GoverHub] ${redact(a.subject)}`, [redact(a.subject), '', ...a.details.map(redact), '', `Sunucu: ${hostname()}`].join('\n'));
  }
}

/** Sends to every channel; one failing channel does not stop the others. Returns the channels that failed. */
export async function notifyAll(channels: Notifier[], a: Alert, log: (m: string) => void = console.error): Promise<number> {
  let failed = 0;
  for (const c of channels) {
    try { await c.notify(a); } catch (e) { failed++; log(`bildirim gönderilemedi: ${redact((e as Error).message)}`); }
  }
  if (!channels.length) log(`UYARI: bildirim kanalı tanımlı değil — ${a.subject}`);
  return failed;
}
