import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { credentialLabel } from '../features/labels';
import { credTr } from './labels';
import { Badge, Btn, Callout, Failed, Field, Kv, ListDetail, Loading, NowBox, PanelHead, Search, Section, Seg, Zero, dateTimeTr, dayTr, useDesk, useWork, useWsState, waitFrom, waitLabel, type Col } from './kit';
import { Page } from './Shell';

type Doc = { id: string; profile_id: string; kind: string; credential_type: string | null; issuer: string; document_ref: string; valid_until: string | null; status: string; submitted_at: string; checked_at: string | null };
type Ver = Doc & { display_name: string; scope_note: string | null; profile_documents: Doc[] };
type Auth = { id: string; profile_id: string; category_code: string; category_name: string; display_name: string; status: string; requested_at: string; required_credentials: string[]; profile_documents: Doc[] };
type Queue = { verifications: Ver[]; authorizations: Auth[] };
type OpsRow = { id: string; title: string; waitingDays: number; responsible: string; nextAction: string; record: { type: string; id: string } };
type Ops = { lists: { openRequests: OpsRow[]; lateAppointments: OpsRow[]; rejectedReports: OpsRow[]; expiringApprovals: OpsRow[]; openComplaints: OpsRow[] }; counts: Record<string, number> };
type Item = { id: string; tab: string; title: string; sub: string; since: string | null; days?: number; responsible: string; next: string; kindLabel: string; ver?: Ver; auth?: Auth; ops?: OpsRow };

const KIND = (v: Doc) => (v.kind === 'identity' ? 'Kimlik belgesi' : v.kind === 'credential' ? credTr(v.credential_type) : 'İşletme kaydı');
const ST: Record<string, [string, 'ok' | 'warn' | 'crit' | undefined]> = { verified: ['Doğrulandı', 'ok'], pending: ['Bekliyor', 'warn'], rejected: ['Reddedildi', 'crit'], expired: ['Süresi doldu', 'crit'] };
const TABS = [['belgeler', 'Uzman belgeleri'], ['kategoriler', 'Kategori başvuruları'], ['sikayetler', 'Hizmet şikâyetleri'], ['takip', 'Takip']] as const;
const FOLLOW: [keyof Ops['lists'], string][] = [['openRequests', 'Teklif bekleyen talep'], ['lateAppointments', 'Geciken randevu'], ['rejectedReports', 'Revizyondaki rapor'], ['expiringApprovals', 'Biten ya da bitecek uzman onayı']];

export function Market() {
  const { me } = useSession(); const { reload: reloadWork } = useWork(); const ok = (me?.platformRoles ?? []).includes('marketplace_reviewer');
  const [st, set] = useWsState('pazar', { tab: 'belgeler', q: '', tur: '' });
  const q = useApi<Queue>(ok ? '/admin/marketplace/queue' : null); const ops = useApi<Ops>(ok ? '/admin/marketplace/operations' : null);
  const reload = useCallback(async () => { await Promise.all([q.reload(), ops.reload(), reloadWork()]); }, [q.reload, ops.reload, reloadWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = TABS.some(t => t[0] === st.tab) ? st.tab : 'belgeler';
  const all: Item[] = useMemo(() => [
    ...(q.data?.verifications ?? []).map((v): Item => ({ id: v.id, tab: 'belgeler', title: `${v.display_name} · ${KIND(v)}`, sub: `${v.issuer} · ${v.document_ref}`, since: v.submitted_at, responsible: 'Pazar yeri inceleyicisi (atanmadı)', next: 'Doğrula ya da reddet', kindLabel: KIND(v), ver: v })),
    ...(q.data?.authorizations ?? []).map((a): Item => ({ id: a.id, tab: 'kategoriler', title: `${a.display_name} · ${a.category_name}`, sub: `Başvuru ${dateTimeTr(a.requested_at)} · gerekli: kimlik + ${a.required_credentials.map(credentialLabel).join(', ') || 'ek belge yok'}`, since: a.requested_at, responsible: 'Pazar yeri inceleyicisi (atanmadı)', next: 'Onayla ya da reddet', kindLabel: 'Kategori başvurusu', auth: a })),
    ...(ops.data?.lists.openComplaints ?? []).map((r): Item => ({ id: r.id, tab: 'sikayetler', title: r.title, sub: '', since: null, days: r.waitingDays, responsible: r.responsible, next: r.nextAction, kindLabel: 'Hizmet şikâyeti', ops: r })),
    ...FOLLOW.flatMap(([k, l]) => (ops.data?.lists[k] ?? []).map((r): Item => ({ id: r.id, tab: 'takip', title: r.title, sub: l, since: null, days: r.waitingDays, responsible: r.responsible, next: r.nextAction, kindLabel: l, ops: r }))),
  ], [q.data, ops.data]);
  const n = (t: string) => all.filter(i => i.tab === t).length;
  const tur = tab === 'takip' ? FOLLOW.find(f => f[0] === st.tur) : undefined;
  const rows = all.filter(i => i.tab === tab && (!tur || i.sub === tur[1]) && (!st.q.trim() || `${i.title} ${i.sub}`.toLowerCase().includes(st.q.trim().toLowerCase()))).sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || +new Date(a.since ?? 0) - +new Date(b.since ?? 0));
  const loading = (q.loading && !q.data) || (ops.loading && !ops.data);
  const next = (id: string) => { const i = rows.findIndex(r => r.id === id); const t = rows[i + 1] ?? rows[i - 1]; return t?.id ?? ''; };

  const cols: Col<Item>[] = [
    { key: 't', label: 'Kayıt', w: 'minmax(0,1fr)', render: r => <><div className="t">{r.title}</div>{r.sub ? <div className="s">{r.sub}</div> : null}</> },
    { key: 'w', label: 'Bekleme', w: '70px', render: r => (r.since ? waitFrom(r.since) : r.days !== undefined ? waitLabel(r.days * 1440) : '—') },
    { key: 'r', label: 'Sıra kimde', w: '170px', opt: true, render: r => <span style={{ color: /atanmadı/.test(r.responsible) ? 'var(--warn)' : undefined }}>{r.responsible}</span> },
    { key: 'n', label: 'Sıradaki işlem', w: '160px', opt: true, dim: true, render: r => r.next },
  ];
  const scope = q.data || ops.data ? `${n('belgeler')} belge · ${n('kategoriler')} kategori başvurusu · ${n('sikayetler')} şikâyet · ${n('takip')} takip kaydı` : 'Uzman belgeleri, kategori başvuruları ve hizmet takibi';

  return (
    <Page nav="pazar" title="Pazar Yönetimi" scope={<span data-testid="pazar-scope">{scope}</span>}
      tools={<><Seg label="Çalışma listesi" testid="pazar-tab" value={tab} onChange={v => set({ tab: v, sel: '', tur: '' })} items={TABS.map(([k, l]) => ({ key: k, label: l, n: n(k) }))} />
        <Search label="Bu listede ara" placeholder="Uzman ya da başlık ara" value={st.q} onChange={v => set({ q: v })} testid="pazar-search" />{tur ? <Btn size="sm" testid="pazar-tur-clear" onClick={() => set({ tur: '', sel: '' })}>{`Süzgeç: ${tur[1]} ✕`}</Btn> : null}</>}>
      {q.error && !q.data ? <Failed what="Pazar yeri kuyruğu" message={q.error} onRetry={reload} /> : null}
      <ListDetail ws="pazar" label={TABS.find(t => t[0] === tab)![1]} rows={rows} rowId={r => r.id} cols={cols} selId={st.sel ?? ''} onSelect={id => set({ sel: id })} ready={!loading}
        empty={loading ? <Loading what="Kayıtlar" /> : <Zero title={tab === 'takip' ? 'Takip edilecek kayıt yok' : 'Bu listede bekleyen kayıt yok'} text={tab === 'takip' ? 'Başkasının sırasında bekleyen talep, randevu, rapor ve onay yok.' : 'Yeni başvuru geldiğinde burada görünür.'} />}
        panel={st.sel && rows.some(r => r.id === st.sel) ? <MarketPanel key={st.sel} item={rows.find(r => r.id === st.sel)!} onDone={async () => { const nx = next(st.sel!); await reload(); set({ sel: nx }); }} />
          : st.sel ? <div className="gh-empty-panel" data-testid="pazar-gone"><b>Bu kayıt artık bu listede yok.</b><p>Karara bağlanmış ya da başka biri işlemiş olabilir. Listeden sıradaki kaydı seç.</p></div> : null} panelTitle="Kayıt ayrıntısı" />
    </Page>
  );
}

function MarketPanel({ item, onDone }: { item: Item; onDone: () => Promise<void> }) {
  const { call } = useSession(); const { toast } = useDesk(); const [note, setNote] = useState(''); const [until, setUntil] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const go = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setError(null); try { await fn(); toast(msg); await onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const v = item.ver; const a = item.auth; const o = item.ops;
  const missing = a ? [!(a.profile_documents ?? []).some(d => d.kind === 'identity' && d.status === 'verified') ? 'Kimlik belgesi' : null, ...a.required_credentials.filter(c => !(a.profile_documents ?? []).some(d => d.credential_type === c && d.status === 'verified')).map(credentialLabel)].filter(Boolean) as string[] : [];
  const why = (need: number) => (note.trim().length < need ? `Gerekçe en az ${need} karakter olmalı (şu an ${note.trim().length}).` : null);
  return (
    <>
      <PanelHead eyebrow={<Badge tone="info">{item.kindLabel}</Badge>} title={item.title} badges={<Badge tone="warn">{v || a ? `${item.since ? waitFrom(item.since) : ''} bekliyor` : `${item.days ?? 0} gündür bekliyor`}</Badge>} />
      <div className="gh-panel-scroll" data-testid="pazar-detail">
        <NowBox testid="pazar-now"
          why={v ? `Uzman bu belgeyi ${dateTimeTr(v.submitted_at)} tarihinde sundu; henüz kontrol edilmedi. Sıra pazar yeri inceleyicisinde.`
            : a ? `${dateTimeTr(a.requested_at)} tarihli kategori başvurusu karar bekliyor. Sıra pazar yeri inceleyicisinde.${missing.length ? ` Onay için eksik doğrulanmış belge: ${missing.join(', ')}.` : ''}`
              : item.tab === 'takip' ? `${item.kindLabel}: sıra ${o!.responsible} tarafında. Sıradaki adım: ${o!.nextAction}.` : `Hizmet şikâyeti ${o!.waitingDays} gündür karar bekliyor. Sıra: ${o!.responsible}.`}
          can={v ? ['Kontrol yöntemini yazıp belgeyi doğrulayabilir ya da reddedebilirsin.']
            : a ? (missing.length ? ['Gerekçe yazıp başvuruyu reddedebilirsin. Onay, eksik belge doğrulanana kadar kapalı.'] : ['Gerekçe ve bitiş tarihi yazıp onaylayabilir ya da reddedebilirsin.'])
              : item.tab === 'sikayetler' ? ['Gerekçe yazıp şikâyeti karara bağlayabilirsin.'] : []} />
        {v ? (
          <>
            <Section no={1} title="İncelenen belge kaydı">
              <Kv rows={[['Uzman', v.display_name], ['Belge türü', KIND(v)], ['Düzenleyen', v.issuer], ['Belge no', <span className="gh-mono">{v.document_ref}</span>], ['Geçerlilik', v.valid_until ? `${dayTr(v.valid_until)} tarihine kadar` : 'Süre belirtilmemiş'], ['Sunuş tarihi', dateTimeTr(v.submitted_at)], ['Kayıt kodu', <span className="gh-mono">{v.id.slice(0, 8)}</span>], ['Not', v.scope_note]]} />
              <Callout tone="info">Belge sürümü ayrı tutulmaz: her sunum ayrı bir kayıttır. Baktığın kayıt, yukarıdaki belge no ve sunuş tarihidir. Uzman belgeyi yenilerse yeni bir kayıt oluşur.</Callout>
            </Section>
            <Section no={2} title="Aynı uzmanın diğer belgeleri">
              {(v.profile_documents ?? []).length === 0 ? <div className="gh-note" data-testid="pazar-nodocs">Bu uzmanın başka belge kaydı yok.</div> : (
                <ul className="gh-hist" data-testid="pazar-docs">{(v.profile_documents ?? []).map(d => { const [l, t] = ST[d.status] ?? [d.status, undefined]; return <li key={d.id}><span className="w">{dateTimeTr(d.submitted_at)}</span><span><b>{KIND(d)}</b> · {d.issuer} · <span className="gh-mono">{d.document_ref}</span> <Badge tone={t}>{l}</Badge></span></li>; })}</ul>)}
            </Section>
          </>
        ) : null}
        {a ? (
          <>
            <Section no={1} title="Başvuru">
              <Kv rows={[['Uzman', a.display_name], ['Kategori', a.category_name], ['Başvuru tarihi', dateTimeTr(a.requested_at)], ['Gerekli belgeler', `Kimlik + ${a.required_credentials.map(credentialLabel).join(', ') || 'ek belge yok'}`]]} />
            </Section>
            <Section no={2} title="Dayanacağı belgeler">
              {(a.profile_documents ?? []).length === 0 ? <div className="gh-note">Uzmanın hiç belge kaydı yok.</div> : <ul className="gh-hist" data-testid="pazar-docs">{(a.profile_documents ?? []).map(d => { const [l, t] = ST[d.status] ?? [d.status, undefined]; return <li key={d.id}><span className="w">{dateTimeTr(d.submitted_at)}</span><span><b>{KIND(d)}</b> · {d.issuer} <Badge tone={t}>{l}</Badge>{d.valid_until ? ` · ${dayTr(d.valid_until)}'e kadar` : ''}</span></li>; })}</ul>}
              {missing.length ? <Callout tone="warn" testid="pazar-missing"><b>Eksik doğrulanmış belge: </b>{missing.join(', ')}. Onay için önce Uzman belgeleri listesinde bu belgeler doğrulanmalı.</Callout> : <Callout tone="ok">Gerekli belgelerin hepsi doğrulanmış.</Callout>}
            </Section>
          </>
        ) : null}
        {o ? (
          <Section no={1} title="Kayıt ve sıra">
            <Kv rows={[['Kayıt', o.title], ['Bekleme', `${o.waitingDays} gün`], ['Sıra kimde', o.responsible], ['Sıradaki adım', o.nextAction]]} />
            <Callout tone="info">Sorumluluk bu sistemde kişiye değil role atanır; bu yüzden burada kişi adı yok.{item.tab === 'takip' ? ' Takip kayıtları başkasının sırasındaki işleri hatırlatır; bu ekrandan karara bağlanmaz.' : ''}</Callout>
          </Section>
        ) : null}
        {error ? <Callout tone="crit" testid="pazar-error"><b>İşlem yapılamadı: </b>{error}</Callout> : null}
      </div>
      {v || a || item.tab === 'sikayetler' ? (
        <div className="gh-actbar" data-testid="pazar-decision">
          {a && !missing.length ? <Field label="Onay bitiş tarihi (YYYY-AA-GG) — dayandığı belgelerin bitişini geçemez" value={until} onChange={setUntil} testid="auth-valid-until" placeholder="ör. 2027-10-31" /> : null}
          <Field label={v ? 'Kontrol yöntemi ve gerekçe (en az 5 karakter)' : a ? 'Karar gerekçesi (en az 5 karakter)' : 'Karar gerekçesi (en az 10 karakter)'} value={note} onChange={setNote} multiline testid="pazar-reason" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {v ? (<>
              <Btn kind="pri" testid="ver-approve" disabled={busy || !!why(5)} onClick={() => go(() => call('POST', `/admin/marketplace/verifications/${v.id}/decide`, { decision: 'verified', checkMethod: note.trim(), notes: '' }), 'Belge doğrulandı')}>Doğrulandı</Btn>
              <Btn kind="dng" testid="ver-reject" disabled={busy || !!why(5)} onClick={() => go(() => call('POST', `/admin/marketplace/verifications/${v.id}/decide`, { decision: 'rejected', checkMethod: note.trim(), notes: note.trim() }), 'Belge reddedildi')}>Reddet</Btn>
            </>) : null}
            {a ? (<>
              <Btn kind="pri" testid="auth-approve" disabled={busy || !!why(5) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || missing.length > 0} onClick={() => go(() => call('POST', `/admin/marketplace/authorizations/${a.id}/decide`, { decision: 'approved', reason: note.trim(), validUntil: until }), 'Kategori onaylandı')}>Onayla</Btn>
              <Btn kind="dng" testid="auth-reject" disabled={busy || !!why(5)} onClick={() => go(() => call('POST', `/admin/marketplace/authorizations/${a.id}/decide`, { decision: 'rejected', reason: note.trim() }), 'Başvuru reddedildi')}>Reddet</Btn>
            </>) : null}
            {o && item.tab === 'sikayetler' ? <Btn kind="pri" testid={`ops-resolve-${o.id}`} disabled={busy || !!why(10)} onClick={() => go(() => call('POST', `/admin/marketplace/complaints/${o.id}/resolve`, { resolution: note.trim() }), 'Şikâyet karara bağlandı')}>Karara bağla</Btn> : null}
          </div>
          {(() => { const w = [why(item.tab === 'sikayetler' ? 10 : 5), a && missing.length ? 'Onay için eksik doğrulanmış belge var.' : null, a && !missing.length && !/^\d{4}-\d{2}-\d{2}$/.test(until) ? 'Onay için bitiş tarihi gerekli.' : null].filter(Boolean); return w.length ? <div className="gh-why" data-testid="pazar-why">Pasif: {w.join(' ')}</div> : null; })()}
          {v ? <Btn kind="ghost" size="sm" onClick={() => router.push(`/denetim?entity=${v.id}` as never)}>Denetim kaydında aç ›</Btn> : null}
        </div>
      ) : null}
    </>
  );
}
