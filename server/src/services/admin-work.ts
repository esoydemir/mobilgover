import type { Principal } from '../domain/permissions';
import type { Tx } from '../db/pool';
import { forbidden } from '../domain/errors';
import { adminOverview, type LegislationConfig } from './legislation';

/**
 * Platform home: the work that is waiting for a decision, per area. Each area shows only to its own roles; the others come back as
 * `forbidden` (no permission), a failing area as `error` (could not be loaded) and an area without work as `ok` with zero items.
 * Every counter carries the link (path + filter) that opens exactly the records it counts.
 * Counters that cannot be derived reliably from stored data are listed in `missing`; they are never guessed.
 */
export type WorkItem = { id: string; kind: string; title: string; waitingMinutes: number; responsible: string; status: string; action: string; href: string };
export type Counter = { key: string; label: string; count: number; href: string };
export type Area = { area: 'legislation' | 'market' | 'moderation'; label: string; need: string; state: 'ok' | 'forbidden' | 'error'; message?: string; counters: Counter[]; items: WorkItem[]; total: number };

const mins = (t: Date | string | null, now: Date) => (t ? Math.max(0, Math.floor((now.getTime() - new Date(t).getTime()) / 60000)) : 0);
const has = (p: Principal, ...r: string[]) => r.some(x => (p.platformRoles as string[]).includes(x));
const ITEM_CAP = 25;

export async function adminWork(tx: Tx, p: Principal, cfg: LegislationConfig | undefined, now = new Date()) {
  if (!p.platformRoles.length) throw forbidden('Platform rolün yok.');
  const n = async (sql: string, a: unknown[] = []) => Number((await tx.query(sql, a)).rows[0]?.n ?? 0);
  const areas: Area[] = [];
  const guard = async (area: Area['area'], label: string, need: string, allowed: boolean, build: () => Promise<Pick<Area, 'counters' | 'items' | 'total'>>) => {
    if (!allowed) { areas.push({ area, label, need, state: 'forbidden', counters: [], items: [], total: 0 }); return; }
    try { areas.push({ area, label, need, state: 'ok', ...(await build()) }); }
    catch (e) { areas.push({ area, label, need, state: 'error', message: (e as Error).message || 'Yüklenemedi', counters: [], items: [], total: 0 }); }
  };

  await guard('legislation', 'Mevzuat', 'platform yöneticisi, kural yazarı ya da kural inceleyici', has(p, 'platform_admin', 'rule_author', 'rule_reviewer'), async () => {
    const open = `status IN ('pending','drafted')`;
    const rows = (await tx.query(`SELECT c.id, c.doc_title, c.status, c.detected_at, c.assigned_to, u.display_name AS assignee FROM legislation_changes c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.${open} ORDER BY c.detected_at LIMIT $1`, [ITEM_CAP])).rows;
    const ov = await adminOverview(tx, p, cfg);
    const bad = ov.sources.filter((s: any) => s.last_error);
    const unreadable = (ov.recentSkipped ?? []).filter((k: any) => k.status === 'unreadable').length;
    const items: WorkItem[] = [
      ...bad.map((s: any): WorkItem => ({ id: `src-${s.code}`, kind: 'source_error', title: `Kaynak okunamadı: ${s.name ?? s.code}`, waitingMinutes: mins(s.last_error_at ?? s.last_attempt_at, now), responsible: 'Platform yöneticisi', status: `Hata ${s.failures_in_row} kez üst üste`, action: 'Kaynak sağlığını aç', href: '/legislation?health=1' })),
      ...rows.map((r: any): WorkItem => ({ id: r.id, kind: 'legislation_change', title: r.doc_title, waitingMinutes: mins(r.detected_at, now), responsible: r.assignee ?? 'Sahipsiz', status: r.status === 'drafted' ? 'Onay bekliyor' : 'Öneri/taslak bekliyor',
        action: r.assigned_to ? 'İncele' : 'Ata ve incele', href: `/legislation?sel=${r.id}&quick=${r.assigned_to ? 'open' : 'unowned'}` })),
    ];
    const total = (await n(`SELECT count(*) AS n FROM legislation_changes WHERE ${open}`)) + bad.length;
    return { total, items, counters: [
      { key: 'leg_unowned', label: 'Sahipsiz yayın', count: await n(`SELECT count(*) AS n FROM legislation_changes WHERE ${open} AND assigned_to IS NULL`), href: '/legislation?quick=unowned' },
      { key: 'leg_review', label: 'İnceleyici bekleyen', count: await n(`SELECT count(*) AS n FROM legislation_changes WHERE status = 'drafted'`), href: '/legislation?quick=review' },
      { key: 'leg_uncertain', label: 'Eşleşmesi belirsiz', count: await n(`SELECT count(*) AS n FROM legislation_changes WHERE ${open} AND suggestion->>'matchLevel' = 'uncertain'`), href: '/legislation?quick=uncertain' },
      { key: 'leg_unreadable', label: 'Metni okunamadı', count: unreadable, href: '/legislation?quick=unreadable' },
      { key: 'leg_source_errors', label: 'Kaynak hatası', count: bad.length, href: '/legislation?health=1' },
      { key: 'leg_mine', label: 'Bana atanan', count: await n(`SELECT count(*) AS n FROM legislation_changes WHERE ${open} AND assigned_to = $1`, [p.userId]), href: '/legislation?quick=mine' },
    ] };
  });

  await guard('market', 'Pazar yeri', 'pazar yeri inceleyicisi', has(p, 'marketplace_reviewer'), async () => {
    const v = (await tx.query(`SELECT v.id, v.kind, v.submitted_at, pp.display_name FROM professional_verifications v JOIN professional_profiles pp ON pp.id = v.profile_id WHERE v.status = 'pending' ORDER BY v.submitted_at LIMIT $1`, [ITEM_CAP])).rows;
    const a = (await tx.query(`SELECT a.id, a.requested_at, pp.display_name, c.name AS category FROM service_authorizations a JOIN professional_profiles pp ON pp.id = a.profile_id JOIN service_categories c ON c.code = a.category_code WHERE a.status = 'pending' ORDER BY a.requested_at LIMIT $1`, [ITEM_CAP])).rows;
    const nv = await n(`SELECT count(*) AS n FROM professional_verifications WHERE status = 'pending'`), na = await n(`SELECT count(*) AS n FROM service_authorizations WHERE status = 'pending'`);
    const items: WorkItem[] = [
      ...v.map((r: any): WorkItem => ({ id: r.id, kind: 'verification', title: `${r.display_name} · ${r.kind === 'identity' ? 'kimlik' : r.kind === 'credential' ? 'yeterlilik belgesi' : 'işletme kaydı'}`, waitingMinutes: mins(r.submitted_at, now), responsible: 'Pazar yeri inceleyicisi (atanmadı)', status: 'Belge doğrulaması bekliyor', action: 'Doğrula ya da reddet', href: '/admin?list=verifications' })),
      ...a.map((r: any): WorkItem => ({ id: r.id, kind: 'authorization', title: `${r.display_name} · ${r.category}`, waitingMinutes: mins(r.requested_at, now), responsible: 'Pazar yeri inceleyicisi (atanmadı)', status: 'Kategori başvurusu bekliyor', action: 'Onayla ya da reddet', href: '/admin?list=authorizations' })),
    ];
    return { total: nv + na, items, counters: [
      { key: 'market_verifications', label: 'Belge doğrulaması bekleyen', count: nv, href: '/admin?list=verifications' },
      { key: 'market_authorizations', label: 'Kategori başvurusu bekleyen', count: na, href: '/admin?list=authorizations' },
    ] };
  });

  await guard('moderation', 'Moderasyon', 'ağ moderatörü', has(p, 'network_moderator'), async () => {
    const r = (await tx.query(`SELECT id, target_type, reason, created_at FROM network_reports WHERE status = 'open' ORDER BY created_at LIMIT $1`, [ITEM_CAP])).rows;
    const open = await n(`SELECT count(*) AS n FROM network_reports WHERE status = 'open'`);
    const T: Record<string, string> = { post: 'Paylaşım', comment: 'Yorum', profile: 'Profil' };
    return { total: open, counters: [{ key: 'mod_open', label: 'Açık şikâyet', count: open, href: '/moderation?status=open' }],
      items: r.map((x: any): WorkItem => ({ id: x.id, kind: 'network_report', title: `${T[x.target_type] ?? x.target_type} şikâyeti · ${x.reason}`, waitingMinutes: mins(x.created_at, now), responsible: 'Moderatör (atanmadı)', status: 'Karar bekliyor', action: 'Karara bağla', href: '/moderation?status=open' })) };
  });

  const missing = [
    { key: 'assignee_market', label: 'Pazar yeri başvurusunda sorumlu kişi', why: 'Başvurular kişiye atanmıyor; yalnız karar veren kaydediliyor. Satırlarda rol adı gösterilir.' },
    { key: 'assignee_moderation', label: 'Şikâyette sorumlu moderatör', why: 'Şikâyetler kişiye atanmıyor; yalnız karar veren kaydediliyor. Satırlarda rol adı gösterilir.' },
    { key: 'market_complaints', label: 'Pazar yeri hizmet şikâyetleri', why: 'Bu turun kapsamı dışında; ana sayfada sayılmıyor.' },
  ];
  return { generatedAt: now.toISOString(), yourRoles: p.platformRoles, areas, missing };
}
