import type { Db, Tx } from '../db/pool';
import { can, type Principal } from '../domain/permissions';

/**
 * In-app notifications. A notification is identified per recipient by a dedupe key, so
 * the same event never produces a second copy (retries, hourly scans, repeated saves).
 * Recipients must be active members whose role covers the site; a notification is shown
 * only while the recipient can still open the thing it points to.
 */
export type NotificationInput = {
  companyId: string; siteId: string | null; userIds: (string | null | undefined)[];
  kind: string; entityType: string; entityId: string; title: string; body: string; dedupeKey: string;
  /** Do not notify the person who caused the event. */
  except?: string | null;
};

export async function notify(tx: Tx, n: NotificationInput): Promise<number> {
  const ids = [...new Set(n.userIds.filter((u): u is string => !!u && u !== n.except))];
  if (!ids.length) return 0;
  // Only active members of this company whose membership covers the site.
  const active = (await tx.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM memberships
      WHERE company_id = $1 AND user_id = ANY($2) AND status = 'active' AND (site_id IS NULL OR $3::uuid IS NULL OR site_id = $3)
     UNION
     SELECT DISTINCT user_id FROM access_grants
      WHERE company_id = $1 AND user_id = ANY($2) AND revoked_at IS NULL AND expires_at > now()`,
    [n.companyId, ids, n.siteId])).rows.map(r => r.user_id);
  let created = 0;
  for (const u of active) {
    const r = await tx.query(
      `INSERT INTO notifications (company_id, site_id, user_id, kind, entity_type, entity_id, title, body, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [n.companyId, n.siteId, u, n.kind, n.entityType, n.entityId, n.title, n.body, n.dedupeKey]);
    created += r.rowCount ?? 0;
  }
  return created;
}

/** Active people who manage work at a site: owner and HQ manager (company-wide) and that site's manager. */
export async function siteManagers(tx: Tx, companyId: string, siteId: string): Promise<string[]> {
  return (await tx.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM memberships
      WHERE company_id = $1 AND status = 'active'
        AND ((site_id IS NULL AND role IN ('owner','hq_manager')) OR (site_id = $2 AND role = 'site_manager'))`,
    [companyId, siteId])).rows.map(r => r.user_id);
}

/** Inbox for one company. Items the user can no longer open (role or site changed, reassigned) are left out. */
export async function listNotifications(tx: Tx, p: Principal, companyId: string, limit = 50) {
  const rows = (await tx.query(
    `SELECT n.id, n.kind, n.entity_type, n.entity_id, n.title, n.body, n.created_at, n.read_at, n.site_id,
            nc.owner_id AS ncr_owner, nc.site_id AS ncr_site,
            EXISTS (SELECT 1 FROM ncr_actions a WHERE a.ncr_id = nc.id AND a.owner_id = $2) AS ncr_action_owner
       FROM notifications n
       LEFT JOIN nonconformities nc ON n.entity_type = 'nonconformity' AND nc.id = n.entity_id
      WHERE n.company_id = $1 AND n.user_id = $2
      ORDER BY n.created_at DESC LIMIT $3`, [companyId, p.userId, limit])).rows;
  const visible = rows.filter(r => {
    if (r.entity_type === 'nonconformity') {
      if (!r.ncr_site) return false;
      const involved = r.ncr_owner === p.userId || r.ncr_action_owner;
      return can(p, 'ncr.read', { companyId, siteId: r.ncr_site, assigneeId: involved ? p.userId : r.ncr_owner }).ok;
    }
    if (r.entity_type === 'obligation') return can(p, 'obligation.read', { companyId, siteId: r.site_id }).ok;
    if (r.entity_type === 'membership') return can(p, 'ncr.manage', { companyId, siteId: r.site_id }).ok || can(p, 'members.manage', { companyId }).ok;
    return true;
  }).map(({ ncr_owner, ncr_site, ncr_action_owner, ...r }) => r);
  return { items: visible, unread: visible.filter(r => !r.read_at).length };
}

export async function markRead(tx: Tx, p: Principal, companyId: string, ids: string[] | 'all') {
  const r = ids === 'all'
    ? await tx.query(`UPDATE notifications SET read_at = now() WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL`, [companyId, p.userId])
    : await tx.query(`UPDATE notifications SET read_at = now() WHERE company_id = $1 AND user_id = $2 AND id = ANY($3) AND read_at IS NULL`, [companyId, p.userId, ids]);
  return { marked: r.rowCount ?? 0 };
}

const fmt = (d: Date) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Hourly scan: due soon (within 24 h) and overdue, for open nonconformities and open actions.
 * The dedupe key carries the due date, so each deadline is announced once; moving the
 * deadline announces the new one once.
 */
export async function scanDeadlines(db: Db, now = new Date()) {
  const companies = await db.system(async tx => (await tx.query<{ id: string }>(`SELECT id FROM companies`)).rows.map(r => r.id));
  let created = 0;
  for (const companyId of companies) {
    created += await db.tenant(companyId, async tx => {
      let c = 0;
      const ncrs = (await tx.query(
        `SELECT id, site_id, owner_id, title, due_at FROM nonconformities
          WHERE company_id = $1 AND status <> 'closed' AND due_at IS NOT NULL AND due_at < $2::timestamptz + interval '24 hours'`, [companyId, now.toISOString()])).rows;
      for (const n of ncrs) {
        const due = new Date(n.due_at);
        const overdue = due < now;
        const key = `${overdue ? 'ncr_overdue' : 'ncr_due_soon'}:${n.id}:${due.toISOString()}`;
        c += await notify(tx, {
          companyId, siteId: n.site_id, userIds: overdue ? [n.owner_id, ...(await siteManagers(tx, companyId, n.site_id))] : [n.owner_id],
          kind: overdue ? 'ncr_overdue' : 'ncr_due_soon', entityType: 'nonconformity', entityId: n.id, dedupeKey: key,
          title: overdue ? 'Uygunsuzluk termini geçti' : 'Uygunsuzluk termini yaklaşıyor', body: `${n.title} · termin ${fmt(due)}`,
        });
      }
      const actions = (await tx.query(
        `SELECT a.id, a.ncr_id, a.owner_id, a.description, a.due_at, nc.site_id, nc.owner_id AS ncr_owner FROM ncr_actions a JOIN nonconformities nc ON nc.id = a.ncr_id
          WHERE a.company_id = $1 AND a.status = 'open' AND nc.status <> 'closed' AND a.due_at IS NOT NULL AND a.due_at < $2::timestamptz + interval '24 hours'`,
        [companyId, now.toISOString()])).rows;
      for (const a of actions) {
        const due = new Date(a.due_at);
        const overdue = due < now;
        c += await notify(tx, {
          companyId, siteId: a.site_id, userIds: overdue ? [a.owner_id, a.ncr_owner] : [a.owner_id],
          kind: overdue ? 'action_overdue' : 'action_due_soon', entityType: 'nonconformity', entityId: a.ncr_id,
          dedupeKey: `${overdue ? 'action_overdue' : 'action_due_soon'}:${a.id}:${due.toISOString()}`,
          title: overdue ? 'Aksiyon termini geçti' : 'Aksiyon termini yaklaşıyor', body: `${a.description} · termin ${fmt(due)}`,
        });
      }
      return c;
    });
  }
  return { created };
}
