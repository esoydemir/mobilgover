import type { Db } from '../db/pool';

/**
 * Outgoing mail. `dev_outbox` stores messages in `dev_mail_outbox` (development
 * and demo only, never leaves the server). `smtp` (smtp.ts) sends through any
 * provider's SMTP service.
 */
export interface Mailer {
  readonly kind: 'dev_outbox' | 'smtp';
  send(to: string, subject: string, body: string): Promise<void>;
}

export class DevOutboxMailer implements Mailer {
  readonly kind = 'dev_outbox' as const;
  constructor(private readonly db: Db) {}
  async send(to: string, subject: string, body: string) {
    await this.db.system(tx => tx.query(`INSERT INTO dev_mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)`, [to, subject, body]));
  }
}
