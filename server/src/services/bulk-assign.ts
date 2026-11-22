import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { randomUUID } from 'node:crypto';
import { appendAudit } from './audit';
import { evidenceLabels, recordAssignments } from './task-assignment';

/**
 * Bulk task assignment. The preview names the sites and people the change would touch; applying needs the same scope plus the
 * task count the preview showed, so the person confirms exactly what they saw (a changed count means "look again").
 * Only open tasks that are not yet done are moved; sites the actor may not assign in, or where the person is not a member, are skipped and named.
 */
export type BulkScope = { userId: string; siteIds?: string[]; templateCode?: string; from: string; to: string; onlyUnassigned?: boolean };

export async function bulkAssignPreview(tx: Tx, p: Principal, companyId: string, s: BulkScope) {
  const assignee = (await tx.query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name FROM users u WHERE u.id = $1 AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.company_id = $2 AND m.status = 'active')`, [s.userId, companyId])).rows[0];
  if (!assignee) throw invalid('Bu kişi bu işletmede etkin üye değil.');
  // A person only ever sees the sites their own memberships reach; other sites are neither listed nor named.
  const reach = (siteId: string) => p.memberships.some(m => m.companyId === companyId && (!m.siteId || m.siteId === siteId));
  const sites = (await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM sites WHERE company_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY name`, [companyId, s.siteIds?.length ? s.siteIds : null])).rows
    .filter(x => reach(x.id));
  if (s.siteIds?.length && sites.length !== new Set(s.siteIds).size) throw invalid('Seçilen şubelerden biri bulunamadı ya da erişimin yok.');
  if (!sites.some(x => can(p, 'task.assign', { companyId, siteId: x.id }).ok)) throw forbidden('Görev atama yetkin yok.');
  const out: { siteId: string; siteName: string; eligible: boolean; reason: string | null; taskCount: number; replacing: { name: string; count: number }[]; unassigned: number;
    earliestDue: string | null; latestDue: string | null; requiredEvidence: string[] }[] = [];
  const prior: { id: string; site_id: string; assignee_id: string | null }[] = [];
  const taskIds: string[] = [];
  const losing = new Map<string, number>();
  for (const site of sites) {
    let reason: string | null = null;
    if (!can(p, 'task.assign', { companyId, siteId: site.id }).ok) reason = 'Bu şubede görev atama yetkin yok.';
    else if (!(await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND (site_id IS NULL OR site_id = $3)`, [s.userId, companyId, site.id])).rowCount)
      reason = `${assignee.display_name} bu şubede görev alamaz (üye değil ya da başka şubede).`;
    const rows = reason ? [] : (await tx.query<{ id: string; assignee_id: string | null; assignee_name: string | null; due_at: Date; evidence: unknown }>(
      `SELECT t.id, t.assignee_id, u.display_name AS assignee_name, t.due_at, tt.evidence FROM tasks t JOIN task_templates tt ON tt.id = t.template_id LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.company_id = $1 AND t.site_id = $2 AND t.status = 'open' AND t.due_at >= $3::timestamptz AND t.due_at < $4::timestamptz
          AND ($5::text IS NULL OR t.template_code = $5) AND t.assignee_id IS DISTINCT FROM $6
          AND (NOT $7::boolean OR t.assignee_id IS NULL)
        ORDER BY t.due_at`, [companyId, site.id, s.from, s.to, s.templateCode ?? null, s.userId, !!s.onlyUnassigned])).rows;
    const by = new Map<string, number>();
    let unassigned = 0;
    for (const r of rows) {
      taskIds.push(r.id);
      prior.push({ id: r.id, site_id: site.id, assignee_id: r.assignee_id });
      if (!r.assignee_id) unassigned++; else { by.set(r.assignee_name ?? '—', (by.get(r.assignee_name ?? '—') ?? 0) + 1); losing.set(r.assignee_name ?? '—', (losing.get(r.assignee_name ?? '—') ?? 0) + 1); }
    }
    out.push({ siteId: site.id, siteName: site.name, eligible: !reason, reason, taskCount: rows.length, unassigned,
      earliestDue: rows[0] ? new Date(rows[0].due_at).toISOString() : null, latestDue: rows.length ? new Date(rows[rows.length - 1]!.due_at).toISOString() : null,
      requiredEvidence: [...new Set(rows.flatMap(r => evidenceLabels(r.evidence)))],
      replacing: [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) });
  }
  return {
    assignee: { id: assignee.id, name: assignee.display_name },
    scope: { from: s.from, to: s.to, templateCode: s.templateCode ?? null, onlyUnassigned: !!s.onlyUnassigned },
    total: taskIds.length,
    sites: out,
    skippedSites: out.filter(x => !x.eligible).map(x => ({ siteId: x.siteId, siteName: x.siteName, reason: x.reason })),
    peopleLosingTasks: [...losing].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    taskIds, prior,
  };
}

export async function bulkAssignApply(tx: Tx, p: Principal, companyId: string, s: BulkScope & { expectedTotal: number; reason?: string | null }) {
  const pre = await bulkAssignPreview(tx, p, companyId, s);
  if (pre.total === 0) throw invalid('Atanacak açık görev yok.');
  if (pre.total !== s.expectedTotal) throw conflict('BULK_PREVIEW_STALE', `Etkilenecek görev sayısı değişti (gösterilen ${s.expectedTotal}, şimdi ${pre.total}). Önizlemeyi yenile.`, { total: pre.total });
  const batchKey = randomUUID();
  const r = await tx.query(`UPDATE tasks SET assignee_id = $3, assigned_by = $4, assigned_at = now() WHERE company_id = $1 AND id = ANY($2) AND status = 'open'`, [companyId, pre.taskIds, s.userId, p.userId]);
  await recordAssignments(tx, { companyId, actorId: p.userId, newId: s.userId, before: pre.prior, source: 'bulk', reason: s.reason ?? null, batchKey });
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'task.bulk_assigned', entityType: 'company', entityId: companyId,
    payload: { assigneeId: s.userId, count: r.rowCount, scope: pre.scope, reason: s.reason ?? null,
      sites: pre.sites.filter(x => x.taskCount).map(x => ({ siteId: x.siteId, count: x.taskCount })), skippedSites: pre.skippedSites.map(x => x.siteId) } });
  const { taskIds: _ids, prior: _prior, ...view } = pre;
  return { ...view, assigned: r.rowCount ?? 0 };
}
