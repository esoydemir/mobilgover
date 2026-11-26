import { useCallback, useMemo, useState } from 'react';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { DECISION_TR, REASON_TR, TARGET_TR } from './labels';
import { Badge, Btn, Callout, Failed, Field, Kv, ListDetail, Loading, NowBox, PanelHead, Search, Section, Seg, Zero, dateTimeTr, useDesk, useWork, useWsState, waitFrom, type Col } from './kit';
import { Page } from './Shell';

type Report = { id: string; target_type: 'post' | 'comment' | 'profile'; target_id: string; reason: string; details: string; status: string; decision: string | null; decision_notes: string | null; reporter_name: string; handled_by_name: string | null;
  created_at: string; handled_at: string | null; reportsOnTarget: number; target: { body: string | null; author_name: string; author_id: string; hidden_at?: string | null; status?: string } | null };
type Appeal = { id: string; reason: string; created_at: string; target_type: string; decision: string; decision_notes: string; first_moderator: string | null; mine_first: boolean };
type Item = { id: string; kind: 'report' | 'appeal'; r?: Report; a?: Appeal; at: string };
const TABS = [['open', 'Açık şikâyetler'], ['closed', 'Karara bağlananlar'], ['appeals', 'İtirazlar']] as const;

export function Moderation() {
  const { me } = useSession(); const { reload: reloadWork } = useWork(); const ok = (me?.platformRoles ?? []).includes('network_moderator');
  const [st, set] = useWsState('mod', { status: 'open', q: '' });
  const tab = TABS.some(t => t[0] === st.status) ? st.status : 'open';
  const open = useApi<Report[]>(ok ? '/network/moderation/reports?status=open' : null); const closed = useApi<Report[]>(ok ? '/network/moderation/reports?status=closed' : null); const ap = useApi<Appeal[]>(ok ? '/network/moderation/appeals' : null);
  const reload = useCallback(async () => { await Promise.all([open.reload(), closed.reload(), ap.reload(), reloadWork()]); }, [open.reload, closed.reload, ap.reload, reloadWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const items: Item[] = useMemo(() => tab === 'appeals' ? (ap.data ?? []).map(a => ({ id: a.id, kind: 'appeal' as const, a, at: a.created_at }))
    : (tab === 'open' ? open.data : closed.data ?? [])?.map(r => ({ id: r.id, kind: 'report' as const, r, at: tab === 'open' ? r.created_at : r.handled_at ?? r.created_at })) ?? [], [tab, open.data, closed.data, ap.data]);
  const rows = items.filter(i => { const t = st.q.trim().toLowerCase(); if (!t) return true; return `${i.r?.target?.author_name ?? ''} ${i.r?.target?.body ?? ''} ${i.r?.details ?? ''} ${i.a?.reason ?? ''}`.toLowerCase().includes(t); })
    .sort((a, b) => (tab === 'closed' ? +new Date(b.at) - +new Date(a.at) : +new Date(a.at) - +new Date(b.at)));
  const cur = tab === 'appeals' ? ap : tab === 'open' ? open : closed; const loading = cur.loading && !cur.data;
  const nextId = (id: string) => { const i = rows.findIndex(r => r.id === id); return (rows[i + 1] ?? rows[i - 1])?.id ?? ''; };
  const history = (r: Report) => (closed.data ?? []).filter(c => c.id !== r.id && (c.target_id === r.target_id || (r.target?.author_id && c.target?.author_id === r.target.author_id)));

  const cols: Col<Item>[] = [
    { key: 't', label: 'Şikâyet edilen içerik', w: 'minmax(0,1fr)', render: i => i.r ? (
      <><div className="t">{TARGET_TR[i.r.target_type]} · {i.r.target?.author_name ?? 'silinmiş içerik'}</div>{i.r.target?.body ? <div className="s" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.r.target.body}</div> : null}</>)
      : <><div className="t">İtiraz · {TARGET_TR[i.a!.target_type] ?? i.a!.target_type}</div><div className="s">{i.a!.reason}</div></> },
    { key: 'g', label: 'Gerekçe', w: '150px', render: i => i.r ? <><div>{REASON_TR[i.r.reason] ?? i.r.reason}</div>{i.r.reportsOnTarget > 1 ? <div className="s">{i.r.reportsOnTarget} şikâyet</div> : null}</> : <>İlk karar: {DECISION_TR[i.a!.decision] ?? i.a!.decision}</> },
    { key: 'w', label: tab === 'closed' ? 'Karar' : 'Bekleme', w: '88px', render: i => (tab === 'closed' ? dateTimeTr(i.at).slice(0, 10) : waitFrom(i.at)) },
    { key: 'p', label: tab === 'closed' ? 'Karar' : 'Önceki işlem', w: '140px', opt: true, dim: true, render: i => i.r ? (tab === 'closed' ? DECISION_TR[i.r.decision ?? ''] ?? i.r.decision : (history(i.r).length ? `${history(i.r).length} önceki işlem var` : 'Yok')) : '—' },
  ];
  const scope = `${open.data ? open.data.length : '…'} açık şikâyet · ${ap.data ? ap.data.length : '…'} itiraz · karar gerekçesi zorunludur ve denetim kaydına yazılır`;

  return (
    <Page nav="moderasyon" title="Moderasyon" scope={<span data-testid="mod-scope">{scope}</span>}
      tools={<><Seg label="Liste" testid="mod-tab" value={tab} onChange={v => set({ status: v, sel: '' })} items={TABS.map(([k, l]) => ({ key: k, label: l, n: k === 'open' ? open.data?.length : k === 'appeals' ? ap.data?.length : closed.data?.length }))} />
        <Search label="Şikâyetlerde ara" placeholder="Şikâyetlerde ara" value={st.q} onChange={v => set({ q: v })} testid="mod-search" /></>}>
      {cur.error && !cur.data ? <Failed what="Şikâyet listesi" message={cur.error} onRetry={reload} /> : null}
      <ListDetail ws="mod" label={TABS.find(t => t[0] === tab)![1]} rows={rows} rowId={r => r.id} cols={cols} selId={st.sel ?? ''} onSelect={id => set({ sel: id })} ready={!loading}
        empty={loading ? <Loading what="Şikâyetler" /> : <Zero title={tab === 'open' ? 'Açık şikâyet yok' : tab === 'appeals' ? 'Açık itiraz yok' : 'Karara bağlanmış şikâyet yok'} text={tab === 'open' ? 'Yeni şikâyet geldiğinde burada görünür.' : undefined} />}
        panel={st.sel ? (rows.find(r => r.id === st.sel) ? <ModPanel key={st.sel} item={rows.find(r => r.id === st.sel)!} past={rows.find(r => r.id === st.sel)!.r ? history(rows.find(r => r.id === st.sel)!.r!) : []}
          onDone={async () => { const nx = nextId(st.sel!); await reload(); set({ sel: nx }); }} /> : <div className="gh-empty-panel" data-testid="mod-gone"><b>Bu kayıt artık bu listede yok.</b><p>Karara bağlanmış ya da başka bir moderatör işlemiş olabilir.</p></div>) : null} panelTitle="Şikâyet ayrıntısı" />
    </Page>
  );
}

function ModPanel({ item, past, onDone }: { item: Item; past: Report[]; onDone: () => Promise<void> }) {
  const { call } = useSession(); const { toast } = useDesk(); const [dec, setDec] = useState(''); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const r = item.r; const a = item.a;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setError(null); try { await fn(); toast(msg); await onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const options: string[] = r ? (r.target_type === 'profile' ? ['suspend_profile', 'dismiss'] : ['hide', 'suspend_profile', 'dismiss']) : [];
  const short = notes.trim().length < 10 ? `Gerekçe en az 10 karakter olmalı (şu an ${notes.trim().length}).` : null;
  return (
    <>
      <PanelHead eyebrow={<Badge tone={r?.status === 'open' || a ? 'warn' : undefined}>{a ? 'İtiraz' : r!.status === 'open' ? 'Karar bekliyor' : 'Karara bağlandı'}</Badge>}
        title={r ? `${TARGET_TR[r.target_type]} · ${r.target?.author_name ?? 'silinmiş içerik'}` : `İtiraz · ilk karar: ${DECISION_TR[a!.decision] ?? a!.decision}`} />
      <div className="gh-panel-scroll" data-testid="mod-detail">
        <NowBox testid="mod-now" title={r && r.status !== 'open' ? 'Durum' : 'Neden bekliyor'}
          why={r ? (r.status === 'open' ? `${REASON_TR[r.reason] ?? r.reason} gerekçeli şikâyet ${dateTimeTr(r.created_at)} tarihinde yapıldı; henüz karar verilmedi. Sıra ağ moderatöründe.` : `Karara bağlandı: ${DECISION_TR[r.decision ?? ''] ?? r.decision} · ${r.handled_by_name}.`)
            : `İlk karara ${dateTimeTr(a!.created_at)} tarihinde itiraz edildi; henüz incelenmedi.${a!.mine_first ? ' İlk kararı sen verdiğin için başka bir moderatör incelemeli.' : ''}`}
          can={r ? (r.status === 'open' ? [`Karar seçip gerekçe yazabilirsin: ${options.map(o => DECISION_TR[o]).join(', ')}.`] : null) : (a!.mine_first ? [] : ['Gerekçe yazıp kararı kaldırabilir ya da kalmasını onaylayabilirsin.'])} />
        {r ? (
          <>
            <Section no={1} title="Şikâyet edilen içerik">
              <Kv rows={[['Tür', TARGET_TR[r.target_type]], ['Yazar', r.target?.author_name ?? 'silinmiş'], ['Durum', r.target?.hidden_at ? 'Gizlenmiş' : r.target ? 'Görünür' : 'Bulunamadı']]} />
              {r.target?.body ? <blockquote data-testid="mod-body" style={{ margin: '10px 0 0', padding: '10px 14px', borderLeft: '3px solid var(--line2)', background: 'var(--bg)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.target.body}</blockquote> : <div className="gh-note">İçerik metni yok (silinmiş ya da profil).</div>}
            </Section>
            <Section no={2} title="Şikâyet">
              <Kv rows={[['Gerekçe', REASON_TR[r.reason] ?? r.reason], ['Şikâyetçinin notu', r.details || 'Not yazılmamış'], ['Şikâyet eden', r.reporter_name], ['Tarih', dateTimeTr(r.created_at)], ['Aynı içeriğe şikâyet', `${r.reportsOnTarget}`]]} />
              <div className="gh-note" style={{ marginTop: 6 }}>Karar, aynı içerikteki tüm açık şikâyetleri kapatır. Kendi şikâyetini karara bağlayamazsın.</div>
            </Section>
            <Section no={3} title="Önceki işlemler">
              {past.length === 0 ? <div className="gh-note" data-testid="mod-nopast">Bu içerik ya da yazar için daha önce verilmiş karar yok.</div> : (
                <ul className="gh-hist" data-testid="mod-past">{past.map(p => <li key={p.id}><span className="w">{dateTimeTr(p.handled_at)}</span><span><b>{DECISION_TR[p.decision ?? ''] ?? p.decision}</b> · {p.handled_by_name}<div className="gh-note">Gerekçe: {p.decision_notes}</div></span></li>)}</ul>)}
            </Section>
            {r.status !== 'open' ? (
              <Section no={4} title="Karar"><Callout tone="ok" testid="mod-final"><b>{DECISION_TR[r.decision ?? ''] ?? r.decision}</b> · {r.handled_by_name} · {dateTimeTr(r.handled_at)}<div style={{ marginTop: 4 }}>Gerekçe: {r.decision_notes}</div></Callout></Section>
            ) : null}
          </>
        ) : (
          <>
            <Section no={1} title="İtiraz"><Kv rows={[['İtiraz gerekçesi', a!.reason], ['İlk karar', DECISION_TR[a!.decision] ?? a!.decision], ['İlk karar gerekçesi', a!.decision_notes], ['İlk kararı veren', a!.first_moderator ?? '—'], ['Tarih', dateTimeTr(a!.created_at)]]} /></Section>
            {a!.mine_first ? <Callout tone="warn" testid={`appeal-own-${a!.id}`}>İlk kararı sen verdin; bu itirazı başka bir moderatör incelemeli.</Callout> : null}
          </>
        )}
        {error ? <Callout tone="crit" testid="mod-error"><b>İşlem yapılamadı: </b>{error}</Callout> : null}
      </div>
      {(r && r.status === 'open') || (a && !a.mine_first) ? (
        <div className="gh-actbar" data-testid="mod-decision">
          {r ? (
            <div className="gh-field" style={{ margin: 0 }}><label>Karar</label>
              <div className="gh-seg" role="group" aria-label="Karar seç" data-testid="mod-options">
                {options.map(o => <button key={o} type="button" aria-pressed={dec === o} data-testid={`mod-decision-${o}-${r.id}`} onClick={() => setDec(o)}>{DECISION_TR[o]}</button>)}
              </div></div>) : null}
          <Field label="Gerekçe (zorunlu, en az 10 karakter)" value={notes} onChange={setNotes} multiline testid={r ? `mod-notes-${r.id}` : `appeal-notes-${a!.id}`} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r ? <Btn kind="pri" testid={`mod-submit-${r.id}`} disabled={busy || !dec || !!short} onClick={() => run(() => call('POST', `/network/moderation/reports/${r.id}`, { decision: dec, notes: notes.trim() }), 'Karar kaydedildi')}>Kararı kaydet</Btn> : (<>
              <Btn kind="pri" testid={`appeal-overturn-${a!.id}`} disabled={busy || !!short} onClick={() => run(() => call('POST', `/network/moderation/appeals/${a!.id}`, { decision: 'overturned', notes: notes.trim() }), 'İtiraz karara bağlandı: karar kaldırıldı')}>Kararı kaldır</Btn>
              <Btn testid={`appeal-uphold-${a!.id}`} disabled={busy || !!short} onClick={() => run(() => call('POST', `/network/moderation/appeals/${a!.id}`, { decision: 'upheld', notes: notes.trim() }), 'İtiraz karara bağlandı: karar kaldı')}>Karar kalsın</Btn></>)}
          </div>
          {(r && !dec) || short ? <div className="gh-why" data-testid="mod-why">Pasif: {[r && !dec ? 'karar seçilmedi' : null, short].filter(Boolean).join(' · ')}</div> : null}
        </div>
      ) : null}
    </>
  );
}
