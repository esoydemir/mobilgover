import type { Db } from '../db/pool';
import { scanDocumentExpiry } from './documents';
import { scanDeadlines } from './notifications';
import { topUpSite } from './tasks';

/**
 * Keeps every site's task list filled for the coming days. Runs when the API starts
 * and then periodically, so checks do not stop after the first week. Generation is
 * idempotent: it only adds missing tasks and never changes or removes existing ones.
 */
export async function topUpAllSites(db: Db, days: number, now = new Date()) {
  const sites = await db.system(async tx => (await tx.query<{ id: string; company_id: string; timezone: string }>(
    `SELECT s.id, s.company_id, s.timezone FROM sites s`)).rows);
  let created = 0;
  const failed: { siteId: string; error: string }[] = [];
  for (const s of sites) {
    try {
      // topUpSite also computes the decisions of a site that has none yet (e.g. added before they were computed for new sites).
      const r = await db.tenant(s.company_id, tx => topUpSite(tx, s.company_id, s.id, days, null, now));
      created += r.created;
    } catch (e) {
      failed.push({ siteId: s.id, error: (e as Error).message });
    }
  }
  return { sites: sites.length, created, failed };
}

/** Starts the periodic top-up. Returns a function that stops it. */
export function startTaskHorizon(db: Db, opts: { days: number; everyMs: number; log: (line: Record<string, unknown>) => void }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await topUpAllSites(db, opts.days);
      if (r.created || r.failed.length) opts.log({ level: r.failed.length ? 'warn' : 'info', event: 'task_horizon', days: opts.days, ...r });
      // Due-soon and overdue notifications (each deadline announced once).
      const n = await scanDeadlines(db);
      if (n.created) opts.log({ level: 'info', event: 'deadline_notifications', ...n });
      // Document end dates: a warning before, and a notice once passed (each once per version).
      const d = await scanDocumentExpiry(db);
      if (d.created) opts.log({ level: 'info', event: 'document_expiry_notifications', ...d });
    } catch (e) {
      opts.log({ level: 'error', event: 'task_horizon_failed', error: (e as Error).message });
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
