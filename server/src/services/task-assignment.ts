import type { Tx } from '../db/pool';
import { evidenceRequirementSchema } from '../domain/evidence';
import { notify } from './notifications';

/**
 * GH-04: every change of the person responsible for a task is written to `task_assignment_log` (previous and new person, who changed
 * it, how) and announced to the new person once. The announcement answers three questions in fixed order:
 * what changed, which branch it concerns, by when and with what evidence. The task's period start and the moment of the announcement
 * are kept apart in `meta` (startsAt / announcedAt): being told about a task is not the day it starts.
 */
const KIND: Record<string, string> = { photo: 'fotoğraf', checklist: 'kontrol listesi', measurement: 'ölçüm', document: 'belge', note: 'not', approval: 'onay', device_record: 'cihaz kaydı' };
const fmt = (d: Date) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export type AssignedTask = { id: string; site_id: string; assignee_id: string | null };
export type TaskFacts = { id: string; site_id: string; title: string; due_at: Date | string; period_key: string; evidence: unknown; site_name: string };

export const evidenceLabels = (evidence: unknown): string[] => {
  const reqs = Array.isArray(evidence) ? evidence.map(x => evidenceRequirementSchema.safeParse(x)).flatMap(r => (r.success ? [r.data as { kind: string }] : [])) : [];
  return [...new Set(reqs.map(r => KIND[r.kind] ?? String(r.kind)))];
};

async function names(tx: Tx, ids: (string | null)[]) {
  const u = ids.filter((x): x is string => !!x);
  const rows = u.length ? (await tx.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE id = ANY($1)`, [u])).rows : [];
  return new Map(rows.map(r => [r.id, r.display_name]));
}

export async function loadTaskFacts(tx: Tx, companyId: string, ids: string[]): Promise<TaskFacts[]> {
  return (await tx.query<TaskFacts>(
    `SELECT t.id, t.site_id, tt.title, t.due_at, t.period_key, tt.evidence, s.name AS site_name
       FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN sites s ON s.company_id = t.company_id AND s.id = t.site_id
      WHERE t.company_id = $1 AND t.id = ANY($2) ORDER BY t.due_at`, [companyId, ids])).rows;
}

/** Writes the history rows and notifies. `before` is the state before the update; unchanged tasks are skipped. */
export async function recordAssignments(tx: Tx, o: {
  companyId: string; actorId: string; newId: string | null; before: AssignedTask[]; source: 'single' | 'series' | 'bulk'; reason?: string | null; batchKey: string;
}) {
  const changed = o.before.filter(t => t.assignee_id !== o.newId);
  if (!changed.length) return { changed: 0, notified: 0 };
  for (const t of changed) {
    await tx.query(`INSERT INTO task_assignment_log (company_id, site_id, task_id, previous_id, new_id, changed_by, source, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o.companyId, t.site_id, t.id, t.assignee_id, o.newId, o.actorId, o.source, o.reason ?? null]);
  }
  const facts = await loadTaskFacts(tx, o.companyId, changed.map(t => t.id));
  const who = await names(tx, [...changed.map(t => t.assignee_id), o.newId, o.actorId]);
  const prevName = (t: AssignedTask) => (t.assignee_id ? who.get(t.assignee_id) ?? 'önceki sorumlu' : 'kimse (atanmamıştı)');
  const announcedAt = new Date();
  let notified = 0;
  const bySite = new Map<string, TaskFacts[]>();
  for (const f of facts) bySite.set(f.site_id, [...(bySite.get(f.site_id) ?? []), f]);

  for (const [siteId, list] of bySite) {
    const first = list[0]!;
    if (o.newId) {
      const labels = evidenceLabels(first.evidence);
      const startsAt = /^\d{4}-\d{2}-\d{2}/.test(first.period_key) ? first.period_key.slice(0, 10) : null;
      const prev = changed.find(t => t.id === first.id)!;
      const single = list.length === 1;
      const lastDue = new Date(list[list.length - 1]!.due_at);
      const whatChanged = single ? `${first.title} görevi sana atandı (önceki sorumlu: ${prevName(prev)}).` : `${list.length} görev sana atandı.`;
      const meta = {
        whatChanged, branch: { id: siteId, name: first.site_name },
        deadline: new Date(first.due_at).toISOString(), lastDeadline: lastDue.toISOString(),
        requiredEvidence: labels, startsAt, announcedAt: announcedAt.toISOString(),
        assignedBy: who.get(o.actorId) ?? null, count: list.length, link: { type: single ? 'task' : 'tasks', id: single ? first.id : siteId },
      };
      const when = single ? `${fmt(new Date(first.due_at))} öncesinde` : `${fmt(new Date(first.due_at))} – ${fmt(lastDue)} arasında`;
      const body = [`Ne değişti? ${whatChanged}`, `Hangi şubemi etkiliyor? ${first.site_name}`,
        `Ne zamana kadar ne yapmalıyım? ${when}; ${labels.length ? `gerekli kanıt: ${labels.join(', ')}` : 'ek kanıt gerekmiyor'}.`].join('\n');
      // One notification per assignment event: the key carries the batch (a single assignment has its own batch).
      notified += await notify(tx, { companyId: o.companyId, siteId, userIds: [o.newId], except: o.actorId, kind: 'task_assigned', entityType: single ? 'task' : 'task_batch',
        entityId: single ? first.id : siteId, dedupeKey: `task_assigned:${o.batchKey}:${single ? first.id : siteId}:${o.newId}`,
        title: single ? `Yeni görev: ${first.title}` : `${list.length} yeni görev atandı`, body, meta });
    }
    // The person who lost the task is told too (once per batch).
    const losers = new Map<string, number>();
    for (const t of list) { const prev = changed.find(c => c.id === t.id)!; if (prev.assignee_id) losers.set(prev.assignee_id, (losers.get(prev.assignee_id) ?? 0) + 1); }
    for (const [uid, n] of losers) {
      const now = o.newId ? who.get(o.newId) ?? 'başka biri' : 'kimsede değil';
      notified += await notify(tx, { companyId: o.companyId, siteId, userIds: [uid], except: o.actorId, kind: 'task_unassigned', entityType: 'task_batch', entityId: siteId,
        dedupeKey: `task_unassigned:${o.batchKey}:${siteId}:${uid}`, title: n === 1 ? 'Bir görev senden alındı' : `${n} görev senden alındı`,
        body: `Ne değişti? ${n === 1 ? list[0]!.title : `${n} görev`} artık ${now}.\nHangi şubemi etkiliyor? ${first.site_name}\nNe zamana kadar ne yapmalıyım? Bir şey yapman gerekmiyor.`,
        meta: { branch: { id: siteId, name: first.site_name }, count: n, announcedAt: announcedAt.toISOString() } });
    }
  }
  return { changed: changed.length, notified };
}

export async function assignmentHistory(tx: Tx, companyId: string, taskId: string) {
  const rows = (await tx.query(
    `SELECT l.changed_at, l.source, l.reason, l.previous_id, l.new_id, l.changed_by,
            pu.display_name AS previous_name, nu.display_name AS new_name, cu.display_name AS changed_by_name
       FROM task_assignment_log l LEFT JOIN users pu ON pu.id = l.previous_id LEFT JOIN users nu ON nu.id = l.new_id LEFT JOIN users cu ON cu.id = l.changed_by
      WHERE l.company_id = $1 AND l.task_id = $2 ORDER BY l.changed_at, l.id`, [companyId, taskId])).rows;
  return rows.map(r => ({ at: r.changed_at, source: r.source, reason: r.reason,
    previous: r.previous_id ? { id: r.previous_id, name: r.previous_name } : null, current: r.new_id ? { id: r.new_id, name: r.new_name } : null,
    changedBy: { id: r.changed_by, name: r.changed_by_name } }));
}
