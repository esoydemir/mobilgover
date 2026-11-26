import { router } from 'expo-router';
import { useMemo } from 'react';
import { useSession } from '../api/session';
import { Icon } from './icons';
import { Badge, Btn, Failed, Loading, Seg, Zero, useWork, useWsState, waitLabel, type Area, type WorkItem } from './kit';
import { NAV, Page } from './Shell';

type Row = WorkItem & { area: Area['area']; areaLabel: string };
const AREA_PATH: Record<string, string> = { legislation: '/legislation', market: '/pazar', moderation: '/moderation' };
const goto = (href: string) => router.push(href as never);

/**
 * "Önce hangisini açmalıyım?" Sıralama yalnız mevcut verilerden gelir: önce sana atananlar, sonra kaynağı okunamayan kaynaklar, sonra en uzun bekleyenler.
 * Hizmet süresi ya da öncelik eşiği ürün sahibince belirlenmediği için hiçbir kayda "gecikti" damgası vurulmaz; yalnız bekleme süresi yazılır.
 */
export function priorityOf(rows: Row[]): { row: Row; why: string }[] {
  const rank = (r: Row) => (r.mine ? 0 : r.kind === 'source_error' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.waitingMinutes - a.waitingMinutes).map(row => ({
    row,
    why: [row.mine ? 'Sana atanmış' : null, row.kind === 'source_error' ? 'Kaynak okunamıyor: yeni yayınlar bu kaynaktan görünmez' : null, /^Sahipsiz|atanmadı/.test(row.responsible) ? 'Sorumlusu yok' : null,
      `${waitLabel(row.waitingMinutes)} bekliyor`].filter(Boolean).join(' · '),
  }));
}

export function Overview() {
  const { me } = useSession(); const { work, error, loading, reload } = useWork();
  const [st, set] = useWsState('genel', { area: 'all', who: 'all' });
  const roles = me?.platformRoles ?? [];
  const all: Row[] = useMemo(() => (work?.areas ?? []).filter(a => a.state === 'ok').flatMap(a => a.items.map(i => ({ ...i, area: a.area, areaLabel: a.label }))), [work]);
  const rows = all.filter(r => (st.area === 'all' || r.area === st.area) && (st.who === 'all' || (st.who === 'mine' ? r.mine : /^Sahipsiz|atanmadı/.test(r.responsible))));
  const ranked = priorityOf(rows);
  const total = (work?.areas ?? []).reduce((n, a) => n + (a.state === 'ok' ? a.total : 0), 0);
  const failed = (work?.areas ?? []).filter(a => a.state === 'error');
  const okAreas = (work?.areas ?? []).filter(a => a.state === 'ok');
  const scope = work ? (failed.length ? `En az ${total} iş karar bekliyor · ${failed.map(a => a.label).join(', ')} verisi okunamadı` : total ? `${total} iş karar bekliyor` : 'Karar bekleyen iş yok') : 'Bugün ne bekliyor?';
  const top = ranked.slice(0, 3);

  return (
    <Page nav="genel" title="Genel Bakış" scope={<span data-testid="home-total">{scope}</span>} actions={<Btn size="sm" onClick={() => { void reload(); }} testid="home-reload">Yenile</Btn>}
      tools={work ? (
        <>
          <Seg label="Alana göre süz" testid="home-area" value={st.area} onChange={v => set({ area: v })} items={[{ key: 'all', label: 'Tümü', n: all.length }, ...okAreas.map(a => ({ key: a.area, label: a.label, n: a.items.length }))]} />
          <Seg label="Sorumluya göre süz" testid="home-who" value={st.who} onChange={v => set({ who: v })} items={[{ key: 'all', label: 'Hepsi' }, { key: 'mine', label: 'Bana atanan' }, { key: 'unowned', label: 'Sahipsiz' }]} />
        </>
      ) : null}>
      <div className="gh-list" data-testid="home-scroll" style={{ paddingBottom: 24 }}>
        {error && !work ? <Failed what="Bekleyen işler" message={error} onRetry={() => { void reload(); }} /> : null}
        {!work && !error ? <Loading what="Bekleyen işler" /> : null}
        {work ? (
          <>
            <div className="gh-areas" data-testid="home-areas">
              {work.areas.map(a => {
                const go = (href: string) => (e: React.MouseEvent) => { e.preventDefault(); goto(href); };
                if (a.state === 'forbidden') return <div key={a.area} className="gh-area lock" data-testid={`home-forbidden-${a.area}`}><Icon name="lock" size={14} /><span>{a.label}: yetkin yok <span style={{ color: 'var(--ink3)' }}>(gerekli: {a.need})</span></span></div>;
                if (a.state === 'error') return <div key={a.area} className="gh-area bad" data-testid={`home-error-${a.area}`} role="alert"><Icon name="alert" size={14} /><span><b style={{ fontSize: 13, color: 'var(--crit)' }}>{a.label}: veri okunamadı.</b> Bu “iş yok” demek değildir.</span><Btn size="sm" onClick={() => { void reload(); }}>Yeniden dene</Btn></div>;
                return (
                  <div key={a.area} className="gh-arearow" role="group" aria-label={`${a.label} sayaçları`}>
                    <a className="gh-area" href={AREA_PATH[a.area]} onClick={go(AREA_PATH[a.area]!)} data-testid={`home-area-card-${a.area}`}>{a.label}<b data-testid={`home-areatotal-${a.area}`}>{a.total}</b><span style={{ color: 'var(--ink2)' }}>{a.total ? 'karar bekliyor' : 'karar bekleyen yok'}</span></a>
                    <div className="gh-chips">{a.counters.map(c => (
                      <a key={c.key} href={c.href} className={`gh-btn sm gh-counter ${c.count ? '' : 'zero'}`} data-testid={`home-counter-${c.key}`} onClick={go(c.href)} aria-label={`${c.label}: ${c.count}`}>
                        <b data-testid={`home-count-${c.key}`}>{c.count}</b> {c.label}
                      </a>
                    ))}</div>
                  </div>
                );
              })}
            </div>

            {top.length ? (
              <section className="gh-prio" aria-labelledby="prio-h" data-testid="home-priority">
                <h2 id="prio-h">İlk bunu aç</h2>
                <p className="rule">Sıra: önce sana atananlar, sonra okunamayan kaynaklar, sonra en uzun bekleyenler. Süre eşiği tanımlı olmadığı için “gecikti” denmez; yalnız bekleme süresi gösterilir.</p>
                {top.map(({ row, why }, i) => (
                  <div key={row.id} className={`gh-prio-item ${i === 0 ? 'first' : ''}`} data-testid={`home-prio-${i}`}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}><Badge tone="info">{row.areaLabel}</Badge>{row.mine ? <Badge tone="ok">Sana atanmış</Badge> : null}</div>
                      <div className="t" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.title}</div>
                      <div className="why" data-testid={`home-prio-why-${i}`}><b style={{ fontWeight: 600, color: 'var(--ink)' }}>Neden: </b>{why}</div>
                    </div>
                    <Btn kind={i === 0 ? 'pri' : undefined} onClick={() => goto(row.href)} testid={`home-prio-open-${i}`}>{row.action} <Icon name="chevron" size={14} /></Btn>
                  </div>
                ))}
              </section>
            ) : null}

            <div style={{ padding: '18px 22px 6px', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>Bekleyen tüm işler</h2>
              <span style={{ color: 'var(--ink2)', fontSize: 13 }} data-testid="home-rowcount">{rows.length} kayıt{(work.areas.some(a => a.items.length < a.total && a.state === 'ok')) ? ' · liste her alanda en uzun bekleyen 25 kaydı gösterir; sayaç tümünü sayar' : ''}</span>
            </div>
            <div className="gh-rowhead" style={{ gridTemplateColumns: 'minmax(0,1fr) 84px 190px 170px 170px' }} aria-hidden="true"><div>İş</div><div>Bekleme</div><div>Sorumlu</div><div>Durum</div><div>İşlem</div></div>
            {rows.length === 0 ? (okAreas.length === 0 ? <Zero title="Gösterilecek alan yok" text="Hiçbir alanda yetkin yok ya da veriler okunamadı." /> : <Zero title="Bu süzgeçte bekleyen iş yok" text="Yetkin olmayan ve okunamayan alanlar yukarıda ayrıca belirtilir; onlar “iş yok” anlamına gelmez." />) : null}
            {ranked.map(({ row }) => (
              <button key={row.kind + row.id} type="button" className="gh-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 84px 190px 170px 170px' }} data-testid={`home-row-${row.id}`} onClick={() => goto(row.href)} aria-label={`${row.areaLabel}: ${row.title}. ${row.status}. ${row.responsible}. ${row.action}`}>
                <div className="gh-cell"><div className="s" style={{ marginTop: 0, textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 11.5, color: 'var(--info)', fontWeight: 600 }}>{row.areaLabel}</div><div className="t">{row.title}</div></div>
                <div className="gh-cell" data-testid={`home-wait-${row.id}`}>{waitLabel(row.waitingMinutes)}</div>
                <div className="gh-cell" style={{ color: /^Sahipsiz|atanmadı/.test(row.responsible) ? 'var(--warn)' : undefined }}>{row.responsible}{row.mine ? ' (sen)' : ''}</div>
                <div className="gh-cell dim">{row.status}</div>
                <div className="gh-cell"><span className="gh-btn sm" style={{ pointerEvents: 'none' }}>{row.action} <Icon name="chevron" size={13} /></span></div>
              </button>
            ))}
            <div style={{ padding: '14px 22px 0' }} data-testid="home-notes">
              <p className="gh-note" style={{ margin: 0 }}>Üstteki her sayaç, saydığı kayıtları açan süzgeçli bir bağlantıdır. “Takip” sayaçları başkasının sırasındaki işleri hatırlatır; karar bekleyen toplamına katılmaz.</p>
              {work.missing.length ? <p className="gh-note" data-testid="home-missing" style={{ marginTop: 10 }}>Hesaplanamayan: {work.missing.map(m => `${m.label} — ${m.why}`).join(' · ')}</p> : null}
              {loading ? <p className="gh-note">Güncelleniyor…</p> : null}
              <p className="gh-note" style={{ marginTop: 10 }}>Çalışma alanların: {NAV.filter(n => n.key !== 'genel' && (!n.roles || n.roles.some(r => roles.includes(r)))).map(n => n.label).join(' · ') || 'yok'}.</p>
            </div>
          </>
        ) : null}
      </div>
    </Page>
  );
}
