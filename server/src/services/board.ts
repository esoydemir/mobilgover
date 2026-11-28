import type { Tx } from '../db/pool';
import { conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { listDocuments } from './documents';
import { currentObligations } from './obligations';
import { equipmentGaps, topUpSite } from './tasks';

/**
 * Manager board (6B): what needs a manager today, in a fixed, explained order. Every count is the
 * length of the list next to it, so a tapped number always opens exactly those records.
 * Repeat candidates are suggested from structure (same site, same topic, same equipment, same
 * verified root cause) with the reasons written out; a manager links or dismisses a pair. Nothing
 * is merged and no case changes. Indicators say what they are counted over and when data is short.
 * Nothing here is a score, ranking or penalty.
 */
export const PRIORITY = [
  { key: 'critical', label: 'Açık kritik ve yüksek riskler', why: 'Kişi ya da gıda güvenliği için en yakın tehlike.' },
  { key: 'overdueActions', label: 'Geciken aksiyonlar', why: 'Termini geçen işler riski açık tutar.' },
  { key: 'awaitingVerification', label: 'Doğrulama bekleyenler', why: 'Yapıldı denen işler doğrulanmadıkça sonuç sayılmaz.' },
  { key: 'documents', label: 'Süresi dolan ve yaklaşan belgeler', why: 'Süresi dolan belge geçerli sayılmaz.' },
  { key: 'repeats', label: 'Tekrar adayları', why: 'Aynı sorun yeniden görüldüyse önceki çözüm kalıcı olmamış olabilir.' },
] as const;

export type BoardFilter = { siteId?: string | null; from?: string | null; to?: string | null; hazard?: string | null; equipmentId?: string | null; ownerId?: string | null };
const CAUSE_TR: Record<string, string> = { knowledge: 'bilgi eksikliği', equipment: 'ekipman eksikliği', resource: 'kaynak eksikliği', process: 'süreç eksikliği' };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const days = (a: string | Date, b: string | Date) => Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 86400_000) * 10) / 10;

/** Sites this person may see on the board. */
async function visibleSites(tx: Tx, p: Principal, companyId: string) {
  const sites = (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM sites WHERE company_id = $1 ORDER BY created_at`, [companyId])).rows;
  return sites.filter(s => can(p, 'indicators.read', { companyId, siteId: s.id }).ok);
}

async function casesInScope(tx: Tx, p: Principal, companyId: string, f: BoardFilter, siteIds: string[]) {
  const rows = (await tx.query(`SELECT n.id, n.site_id, s.name AS site_name, n.title, n.status, n.risk_level, n.hazard_type, n.equipment_id, e.name AS equipment_name,
       n.owner_id, u.display_name AS owner_name, n.detected_at, n.closed_at, n.due_at, n.iteration,
       (SELECT c.categories FROM ncr_cause_assessments c WHERE c.ncr_id = n.id AND c.stage = 'verified' ORDER BY c.done_at DESC LIMIT 1) AS verified_cause
     FROM nonconformities n JOIN sites s ON s.id = n.site_id LEFT JOIN equipment e ON e.id = n.equipment_id LEFT JOIN users u ON u.id = n.owner_id
    WHERE n.company_id = $1 AND n.site_id = ANY($2)
      AND ($3::text IS NULL OR n.hazard_type = $3) AND ($4::uuid IS NULL OR n.equipment_id = $4) AND ($5::uuid IS NULL OR n.owner_id = $5)
    ORDER BY n.detected_at DESC`, [companyId, siteIds, f.hazard ?? null, f.equipmentId ?? null, f.ownerId ?? null])).rows;
  return rows.filter(r => can(p, 'ncr.read', { companyId, siteId: r.site_id, recordId: r.id }).ok);
}

const inRange = (d: string | Date, f: BoardFilter) => (!f.from || new Date(d) >= new Date(f.from)) && (!f.to || new Date(d) < new Date(f.to));

export async function board(tx: Tx, p: Principal, companyId: string, f: BoardFilter) {
  const sites = await visibleSites(tx, p, companyId);
  if (!sites.length) return myWork(tx, p, companyId);
  if (f.siteId && !sites.some(s => s.id === f.siteId)) throw notFound('Şube');
  const siteIds = f.siteId ? [f.siteId] : sites.map(s => s.id);
  const all = await casesInScope(tx, p, companyId, f, siteIds);
  const open = all.filter(n => n.status !== 'closed');
  const now = new Date();
  const ref = (n: any) => ({ id: n.id, title: n.title, site: n.site_name, risk: n.risk_level, owner: n.owner_name, detectedAt: n.detected_at, ageDays: days(n.detected_at, now) });

  const critical = open.filter(n => (n.risk_level === 'critical' || n.risk_level === 'high') && inRange(n.detected_at, f))
    .sort((a, b) => (a.risk_level === 'critical' ? 0 : 1) - (b.risk_level === 'critical' ? 0 : 1) || +new Date(a.detected_at) - +new Date(b.detected_at)).map(ref);

  const openIds = open.map(n => n.id);
  const overdueActions = openIds.length ? (await tx.query(`SELECT a.id, a.ncr_id, a.description, a.due_at, u.display_name AS owner_name, n.title AS ncr_title, s.name AS site_name
     FROM ncr_actions a JOIN nonconformities n ON n.id = a.ncr_id JOIN sites s ON s.id = n.site_id LEFT JOIN users u ON u.id = a.owner_id
    WHERE a.ncr_id = ANY($1) AND a.status = 'open' AND a.due_at < now() AND ($2::uuid IS NULL OR a.owner_id = $2 OR n.owner_id = $2) ORDER BY a.due_at`, [openIds, f.ownerId ?? null])).rows
    .map(a => ({ id: a.id, ncrId: a.ncr_id, description: a.description, ncrTitle: a.ncr_title, site: a.site_name, owner: a.owner_name, dueAt: a.due_at, lateDays: days(a.due_at, now) })) : [];

  const declared = openIds.length ? (await tx.query(`SELECT a.ncr_id, count(*)::int AS n FROM ncr_actions a WHERE a.ncr_id = ANY($1) AND a.status = 'done'
       AND (a.verification_status = 'declared' OR a.verification_status = 'legacy') GROUP BY a.ncr_id`, [openIds])).rows : [];
  const awaitingVerification = open.filter(n => n.status === 'awaiting_verification' || declared.some(d => d.ncr_id === n.id)).map(n => ({ ...ref(n),
    what: n.status === 'awaiting_verification' ? 'Kapanış doğrulaması' : `${declared.find(d => d.ncr_id === n.id)!.n} aksiyon beyanı` }));

  // Company-wide documents are listed too (they apply to every site).
  const docs = (await listDocuments(tx, p, companyId, {})).filter(d =>
    (d.siteId == null || siteIds.includes(d.siteId)) && (!f.equipmentId || d.equipmentId === f.equipmentId) && (d.status === 'expired' || d.expiring));
  const documents = docs.map(d => ({ id: d.id, title: d.title, site: d.siteName ?? 'Tüm işletme', status: d.status, expiring: d.expiring, validUntil: d.validUntil }))
    .sort((a, b) => (a.status === 'expired' ? 0 : 1) - (b.status === 'expired' ? 0 : 1) || String(a.validUntil).localeCompare(String(b.validUntil)));

  const repeats = await repeatCandidates(tx, all, f);
  const indicators = measures(all, repeats.pairs, f, await verifiedActions(tx, all.map(n => n.id)));
  const comparison = sites.length > 1 && !f.siteId ? await compareSites(tx, p, companyId, sites, f) : null;

  // Filter choices come from what this person can see.
  const choices = {
    sites,
    hazards: [...new Set(all.map(n => n.hazard_type))],
    equipment: [...new Map(all.filter(n => n.equipment_id).map(n => [n.equipment_id, { id: n.equipment_id, name: n.equipment_name, site: n.site_name }])).values()],
    owners: [...new Map(all.filter(n => n.owner_id).map(n => [n.owner_id, { id: n.owner_id, name: n.owner_name }])).values()],
  };
  return {
    scope: 'manager', priority: PRIORITY, filter: f, choices,
    sections: { critical, overdueActions, awaitingVerification, documents, repeats: repeats.list, gaps: await equipmentGaps(tx, companyId, siteIds) },
    indicators, comparison,
    note: 'Bu ekran puan, sıralama ya da ceza değildir; bugün müdahale gereken işleri gösterir.',
  };
}

/** Staff: only work assigned to them. */
async function myWork(tx: Tx, p: Principal, companyId: string) {
  if (!p.memberships.some(m => m.companyId === companyId) && !p.grants.some(g => g.companyId === companyId)) throw forbidden();
  const actions = (await tx.query(`SELECT a.id, a.ncr_id, a.description, a.due_at, (a.due_at < now()) AS overdue, n.title AS ncr_title FROM ncr_actions a
     JOIN nonconformities n ON n.id = a.ncr_id WHERE a.company_id = $1 AND a.owner_id = $2 AND a.status = 'open' AND n.status <> 'closed' ORDER BY a.due_at NULLS LAST`, [companyId, p.userId])).rows;
  const tasks = (await tx.query(`SELECT t.id, tt.title, t.due_at, (t.due_at < now()) AS overdue FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     WHERE t.company_id = $1 AND t.assignee_id = $2 AND t.status = 'open' AND t.due_at < now() + interval '1 day' ORDER BY t.due_at LIMIT 50`, [companyId, p.userId])).rows;
  const cases = (await tx.query(`SELECT id, title, risk_level, status FROM nonconformities WHERE company_id = $1 AND owner_id = $2 AND status <> 'closed'`, [companyId, p.userId])).rows;
  return { scope: 'mine', sections: { actions, tasks, cases }, note: 'Yalnız sana atanmış işler.' };
}

/**
 * Repeat candidates: a later case at the same site with an earlier one on the same topic and either
 * the same equipment or the same verified root cause. The reasons are listed. A pair a manager
 * marked "unrelated" is left out; a linked pair is shown as linked.
 */
async function repeatCandidates(tx: Tx, cases: any[], f: BoardFilter) {
  const ids = cases.map(c => c.id);
  const decisions = ids.length ? (await tx.query(`SELECT DISTINCT ON (ncr_id, related_ncr_id) ncr_id, related_ncr_id, decision, reason, decided_at, u.display_name AS by
     FROM ncr_relations r JOIN users u ON u.id = r.decided_by WHERE r.ncr_id = ANY($1) ORDER BY ncr_id, related_ncr_id, decided_at DESC`, [ids])).rows : [];
  const actions = ids.length ? (await tx.query(`SELECT ncr_id, iteration, kind, description, verification_status FROM ncr_actions WHERE ncr_id = ANY($1) AND status <> 'cancelled' ORDER BY created_at`, [ids])).rows : [];
  const pairs: any[] = [];
  for (const later of cases) {
    if (!inRange(later.detected_at, f)) continue;
    for (const earlier of cases) {
      if (earlier.id === later.id || new Date(earlier.detected_at) >= new Date(later.detected_at) || earlier.site_id !== later.site_id) continue;
      const dec = decisions.find(d => d.ncr_id === later.id && d.related_ncr_id === earlier.id);
      if (dec?.decision === 'unrelated') continue;
      const reasons: string[] = [];
      const sameEquipment = !!later.equipment_id && later.equipment_id === earlier.equipment_id;
      const sameTopic = later.hazard_type === earlier.hazard_type;
      const commonCause = (later.verified_cause ?? []).filter((c: string) => (earlier.verified_cause ?? []).includes(c));
      if (sameEquipment) reasons.push(`aynı ekipman (${later.equipment_name})`);
      if (sameTopic) reasons.push('aynı konu');
      if (commonCause.length) reasons.push(`aynı doğrulanmış kök neden (${commonCause.map((c: string) => CAUSE_TR[c] ?? c).join(', ')})`);
      reasons.push('aynı şube');
      if (!dec && !(sameTopic && (sameEquipment || commonCause.length))) continue;
      pairs.push({
        id: `${later.id}:${earlier.id}`, later: { id: later.id, title: later.title, detectedAt: later.detected_at, status: later.status, site: later.site_name },
        earlier: { id: earlier.id, title: earlier.title, detectedAt: earlier.detected_at, closedAt: earlier.closed_at, status: earlier.status },
        daysSinceClosure: earlier.closed_at ? days(earlier.closed_at, later.detected_at) : null,
        earlierActions: actions.filter(a => a.ncr_id === earlier.id).map(a => ({ kind: a.kind, description: a.description, verified: a.verification_status === 'verified' })),
        reasons, decision: dec ? { decision: dec.decision, reason: dec.reason, by: dec.by, at: dec.decided_at } : null,
      });
    }
  }
  // Each later case once, with its nearest earlier candidate first.
  pairs.sort((a, b) => +new Date(b.later.detectedAt) - +new Date(a.later.detectedAt) || +new Date(b.earlier.detectedAt) - +new Date(a.earlier.detectedAt));
  const seen = new Set<string>();
  const list = pairs.filter(x => (seen.has(x.later.id) ? false : (seen.add(x.later.id), true)));
  return { pairs, list };
}

async function verifiedActions(tx: Tx, ids: string[]) {
  if (!ids.length) return { verified: 0, effective: 0 };
  const r = (await tx.query(`SELECT count(*)::int AS verified,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ncr_verifications v WHERE v.ncr_id = a.ncr_id AND v.iteration = a.iteration AND v.result = 'effective'))::int AS effective
     FROM ncr_actions a WHERE a.ncr_id = ANY($1) AND a.status = 'done' AND a.verification_status = 'verified' AND a.kind <> 'follow_up'`, [ids])).rows[0];
  return { verified: r.verified as number, effective: r.effective as number };
}

/** First-version indicators. Each says what it counts over; short data gets a note, not a guess. */
function measures(all: any[], pairs: any[], f: BoardFilter, acts: { verified: number; effective: number }) {
  const period = { from: f.from ?? null, to: f.to ?? null };
  const reappear = pairs.filter(x => x.daysSinceClosure != null && x.daysSinceClosure >= 0).map(x => x.daysSinceClosure as number);
  const closed = all.filter(n => n.closed_at && inRange(n.detected_at, f));
  const openDur = closed.map(n => days(n.detected_at, n.closed_at));
  const stillOpen = all.filter(n => n.status !== 'closed' && inRange(n.detected_at, f));
  const short = (n: number, min: number) => (n === 0 ? 'Bu aralıkta veri yok.' : n < min ? `Yalnız ${n} kayıt var; eğilim için az.` : null);
  return [
    { key: 'reappearDays', label: 'Kapanıştan sonra yeniden görülme süresi (medyan, gün)', value: median(reappear), denominator: reappear.length,
      basis: 'Tekrar adayı ya da ilişkilendirilmiş çiftlerde önceki kaydın kapanışından yeni kaydın tespitine.', note: short(reappear.length, 3), period },
    { key: 'openDays', label: 'Açık kalma süresi (kapananlar, medyan, gün)', value: median(openDur), denominator: openDur.length,
      basis: `Tespitten doğrulanmış kapanışa. Hâlâ açık ${stillOpen.length} kayıt bu sayıya girmez.`, note: short(openDur.length, 3), period },
    { key: 'effectiveActions', label: 'Etkinliği doğrulanmış aksiyonlar', value: acts.effective, denominator: acts.verified,
      basis: 'Doğrulanmış aksiyonlardan, aynı turu "etkili" doğrulamasıyla kapananlar. Takip aksiyonları sayılmaz.', note: short(acts.verified, 3), period },
  ];
}

/** HQ: the same counts per site, side by side. No ranking or score. */
async function compareSites(tx: Tx, p: Principal, companyId: string, sites: { id: string; name: string }[], f: BoardFilter) {
  const out = [];
  for (const s of sites) {
    const cases = await casesInScope(tx, p, companyId, { ...f, siteId: s.id }, [s.id]);
    const open = cases.filter(n => n.status !== 'closed');
    const overdue = open.length ? (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ncr_actions WHERE ncr_id = ANY($1) AND status = 'open' AND due_at < now()`, [open.map(n => n.id)])).rows[0]!.n : 0;
    const rep = await repeatCandidates(tx, cases, f);
    const closedDur = cases.filter(n => n.closed_at && inRange(n.detected_at, f)).map(n => days(n.detected_at, n.closed_at));
    // "Checked and fine" is not the same as "not checked yet": a branch with no cases may simply have skipped its checks.
    // Counted: tasks already due, checks done early, and (separately) today's checks that are still waiting for their hour.
    const since = f.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const c = (await tx.query<{ ok: number; bad: number; open_late: number; missed: number; pending: number }>(
      `SELECT count(*) FILTER (WHERE status = 'done' AND outcome = 'conforming')::int AS ok, count(*) FILTER (WHERE status = 'done' AND outcome = 'nonconforming')::int AS bad,
              count(*) FILTER (WHERE status = 'open' AND due_at < now())::int AS open_late, count(*) FILTER (WHERE status = 'missed')::int AS missed,
              count(*) FILTER (WHERE status = 'open' AND due_at >= now())::int AS pending
         FROM tasks WHERE company_id = $1 AND site_id = $2 AND due_at >= $3 AND status <> 'cancelled'
          AND (status = 'done' OR due_at < (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + interval '1 day') AT TIME ZONE 'Europe/Istanbul')`, [companyId, s.id, since])).rows[0]!;
    const notChecked = c.open_late + c.missed, due = c.ok + c.bad + notChecked;
    // A site that never answered its profile has no checks generated at all: that is "unknown", not "nothing to check".
    const waitingInfo = (await currentObligations(tx, companyId, s.id)).filter((o: any) => o.decision === 'needs_info').length;
    out.push({ controls: { checkedOk: c.ok, checkedNonconforming: c.bad, notChecked, due, pendingToday: c.pending, since, waitingInfo }, siteId: s.id, site: s.name, critical: open.filter(n => n.risk_level === 'critical' || n.risk_level === 'high').length, overdueActions: overdue,
      awaitingVerification: open.filter(n => n.status === 'awaiting_verification').length, repeats: rep.list.length,
      openDaysMedian: median(closedDur), closedCount: closedDur.length });
  }
  return { sites: out, note: 'Şubeler yan yana gösterilir; bu bir sıralama ya da puan değildir. Kapanan kayıt azsa medyan yanıltıcı olabilir.' };
}

/** Link two cases as the same problem seen again, or mark a suggested pair unrelated. Nothing is merged. */
export async function relate(tx: Tx, p: Principal, companyId: string, ncrId: string, b: { relatedId: string; decision: 'linked' | 'unrelated'; reason: string }) {
  if (ncrId === b.relatedId) throw invalid('Bir kayıt kendisiyle ilişkilendirilemez.');
  const rows = (await tx.query(`SELECT id, site_id FROM nonconformities WHERE company_id = $1 AND id = ANY($2)`, [companyId, [ncrId, b.relatedId]])).rows;
  if (rows.length !== 2 || rows.some(r => !can(p, 'ncr.manage', { companyId, siteId: r.site_id, recordId: r.id }).ok)) throw notFound('Uygunsuzluk');
  if (b.reason.trim().length < 10) throw invalid('Gerekçeyi yaz (en az bir cümle).');
  const last = (await tx.query(`SELECT decision FROM ncr_relations WHERE ncr_id = $1 AND related_ncr_id = $2 ORDER BY decided_at DESC LIMIT 1`, [ncrId, b.relatedId])).rows[0];
  if (last?.decision === b.decision) throw conflict('ALREADY_DECIDED', b.decision === 'linked' ? 'Bu kayıtlar zaten ilişkilendirilmiş.' : 'Bu çift zaten ilgisiz işaretlenmiş.');
  await tx.query(`INSERT INTO ncr_relations (company_id, ncr_id, related_ncr_id, decision, reason, decided_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [companyId, ncrId, b.relatedId, b.decision, b.reason.trim(), p.userId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: b.decision === 'linked' ? 'nonconformity.related' : 'nonconformity.marked_unrelated',
    entityType: 'nonconformity', entityId: ncrId, payload: { relatedId: b.relatedId, reason: b.reason.trim() } });
  return { decision: b.decision };
}

/** A new site; the people who manage the whole business manage it. */
export async function addSite(tx: Tx, p: Principal, companyId: string, b: { name: string }) {
  if (!can(p, 'members.manage', { companyId }).ok) throw forbidden('Şubeyi işletme sahibi ya da merkez yöneticisi ekler.');
  const name = b.name.trim();
  if (name.length < 2) throw invalid('Şube adını yaz.');
  if ((await tx.query(`SELECT 1 FROM sites WHERE company_id = $1 AND lower(name) = lower($2)`, [companyId, name])).rowCount) throw conflict('SITE_EXISTS', 'Bu adla bir şube zaten var.');
  const s = (await tx.query<{ id: string }>(`INSERT INTO sites (company_id, name, timezone) VALUES ($1,$2,'Europe/Istanbul') RETURNING id`, [companyId, name])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'site.added', entityType: 'site', entityId: s.id, payload: { name } });
  // Decisions for the new site start right away (company-level answers apply; site-level ones show as "needs information"),
  // and any check that already applies gets its tasks. What is still missing is visible on the obligations list.
  const filled = await topUpSite(tx, companyId, s.id, 14, p.userId);
  return { id: s.id, createdTasks: filled.created };
}

/** What keeps obligations from becoming work, for the sites this person manages (see equipmentGaps). Staff see none. */
export async function gapsFor(tx: Tx, p: Principal, companyId: string, siteId?: string | null) {
  const sites = (await visibleSites(tx, p, companyId)).filter(s => !siteId || s.id === siteId);
  if (!sites.length) return [];
  return equipmentGaps(tx, companyId, sites.map(s => s.id));
}
