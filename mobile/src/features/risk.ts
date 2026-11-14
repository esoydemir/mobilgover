import type { Href } from 'expo-router';
import { useMemo } from 'react';
import { useSession } from '../api/session';
import type { Obligation, TaskRow } from '../api/types';
import { useApi } from '../api/useApi';
import { bucketTasks, taskWindowPath } from './work';
import { fmtDate } from './dates';

/**
 * Penalty and legal risk centre: every open item that can turn into a finding at an inspection, read from the real
 * records (open nonconformities, late checks, vault documents, obligations that wait for information).
 *
 * Penalty AMOUNTS are deliberately not computed: no verified penalty table exists in the product, and an invented
 * figure would be read as legal advice. The centre counts items and says so on screen (`PENALTY_NOTE`).
 */
export type RiskKind = 'ncr' | 'task' | 'doc' | 'info';
export type RiskSev = 'crit' | 'imp' | 'low';
export type RiskItem = {
  key: string; kind: RiskKind; sev: RiskSev; title: string; sub: string; basis: string;
  href: Href; /** Opens the service-request form prefilled; the market entry of this item. */ service?: Href;
  siteId: string | null; rank: number;
};
export type RiskFilter = 'all' | 'crit' | RiskKind;

export const RISK_FILTERS: [RiskFilter, string][] = [['all', 'Tümü'], ['crit', 'Kritik'], ['ncr', 'Uygunsuzluk'], ['task', 'Gecikmiş görev'], ['doc', 'Belge'], ['info', 'Bilgi eksik']];
export const isRiskFilter = (v: unknown): v is RiskFilter => RISK_FILTERS.some(([k]) => k === v);
export const KIND_LABEL: Record<RiskKind, string> = { ncr: 'UYGUNSUZLUK', task: 'GECİKMİŞ KONTROL', doc: 'BELGE', info: 'BİLGİ EKSİK' };
export const PENALTY_NOTE = 'Ceza tutarı hesaplanmadı: doğrulanmış bir ceza tablosu henüz yok ve uydurma tutar göstermiyoruz. Aşağıdaki sayı kalem sayısıdır, tutar değildir.';

type Ncr = { id: string; site_id?: string | null; title: string; risk_level: string; status: string; due_at: string | null };
type Doc = { id: string; title: string; siteId: string | null; status: string; expiring: boolean; validUntil: string | null; equipmentName: string | null };

const SEV_RANK: Record<RiskSev, number> = { crit: 0, imp: 1, low: 2 };
const svc = (title: string, ncrId?: string): Href => `/service/new?${ncrId ? `ncrId=${ncrId}&` : ''}title=${encodeURIComponent(title)}` as Href;

export function filterRisk(items: RiskItem[], f: RiskFilter) {
  return f === 'all' ? items : f === 'crit' ? items.filter(i => i.sev === 'crit') : items.filter(i => i.kind === f);
}
export function countRisk(items: RiskItem[]) {
  return Object.fromEntries(RISK_FILTERS.map(([k]) => [k, filterRisk(items, k).length])) as Record<RiskFilter, number>;
}

/** scope 'site' = the selected site (documents without a site count for every site); 'all' = every site the person may see. */
export function useRiskItems(scope: 'site' | 'all' = 'site') {
  const { company, siteId, role } = useSession();
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const base = company && manager ? `/companies/${company.id}` : null;
  const site = scope === 'site' ? siteId : null;
  const ncrs = useApi<Ncr[]>(base ? `${base}/nonconformities?status=open` : null);
  const tasks = useApi<TaskRow[]>(base && (scope === 'all' || siteId) ? taskWindowPath(base, site) : null);
  const docs = useApi<Doc[]>(base ? `${base}/documents` : null);
  const obls = useApi<Obligation[]>(base ? `${base}/obligations${site ? `?siteId=${site}` : ''}` : null);

  const sources = [ncrs, tasks, docs, obls];
  const items = useMemo<RiskItem[]>(() => {
    const out: RiskItem[] = [];
    for (const n of ncrs.data ?? []) {
      if (site && n.site_id && n.site_id !== site) continue;
      const sev: RiskSev = n.risk_level === 'high' || n.risk_level === 'critical' ? 'crit' : n.risk_level === 'medium' ? 'imp' : 'low';
      out.push({ key: `ncr-${n.id}`, kind: 'ncr', sev, title: n.title, basis: 'Açık uygunsuzluk kaydı', siteId: n.site_id ?? null,
        sub: n.due_at ? `Termin ${fmtDate(n.due_at)}${new Date(n.due_at) < new Date() ? ' · geçti' : ''}` : 'Terminsiz',
        href: `/ncr/${n.id}`, service: svc(n.title, n.id), rank: SEV_RANK[sev] });
    }
    for (const t of bucketTasks(tasks.data ?? []).late) {
      const sev: RiskSev = t.severity === 'critical' ? 'crit' : t.severity === 'major' ? 'imp' : 'low';
      out.push({ key: `task-${t.id}`, kind: 'task', sev, title: t.title, basis: 'Zamanında yapılmamış kontrol', siteId: t.site_id,
        sub: `${t.equipment_name ? `${t.equipment_name} · ` : ''}${t.status === 'missed' ? 'kaçırıldı' : 'gecikmiş'} · son tarih ${fmtDate(t.due_at)}`,
        href: `/task/${t.id}`, service: t.equipment_name ? svc(`${t.title} · ${t.equipment_name}`) : undefined, rank: SEV_RANK[sev] });
    }
    for (const d of docs.data ?? []) {
      if (site && d.siteId && d.siteId !== site) continue;
      const expired = d.status === 'expired', rejected = d.status === 'rejected', missing = d.status === 'no_file';
      if (!expired && !rejected && !missing && !d.expiring) continue;
      const sev: RiskSev = expired ? 'crit' : 'imp';
      out.push({ key: `doc-${d.id}`, kind: 'doc', sev, title: d.title, siteId: d.siteId,
        basis: expired ? 'Süresi dolmuş belge' : rejected ? 'İncelemede reddedilen belge' : missing ? 'Dosyası yüklenmemiş belge' : 'Süresi yaklaşan belge',
        sub: `${d.equipmentName ? `${d.equipmentName} · ` : ''}${expired ? 'süresi doldu' : missing ? 'dosya yok' : rejected ? 'reddedildi' : 'yakında bitiyor'}${d.validUntil ? ` · ${fmtDate(d.validUntil)}` : ''}`,
        href: `/documents/${d.id}`, service: svc(`${d.title} · yenileme / uygunluk desteği`), rank: SEV_RANK[sev] });
    }
    for (const o of obls.data ?? []) {
      if (o.decision !== 'needs_info' && o.decision !== 'needs_review') continue;
      out.push({ key: `info-${o.id}`, kind: 'info', sev: 'low', title: o.title, siteId: o.siteId, basis: o.decision === 'needs_info' ? 'Bilgi eksik — "uygulanmaz" sayılmaz' : 'Uzman incelemesi bekliyor',
        sub: o.missingFacts.length ? `${o.missingFacts.length} profil sorusu eksik` : 'İnceleme bekliyor', href: `/obligation/${o.id}`, rank: 2 });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [ncrs.data, tasks.data, docs.data, obls.data, site]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    items, counts: countRisk(items), manager,
    ready: sources.every(s => s.data !== null),
    loading: sources.some(s => s.loading),
    stale: sources.some(s => s.stale),
    error: sources.find(s => s.error)?.error ?? null,
    reload: () => { sources.forEach(s => void s.reload()); },
  };
}
