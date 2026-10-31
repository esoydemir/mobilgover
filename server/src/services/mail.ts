import type { Db } from '../db/pool';

/**
 * Outgoing mail. Only the development outbox exists today: messages are stored
 * in `dev_mail_outbox` and never leave the server. A real transport (SMTP or a
 * provider API) is added once the Turkey-hosted mail provider is chosen.
 */
export interface Mailer {
  readonly kind: 'dev_outbox';
  send(to: string, subject: string, body: string): Promise<void>;
}

export class DevOutboxMailer implements Mailer {
  readonly kind = 'dev_outbox' as const;
  constructor(private readonly db: Db) {}
  async send(to: string, subject: string, body: string) {
    await this.db.system(tx => tx.query(`INSERT INTO dev_mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)`, [to, subject, body]));
  }
}
