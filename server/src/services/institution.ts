/**
 * Institution view (6E) — SYNTHETIC DEMO ONLY. No real business data is read here: a fixed,
 * seeded generator makes businesses by region and type, with cases, verified causes and the support
 * that followed. It shows how a supervising body could see patterns without seeing who is who:
 * groups smaller than K_MIN businesses are hidden, and with fewer than N_MIN cases no interpretation
 * is written. Real institution access, identity sharing and real data transfer are a later, separate step.
 */
export const K_MIN = 5;
export const N_MIN = 30;
const REGIONS = ['İstanbul Anadolu', 'İstanbul Avrupa', 'Ankara', 'İzmir', 'Kars'];
const TYPES = ['Kafe', 'Lokanta', 'Büfe', 'Fırın'];
const CAUSES = ['equipment', 'knowledge', 'resource', 'process'] as const;
const CAUSE_TR: Record<string, string> = { equipment: 'Ekipman eksikliği', knowledge: 'Bilgi eksikliği', resource: 'Kaynak eksikliği', process: 'Süreç eksikliği' };
const SUPPORT_TR: Record<string, string> = { none: 'Destek yok', training: 'Eğitim', service: 'Uzman hizmeti', process_change: 'Süreç değişikliği' };

/** Small deterministic PRNG so the demo is the same every time. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

type Case = { region: string; type: string; business: number; cause: (typeof CAUSES)[number]; support: keyof typeof SUPPORT_TR; repeated: boolean };

export function syntheticCases(): Case[] {
  const r = rng(20261109);
  const out: Case[] = [];
  let b = 0;
  for (const region of REGIONS) for (const type of TYPES) {
    // Kars is deliberately small: its groups must be hidden.
    const businesses = region === 'Kars' ? 2 + Math.floor(r() * 2) : 6 + Math.floor(r() * 8);
    for (let i = 0; i < businesses; i++, b++) {
      const cases = 2 + Math.floor(r() * 5);
      for (let c = 0; c < cases; c++) {
        // Ankara leans to equipment causes, İzmir to knowledge: the pattern the view should reveal.
        const w = region === 'Ankara' ? [0.55, 0.2, 0.1, 0.15] : region === 'İzmir' ? [0.15, 0.55, 0.1, 0.2] : [0.3, 0.3, 0.15, 0.25];
        let x = r(), k = 0; while (x > w[k]! && k < 3) { x -= w[k]!; k++; }
        const cause = CAUSES[k]!;
        const fit = { equipment: 'service', knowledge: 'training', resource: 'process_change', process: 'process_change' }[cause] as Case['support'];
        const support = r() < 0.65 ? fit : r() < 0.5 ? 'none' : (['training', 'service', 'process_change'] as const)[Math.floor(r() * 3)]!;
        // A fitting support lowers the chance the problem comes back.
        const repeated = r() < (support === 'none' ? 0.45 : support === fit ? 0.15 : 0.35);
        out.push({ region, type, business: b, cause, support, repeated });
      }
    }
  }
  return out;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export function institutionView(f: { region?: string | null; type?: string | null } = {}) {
  const all = syntheticCases().filter(c => (!f.region || c.region === f.region) && (!f.type || c.type === f.type));
  const groups = new Map<string, Case[]>();
  for (const c of all) { const k = `${c.region}|${c.type}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const rows = [...groups.entries()].map(([k, cs]) => {
    const [region, type] = k.split('|') as [string, string];
    const businesses = new Set(cs.map(c => c.business)).size;
    if (businesses < K_MIN) return { region, type, hidden: true, note: `Grupta ${K_MIN}'ten az işletme var; kimlik açığa çıkmasın diye gizlendi.` };
    const causes = Object.fromEntries(CAUSES.map(c => [c, cs.filter(x => x.cause === c).length]));
    return { region, type, hidden: false, businesses, cases: cs.length, repeatRate: pct(cs.filter(c => c.repeated).length, cs.length), causes };
  });
  const visible = all.filter(c => new Set(all.filter(x => x.region === c.region && x.type === c.type).map(x => x.business)).size >= K_MIN);
  const byRegion = REGIONS.map(region => {
    const cs = visible.filter(c => c.region === region);
    if (!cs.length) return { region, hidden: true, note: 'Gösterilebilecek yeterli grup yok.' };
    const dist = CAUSES.map(c => ({ cause: c, label: CAUSE_TR[c], share: pct(cs.filter(x => x.cause === c).length, cs.length) }));
    const top = [...dist].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0]!;
    return { region, hidden: false, cases: cs.length, causes: dist,
      interpretation: cs.length < N_MIN ? `Yalnız ${cs.length} vaka var; yorum yapılmadı.` : `Doğrulanmış nedenlerin en büyük payı: ${top.label} (%${top.share}).` };
  });
  const support = Object.keys(SUPPORT_TR).map(s => {
    const cs = visible.filter(c => c.support === s);
    return { support: s, label: SUPPORT_TR[s], cases: cs.length, repeatRate: cs.length >= N_MIN ? pct(cs.filter(c => c.repeated).length, cs.length) : null,
      note: cs.length < N_MIN ? `Yalnız ${cs.length} vaka; oran gösterilmedi.` : null };
  });
  // Support that fits the verified cause vs not, per cause.
  const fitByCause = CAUSES.map(cause => {
    const cs = visible.filter(c => c.cause === cause);
    const fit = { equipment: 'service', knowledge: 'training', resource: 'process_change', process: 'process_change' }[cause];
    const a = cs.filter(c => c.support === fit), n = cs.filter(c => c.support === 'none');
    return { cause, label: CAUSE_TR[cause], fitSupport: SUPPORT_TR[fit], withFit: a.length >= N_MIN ? pct(a.filter(c => c.repeated).length, a.length) : null,
      withoutSupport: n.length >= N_MIN ? pct(n.filter(c => c.repeated).length, n.length) : null, n: { fit: a.length, none: n.length } };
  });
  return {
    synthetic: true, label: 'SENTETİK VERİ · gerçek işletme verisi değildir',
    note: `Gruplar en az ${K_MIN} işletme içerdiğinde gösterilir; ${N_MIN} vakadan az veride yorum ya da oran üretilmez. Gerçek kurum erişimi, işletme kimliği paylaşımı ve gerçek veri aktarımı bu sürümde yoktur.`,
    filters: { regions: REGIONS, types: TYPES }, groups: rows, byRegion, support, fitByCause,
  };
}
