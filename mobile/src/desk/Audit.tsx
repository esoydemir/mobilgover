import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../api/session';
import { Badge, Btn, Failed, Kv, ListDetail, Loading, PanelHead, Section, Seg, Zero, dateTimeTr, useWsState, type Col } from './kit';
import { DECISION_TR, REASON_TR, eventTr } from './labels';
import { Page } from './Shell';

type Item = { id: number; companyName: string | null; scope: string; occurredAt: string; actorName: string; eventType: string; entityType: string; entityId?: string | null; reason: string | null; payload?: Record<string, unknown> & { code?: string; version?: number } };
const KINDS: [string, string][] = [['', 'Hepsi'], ['legislation.', 'Mevzuat'], ['rule.', 'Kurallar'], ['pro.', 'Pazar'], ['network.', 'Moderasyon'], ['platform.', 'Yetkiler']];

/** İnsan eliyle yazılan gerekçe: moderasyonda "notes" alanıdır; "reason" alanındaki kod şikâyet türüdür, gerekçe değildir. */
const reasonOf = (i: Item) => (typeof i.payload?.notes === 'string' && i.payload.notes ? i.payload.notes : i.reason && !REASON_TR[i.reason] ? i.reason : null);
const KEY_TR: Record<string, string> = { decision: 'Karar', reason: 'Şikâyet türü', code: 'Kural kodu', version: 'Sürüm', area: 'İnceleme alanı' };
/** Denetim geçmişi: kim, neye, ne zaman, hangi gerekçeyle. Gerekçesi olmayan kayıt "gerekçe yok" diye açıkça yazılır. */
export function Audit() {
  const { me, call } = useSession(); const ok = (me?.platformRoles ?? []).includes('platform_admin');
  const [st, set] = useWsState('den', { scope: 'platform', kind: '', entity: '' });
  const [items, setItems] = useState<Item[] | null>(null); const [next, setNext] = useState<number | null>(null); const [error, setError] = useState<string | null>(null); const [more, setMore] = useState(false);
  const url = (before?: number) => `/admin/audit?scope=${st.scope === 'all' || st.entity ? 'all' : 'platform'}${st.entity ? `&entityId=${encodeURIComponent(st.entity)}` : ''}&limit=50${st.kind ? `&eventType=${encodeURIComponent(st.kind)}` : ''}${before ? `&before=${before}` : ''}`;
  const load = useCallback(async () => {
    if (!ok) return; setError(null);
    try { const r = await call<{ items: Item[]; next: number | null }>('GET', url()); setItems(r.items); setNext(r.next); } catch (e) { setError(e instanceof Error ? e.message : 'Okunamadı.'); }
  }, [ok, st.scope, st.kind, st.entity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setItems(null); void load(); }, [load]);
  const loadMore = async () => { if (!next) return; setMore(true); try { const r = await call<{ items: Item[]; next: number | null }>('GET', url(next)); setItems(p => [...(p ?? []), ...r.items]); setNext(r.next); } catch (e) { setError(e instanceof Error ? e.message : 'Okunamadı.'); } finally { setMore(false); } };
  const rows = items ?? [];
  const cols: Col<Item>[] = [
    { key: 'e', label: 'Olay', w: 'minmax(0,1fr)', render: i => <><div className="t">{eventTr(i.eventType)}{i.payload?.code ? ` · ${i.payload.code}${i.payload.version ? ` v${i.payload.version}` : ''}` : ''}</div><div className="s">{i.actorName}</div></> },
    { key: 'g', label: 'Gerekçe', w: 'minmax(0,1.2fr)', render: i => reasonOf(i) ? <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{reasonOf(i)}</span> : <span style={{ color: 'var(--ink3)' }}>Gerekçe kaydedilmemiş</span>, opt: true },
    { key: 'w', label: 'Zaman', w: '132px', dim: true, render: i => dateTimeTr(i.occurredAt) },
  ];
  return (
    <Page nav="denetim" title="Denetim Geçmişi" scope={<span data-testid="den-scope">{items ? `${rows.length} kayıt gösteriliyor${next ? ' · daha eskileri var' : ''}` : 'Kim, ne zaman, hangi gerekçeyle'}</span>}
      tools={<><Seg label="Kapsam" testid="den-scope-seg" value={st.scope} onChange={v => set({ scope: v, sel: '' })} items={[{ key: 'platform', label: 'Platform' }, { key: 'all', label: 'Tüm işletmeler' }]} />
        <Seg label="Olay türü" testid="den-kind" value={st.kind || 'all'} onChange={v => set({ kind: v === 'all' ? '' : v, sel: '' })} items={KINDS.map(([k, l]) => ({ key: k || 'all', label: l }))} />{st.entity ? <Btn size="sm" testid="den-entity-clear" onClick={() => set({ entity: '', sel: '' })}>Tek kaydın geçmişi ✕</Btn> : null}</>}>
      {error && !items ? <Failed what="Denetim kayıtları" message={error} onRetry={() => { void load(); }} /> : null}
      <ListDetail ws="den" label="Denetim kayıtları" rows={rows} rowId={i => String(i.id)} cols={cols} selId={st.sel ?? ''} onSelect={id => set({ sel: id })} ready={!!items}
        empty={!items && !error ? <Loading what="Denetim kayıtları" /> : error ? null : <Zero title="Bu süzgeçte kayıt yok" text="Kapsamı ya da olay türünü değiştir." />} panelTitle="Denetim kaydı"
        footer={next ? <div style={{ padding: 14 }}><Btn onClick={() => { void loadMore(); }} disabled={more} testid="den-more">{more ? 'Yükleniyor…' : 'Daha eski kayıtlar'}</Btn></div> : null}
        panel={st.sel ? (() => { const i = rows.find(r => String(r.id) === st.sel); return i ? (
          <>
            <PanelHead title={eventTr(i.eventType)} eyebrow={<Badge tone="info">{i.companyName ?? 'Platform'}</Badge>} />
            <div className="gh-panel-scroll" data-testid="den-detail">
              <Section no={1} title="Kayıt"><Kv rows={[['Kim', i.actorName], ['Ne zaman', dateTimeTr(i.occurredAt)], ['Kapsam', i.companyName ?? 'Platform'], ['Konu', i.entityType], ['Kayıt türü', <span className="gh-mono" key="t">{i.eventType}</span>], ['Kayıt no', `${i.id}`]]} /></Section>
              <Section no={2} title="Gerekçe">{reasonOf(i) ? <p data-testid="den-reason" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reasonOf(i)}</p> : <p className="gh-note" data-testid="den-noreason">Bu işlem için gerekçe kaydedilmemiş.</p>}</Section>
              {i.payload && Object.keys(i.payload).length ? <Section no={3} title="Ek bilgi"><Kv rows={Object.entries(i.payload).filter(([k, v]) => KEY_TR[k] && typeof v !== 'object').map(([k, v]) => [KEY_TR[k]!, DECISION_TR[String(v)] ?? REASON_TR[String(v)] ?? String(v)] as [string, string])} /></Section> : null}
            </div>
          </>) : <div className="gh-empty-panel"><b>Bu kayıt bu süzgeçte yok.</b></div>; })() : null} />
    </Page>
  );
}
