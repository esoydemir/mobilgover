import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { AREA_TR, SECTOR_TR, SOURCE_TR, STATUS_LEG, eventTr, trText } from './labels';
import { Badge, Btn, Callout, Ext, Failed, Field, Kv, ListDetail, Loading, NowBox, PanelHead, Search, Section, Seg, Zero, dateTimeTr, dayTr, useDesk, useWork, useWsState, waitFrom, type Col } from './kit';
import { Page } from './Shell';

type Source = { code: string; name: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; last_error_at: string | null; failures_in_row: number; queue_open?: number };
type Skipped = { key: string; url: string | null; status: 'out_of_scope' | 'unreadable'; title: string; why: string; firstDay: string; lastDay: string; scans: number };
type Overview = { sources: Source[]; recentSkipped?: Skipped[]; pendingReview: number; unclearDates: number; counts: Record<string, number>; canScan: boolean; lastSuccessfulScan: { finished_at: string } | null;
  schedule: { enabled: boolean; nextRunAt?: string | null; retry?: { attempts: number; awaitingToday?: boolean; maxAttempts: number; nextAttemptAt: string | null; exhausted: boolean; lastErrors: string[] } | null } };
type Row = { id: string; source_code: string; typeLabel: string; doc_ref: string; doc_title: string; article_ref: string | null; published_on: string | null; effective_from: string | null; status: string; is_example: boolean; detected_at: string;
  match_level?: 'clear' | 'uncertain' | null; sectors?: string[] | null; waiting_reason?: string | null; review_areas?: string[]; assigned_to?: string | null; assignee_name?: string | null; date_status: 'known' | 'unclear'; next_step?: 'author' | 'area' | 'approver' | null };
type Site = { siteId: string; site: string; company: string; effect: string; reason: string; missingQuestions?: { key: string; label: string }[]; openTaskEffect?: string; plannedText?: string; plannedTasks?: { code: string; title: string; firstDue: string | null; unset: boolean }[] };
type Detail = {
  id: string; status: string; typeLabel: string; docRef: string; docTitle: string; articleRef: string | null; sourceUrl: string; sourceCode: string; publishedOn: string | null; effectiveFrom: string | null; dateStatus: 'known' | 'unclear'; dateNote: string | null;
  oldText: string | null; newText: string | null; isExample: boolean; exampleNote: string | null; rule: { id: string; code: string; version: number; status: string } | null; missingAreaReviews: string[]; approveReason: string | null; rejectReason: string | null; applyOn: string | null; appliedAt: string | null;
  suggestion: { relevance?: string; sectors?: string[]; matchLevel?: 'clear' | 'uncertain'; addedWords?: string[]; removedWords?: string[]; changedNumbers?: { from: string[]; to: string[] };
    effectiveDetail?: { general: { articleIds: string[]; clause: string | null }; transitional: { articleId: string; dates: string[]; sentence: string }[]; scope: { articleId: string; text: string } | null } } | null;
  proposal: { code: string; title: string; obligationTitle: string; obligationSummary: string; effectiveFrom: string | null; effectiveTo: string | null; templates: { code: string; title: string; limits?: { quantity: string; unit: string; min?: number; max?: number; basis: string; note?: string }[] }[] } | null;
  impact: { onDate: string; affectedSites: number; notifiedSites: number; outOfScopeSites: number; sites: Site[]; outOfScopeSample?: { company: string; site: string; reason: string }[] } | null; impactNote: string | null;
  history: { seq: number; occurred_at: string; event_type: string; payload: Record<string, unknown> | null; actor: string | null }[];
  blockers: string[];
  frequency?: { effectiveFrom: string | null; applyOn: string; sourceSays: string; checks: { code: string; title: string; text: string; unset: boolean; basis: string | null; basisLabel: string; basisNote: string | null }[] };
  reviewAreas?: { suggestion: { sector: string; area: string; why: string }[]; required: { area: string; reviewers: number; names: string[]; approved: boolean; canIReview: boolean; waiting: string | null; myAccess: string }[] };
  assignment?: { userId: string; name: string | null; at: string; note: string | null } | null; compare?: { hasOld: boolean; note: string | null };
  cannot?: Record<'prepare' | 'approve' | 'reject' | 'return' | 'assign', string | null>; nextInLine?: string; can: { resolveDate: boolean; prepare: boolean; approve: boolean; reject: boolean };
};
type Cands = { needAreas: string[]; assignedTo: string | null; note: string | null; candidates: { id: string; name: string; areas: string[]; eligible: boolean }[] };

const OPEN_Q = ['open', 'mine', 'unowned', 'review', 'uncertain', 'unreadable'];
const VIEWS = [['open', 'Açık'], ['scheduled', 'Yürürlük bekliyor'], ['applied', 'Uygulandı'], ['rejected', 'Reddedildi']] as const;
const NEXT_TR = { author: 'kural yazarı', area: 'alan incelemesi', approver: 'kural onaylayıcısı' } as const;
const SUBS = [['open', 'Hepsi'], ['mine', 'Bana atanan'], ['unowned', 'Sahipsiz'], ['review', 'Onay bekleyen'], ['uncertain', 'Belirsiz eşleşme']] as const;
const BASIS: Record<string, [string, 'official' | 'plan' | 'example']> = { source: ['Resmî kaynak', 'official'], rule: ['Resmî kaynak (yayımlanmış kural)', 'official'], business_plan: ['İşletme planı', 'plan'], haccp_plan: ['İşletmenin kendi planı', 'plan'],
  manufacturer: ['Üretici değeri', 'plan'], admin_choice: ['Yönetici seçimi (resmî kaynak değil)', 'example'], example_scenario: ['ÖRNEK senaryo', 'example'], example: ['ÖRNEK, doğrulanmadı', 'example'] };
const Tag = ({ b }: { b: string | null }) => { const [l, k] = BASIS[b ?? ''] ?? ['Dayanak belirtilmemiş', 'example']; return <span className={`gh-from ${k}`} data-testid={`basis-${b ?? 'none'}`}>{l}</span>; };
const EFFECT: Record<string, [string, 'ok' | 'info' | 'warn']> = { new_obligation: ['Yeni yükümlülük', 'ok'], version_change: ['Kural sürümü değişir', 'info'], ended: ['Yükümlülük sona erer', 'warn'], needs_info: ['Bilgisi eksik', 'warn'] };
/** Yazılan gerekçe taslağı kayıt başına tutulur; panel kapanıp açılınca kaybolmaz, başka kayda geçmez. */
const DRAFT: Record<string, string> = {};

export function Legislation() {
  const { me, call } = useSession(); const { toast } = useDesk(); const { reload: reloadWork } = useWork();
  const roles = me?.platformRoles ?? []; const ok = roles.some(r => ['platform_admin', 'rule_author', 'rule_reviewer'].includes(r));
  const [st, set] = useWsState('mevzuat', { quick: 'open', q: '', src: '', health: '' });
  const [scanning, setScanning] = useState(false); // bir tarama dakikalar sürebilir (PDF okuma)
  const quick = st.quick || 'open'; const view = OPEN_Q.includes(quick) ? 'open' : quick;
  const filt = `${st.src ? `&source=${encodeURIComponent(st.src)}` : ''}${st.q.trim() ? `&q=${encodeURIComponent(st.q.trim())}` : ''}${quick === 'mine' ? '&assignee=me' : ''}${quick === 'uncertain' ? '&match=uncertain' : ''}`;
  const sA = quick === 'review' ? 'drafted' : ['scheduled', 'applied', 'rejected'].includes(quick) ? quick : 'pending'; const both = ['open', 'mine', 'unowned', 'uncertain'].includes(quick);
  const ov = useApi<Overview>(ok ? '/admin/legislation/overview' : null);
  const qa = useApi<Row[]>(ok && quick !== 'unreadable' ? `/admin/legislation/changes?status=${sA}${filt}` : null);
  const qb = useApi<Row[]>(ok && both ? `/admin/legislation/changes?status=drafted${filt}` : null);
  const reloadAll = useCallback(async () => { await Promise.all([ov.reload(), qa.reload(), qb.reload(), reloadWork()]); }, [ov.reload, qa.reload, qb.reload, reloadWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const unreadable = useMemo(() => (ov.data?.recentSkipped ?? []).filter(k => k.status === 'unreadable'), [ov.data]);
  const rows = useMemo(() => { if (quick === 'unreadable') return [] as Row[]; const all = [...(qa.data ?? []), ...(both ? qb.data ?? [] : [])]; const seen = new Set<string>(); const u = all.filter(r => !seen.has(r.id) && seen.add(r.id)); return (quick === 'unowned' ? u.filter(r => !r.assigned_to) : u).sort((a, b) => +new Date(a.detected_at) - +new Date(b.detected_at)); }, [qa.data, qb.data, quick, both]);
  const o = ov.data; const failing = (o?.sources ?? []).filter(s => s.last_error); const total = (o?.pendingReview ?? 0);
  const setView = (v: string) => { autoRef.current = ''; set({ quick: v, sel: '' }); };
  // Geniş ekranda kuyruk açılınca ilk dosya seçilir; kapatılırsa ya da karar verilirse kendiliğinden başka dosyaya geçilmez.
  const wide = useWindowDimensions().width >= 1280; const autoRef = useRef('');
  const settled = !qa.loading && (!both || !qb.loading) && rows.every(r => (both ? ['pending', 'drafted'] : [sA]).includes(r.status));
  useEffect(() => { if (st.sel) { autoRef.current = quick; return; } if (wide && settled && rows[0] && autoRef.current !== quick) { autoRef.current = quick; set({ sel: rows[0].id }); } }, [wide, settled, rows, st.sel, quick, set]);

  const cols: Col<Row>[] = [
    { key: 'doc', label: 'Yayın', w: 'minmax(0,1fr)', render: r => (
      <>
        <div className="t">{r.doc_title}{r.article_ref ? ` · md. ${r.article_ref}` : ''}</div>
        <div className="s">{SOURCE_TR[r.source_code] ?? r.source_code} · {r.doc_ref} · yayın {dayTr(r.published_on)} · {waitFrom(r.detected_at)} bekliyor</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
          {r.is_example ? <Badge tone="ex">ÖRNEK</Badge> : null}{r.match_level === 'uncertain' ? <Badge tone="warn">Eşleşme belirsiz</Badge> : null}{r.date_status === 'unclear' ? <Badge tone="warn">Tarih belirsiz</Badge> : null}
        </div>
        {r.waiting_reason ? <div className="gh-why" data-testid={`leg-waiting-${r.id}`}>{trText(r.waiting_reason)}</div> : null}
      </>) },
    { key: 'st', label: 'Durum', w: '150px', render: r => { const [l, t] = STATUS_LEG[r.status] ?? [r.status, undefined]; return <Badge tone={t}>{l}</Badge>; } },
    { key: 'who', label: 'Dosya sorumlusu', w: '136px', render: r => (
      <>
        {r.assignee_name ? <span>{r.assignee_name}</span> : <span style={{ color: 'var(--warn)' }}>Sahipsiz</span>}
        {r.next_step ? <div className="s" data-testid={`leg-next-${r.id}`}>Sırada: {NEXT_TR[r.next_step]}</div> : null}
      </>) },
    { key: 'eff', label: 'Yürürlük', w: '88px', opt: true, render: r => (r.date_status === 'unclear' ? <span style={{ color: 'var(--warn)' }}>Belirsiz</span> : dayTr(r.effective_from)) },
    { key: 'w', label: 'Bekleme', w: '68px', opt: true, render: r => waitFrom(r.detected_at) },
  ];

  return (
    <Page nav="mevzuat" title="Mevzuat Masası"
      scope={<span data-testid="desk-count">{o ? `${o.pendingReview} inceleme bekliyor · ${o.unclearDates} tarihi belirsiz · ${o.counts.scheduled ?? 0} yürürlük bekliyor` : 'Resmî Gazete ve Mevzuat Bilgi Sistemi yayınları'}</span>}
      actions={<>
        <span style={{ color: 'var(--ink3)', fontSize: 12.5 }} data-testid="desk-lastscan">Son başarılı tarama: {o?.lastSuccessfulScan ? dateTimeTr(o.lastSuccessfulScan.finished_at) : 'yok'}</span>
        <Btn size="sm" onClick={() => set({ health: st.health ? '' : '1' })} testid="desk-health-toggle">{failing.length ? 'Kaynak sağlığı (uyarı)' : 'Kaynak sağlığı'}</Btn>
        <Btn size="sm" onClick={() => router.push('/kurallar' as never)} testid="desk-rules" title="Kural sürümleri: yazar ve inceleyici akışı">Kural sürümleri</Btn>
        {o?.canScan ? <Btn kind="pri" size="sm" testid="leg-scan" disabled={scanning} onClick={async () => { setScanning(true); try { const r = await call<{ results?: { created: number }[] }>('POST', '/admin/legislation/scan'); toast(r.results ? `Tarama bitti: ${r.results.reduce((a, x) => a + (x.created ?? 0), 0)} yeni kayıt` : 'Başka bir tarama sürüyor; bitince liste güncellenir.'); await reloadAll(); } catch (e) { toast(errorText(e)); } finally { setScanning(false); } }}>{scanning ? 'Taranıyor… (birkaç dakika sürebilir)' : 'Şimdi tara'}</Btn> : null}
      </>}
      tools={<>
        <Seg label="Durum" testid="leg-view" value={view} onChange={setView} items={VIEWS.map(([k, l]) => ({ key: k, label: l }))} />
        {view === 'open' ? <Seg label="Açık kayıtlar" testid="leg-sub" value={quick === 'unreadable' ? '' : quick} onChange={setView} items={SUBS.map(([k, l]) => ({ key: k, label: l }))} /> : null}
        {view === 'open' && unreadable.length ? <Btn size="sm" onClick={() => set({ quick: 'unreadable', sel: '' })} testid="leg-quick-unreadable">{`Metni okunamadı (${unreadable.length})`}</Btn> : null}
        <Search label="Yayınlarda ara: belge, madde, başlık" placeholder="Belge, madde, başlık ara" value={st.q} onChange={v => set({ q: v })} testid="leg-search" />
        <select className="gh-select" aria-label="Kaynak" data-testid="leg-src" value={st.src} onChange={e => set({ src: e.target.value })}><option value="">Tüm kaynaklar</option>{(o?.sources ?? []).map(s => <option key={s.code} value={s.code}>{SOURCE_TR[s.code] ?? s.name}</option>)}</select>
      </>}>
      {st.health && o ? <Health o={o} /> : null}
      {ov.error && !o ? <Failed what="Mevzuat özeti" message={ov.error} onRetry={reloadAll} /> : null}
      <ListDetail queue ws="leg" label="Mevzuat yayınları" rows={rows} rowId={r => r.id} cols={cols} selId={st.sel ?? ''} onSelect={id => set({ sel: id })} ready={!qa.loading || !!qa.data}
        empty={quick === 'unreadable' ? (unreadable.length ? <>{unreadable.map((k, i) => (
          <div key={k.key} data-testid={`leg-unreadable-${i}`} className="gh-pre" style={{ borderBottom: '1px solid var(--line)' }}><Badge tone="warn">Metni okunamadı</Badge><div className="t" style={{ fontWeight: 600, margin: '6px 0 2px' }}>{k.title}</div>
            <div className="gh-note">{k.why} · {k.firstDay === k.lastDay ? dayTr(k.firstDay) : `${dayTr(k.firstDay)} → ${dayTr(k.lastDay)}`} · {k.scans} taramada. Erişim gelince kuyruğa kendiliğinden bir kez girer.</div>{k.url ? <div style={{ marginTop: 4 }}><Ext href={k.url}>Kaynağı aç</Ext></div> : null}</div>))}</>
          : <Zero title="Metni okunamayan yayın yok" />)
          : (qa.loading && !qa.data) || (!o && !ov.error) ? <Loading what="Yayınlar" />
            : qa.error ? <Failed what="Yayın listesi" message={qa.error} onRetry={reloadAll} />
              : <Zero title="Bu süzgeçte kayıt yok" text="Tarama yeni bir yayın bulduğunda burada görünür. Süzgeçleri değiştirerek diğer kayıtlara bakabilirsin." />}
        panel={st.sel ? <LegPanel key={st.sel} id={st.sel} sources={o?.sources ?? []} total={total} onChanged={reloadAll} /> : null} panelTitle="Yayın ayrıntısı" />
    </Page>
  );
}

function Health({ o }: { o: Overview }) {
  const r = o.schedule.retry;
  return (
    <div data-testid="desk-health" style={{ padding: '12px 22px', borderBottom: '1px solid var(--line)', background: 'var(--surface)', display: 'grid', gap: 6 }}>
      {o.sources.map(s => (
        <div key={s.code} data-testid={`leg-source-${s.code}`}><b>{SOURCE_TR[s.code] ?? s.name}</b> <span style={{ color: 'var(--ink2)' }}>· son deneme {dateTimeTr(s.last_attempt_at)} · son başarılı okuma {dateTimeTr(s.last_success_at)}</span>
          {s.last_error ? <div className="gh-why" style={{ color: 'var(--crit)' }} data-testid={`leg-source-error-${s.code}`}>Son hata ({s.failures_in_row} kez üst üste{s.last_error_at ? ` · ${dateTimeTr(s.last_error_at)}` : ''}): {s.last_error}</div> : null}</div>
      ))}
      {r ? <div className="gh-why" data-testid="desk-retry">{r.awaitingToday ? 'Bugünkü sayı henüz yayımlanmamış, gün tamamlanmadı' : 'Bugünkü planlı tarama başarısız'}: {r.attempts}/{r.maxAttempts} deneme.{r.exhausted ? ' Bugün için deneme hakkı doldu; yarın planlı saatte yeniden denenir (okuma penceresi bu günü de kapsar).' : r.nextAttemptAt ? ` Sonraki deneme: ${dateTimeTr(r.nextAttemptAt)}.` : ''}</div> : <div style={{ color: 'var(--ok)' }}>Bugünkü planlı tarama sorunsuz ya da henüz başlamadı.</div>}
    </div>
  );
}

function SiteList({ items, empty, id }: { items: Site[]; empty: string; id: string }) {
  const [all, setAll] = useState(false); const shown = all ? items : items.slice(0, 4);
  if (!items.length) return <div className="gh-note">{empty}</div>;
  return (
    <>
      {shown.map(s => { const [l, tone] = EFFECT[s.effect] ?? [s.effect, 'info' as const]; return (
        <div key={s.siteId} className="gh-site" data-testid={`leg-impact-${s.siteId}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{s.company}</b><span style={{ color: 'var(--ink2)' }}>· {s.site}</span><Badge tone={tone}>{l}</Badge></div>
          <div className="gh-note" data-testid={`leg-why-applies-${s.siteId}`}><b style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.effect === 'needs_info' ? 'Neden hemen uygulanmıyor: ' : 'Neden: '}</b>{s.reason}</div>
          {s.missingQuestions?.length ? <div className="gh-why" data-testid={`leg-need-${s.siteId}`}>Hangi yanıt gerekli: {s.missingQuestions.map(x => x.label).join(', ')}</div> : null}
          {s.plannedText ? <div className="gh-note" data-testid={`leg-planned-${s.siteId}`}>{s.plannedText}</div> : null}
        </div>); })}
      {items.length > 4 ? <Btn size="sm" kind="ghost" onClick={() => setAll(v => !v)} testid={`leg-more-${id}`}>{all ? 'Daha az göster' : `Tümünü göster (${items.length})`}</Btn> : null}
    </>
  );
}

function LegPanel({ id, sources, total, onChanged }: { id: string; sources: Source[]; total: number; onChanged: () => Promise<void> }) {
  void total; const { call, me } = useSession(); const roles = me?.platformRoles ?? []; const { toast } = useDesk();
  const q = useApi<Detail>(`/admin/legislation/changes/${id}`); const d = q.data?.id === id ? q.data : null;
  const [reason, setReasonS] = useState(DRAFT[id] ?? ''); const setReason = (v: string) => { DRAFT[id] = v; setReasonS(v); };
  const [error, setError] = useState<string | null>(null); const [asg, setAsg] = useState(''); const [asgReason, setAsgReason] = useState(''); const [grantReason, setGrantReason] = useState(''); const [dateIn, setDateIn] = useState(''); const [dateNote, setDateNote] = useState(''); const [busy, setBusy] = useState(false);
  const cands = useApi<Cands>(d?.cannot && d.cannot.assign === null ? `/admin/legislation/changes/${id}/assignees` : null);
  const act = async (fn: () => Promise<unknown>, msg: string) => { setError(null); setBusy(true); try { await fn(); toast(msg); await q.reload(); await cands.reload(); await onChanged(); } catch (e) { setError(errorText(e)); await q.reload(); await onChanged(); } finally { setBusy(false); } };
  if (!d) return q.error ? <Failed what="Yayın ayrıntısı" message={q.error} onRetry={q.reload} /> : <Loading what="Yayın ayrıntısı" />;
  const src = sources.find(s => s.code === d.sourceCode); const [stL, stT] = STATUS_LEG[d.status] ?? [d.status, undefined]; const open = ['pending', 'drafted'].includes(d.status);
  const noReason = reason.trim().length === 0; const why = (k: 'prepare' | 'approve' | 'reject' | 'return', needs: boolean) => d.cannot?.[k] ?? (needs && noReason ? 'Gerekçe yazılmadı.' : null)
    ?? (k === 'approve' && d.missingAreaReviews.length ? `Alan incelemesi bekliyor: ${d.missingAreaReviews.map(a => AREA_TR[a] ?? a).join(', ')}.` : k === 'approve' && d.dateStatus === 'unclear' ? 'Yürürlük tarihi belirsiz.' : null);
  const imp = d.impact; const apply = imp?.sites.filter(s => s.effect !== 'needs_info') ?? []; const need = imp?.sites.filter(s => s.effect === 'needs_info') ?? [];
  const limits = d.proposal?.templates.flatMap(t => (t.limits ?? []).map(l => ({ ...l, t: t.title }))) ?? [];
  const firstDues = (imp?.sites ?? []).flatMap(s => (s.plannedTasks ?? []).map(t => ({ site: `${s.company} · ${s.site}`, t })));
  const base = `/admin/legislation/changes/${id}`;
  const isReviewer = roles.includes('rule_reviewer'); const isAuthor = roles.includes('rule_author');
  const areaMine = open && !!d.reviewAreas?.required.some(a => a.canIReview && !a.approved);
  const now: string[] = !open ? [] : [
    d.cannot?.assign === null ? 'Dosyayı bir inceleyiciye atayabilirsin (bu, ona karar yetkisi vermez).' : null,
    areaMine ? 'Alan incelemesini onaylayabilirsin.' : null,
    d.dateStatus === 'unclear' && d.can.resolveDate ? 'Yürürlük tarihini belirleyebilirsin.' : null,
    isAuthor && d.cannot?.prepare === null ? 'Kural taslağını hazırlayıp incelemeye gönderebilirsin.' : null,
    isReviewer && d.cannot?.approve === null && !d.missingAreaReviews.length && d.dateStatus === 'known' ? 'Gerekçe yazarak onaylayabilirsin.' : null,
    isReviewer && (d.cannot?.reject === null || d.cannot?.return === null) ? 'Gerekçe yazarak reddedebilir ya da iade edebilirsin.' : null,
  ].filter(Boolean) as string[];
  const jumpAssign = () => document.querySelector('[data-testid="leg-assign"]')?.scrollIntoView({ block: 'start' });

  return (
    <>
      <div className="gh-leg">
      <div className="gh-leg-doc">
      <PanelHead eyebrow={<><Badge tone="info">{SOURCE_TR[d.sourceCode] ?? d.sourceCode}</Badge>{d.isExample ? <Badge tone="ex">SENTETİK ÖRNEK · gerçek yayın değil</Badge> : <Badge tone="ok">Gerçek resmî yayın</Badge>}</>}
        title={`${d.docTitle}${d.articleRef ? ` · md. ${d.articleRef}` : ''}`}
        badges={<><span data-testid="leg-status"><Badge tone={stT}>{stL}</Badge></span>{d.dateStatus === 'unclear' ? <Badge tone="warn">Yürürlük tarihi belirsiz</Badge> : <Badge>Yürürlük {dayTr(d.effectiveFrom)}</Badge>}</>} />
      <div className="gh-panel-scroll" data-testid="leg-detail">
        {d.exampleNote ? <p className="gh-note" style={{ margin: '10px 0 6px' }}>{d.exampleNote}</p> : null}

        <Section no={1} title="Yayın" testid="leg-sec-yayin">
          <Kv rows={[['Yayımlayan', SOURCE_TR[d.sourceCode] ?? d.sourceCode], ['Belge', `${d.docRef}${d.articleRef ? ` · madde ${d.articleRef}` : ''}`], ['Yayın tarihi', dayTr(d.publishedOn)], ['Değişiklik türü', <span data-testid="leg-type">{d.typeLabel}</span>],
            ['Resmî bağlantı', <span data-testid="leg-source-link"><Ext href={d.sourceUrl}>Kaynağı aç</Ext><div className="gh-mono" style={{ color: 'var(--ink3)', marginTop: 2, overflowWrap: 'anywhere' }}>{d.sourceUrl}</div></span>],
            ['Kayıt', d.isExample ? 'Sentetik örnek (gerçek bir resmî yayın değildir)' : 'Gerçek resmî yayın']]} />
        </Section>

        <Section no={2} title="Değişiklik" testid="leg-sec-degisiklik">
          {src?.last_error ? <Callout tone="crit" testid="leg-source-bad"><b>Bu kaynak son okumada hata verdi: </b>{src.last_error}. Son sağlıklı okuma: {dateTimeTr(src.last_success_at)}. Aşağıdaki metin bu okumaya ait olmayabilir.</Callout>
            : src ? <div className="gh-note" style={{ marginBottom: 6 }}>{src.last_success_at ? `Kaynak sağlıklı; son başarılı okuma ${dateTimeTr(src.last_success_at)}.` : 'Bu kaynak için kayıtlı başarılı bir okuma yok.'}</div> : null}
          {d.compare?.note ? <Callout tone="info" testid="leg-baseline">{d.compare.note}</Callout> : null}
          <div className="gh-diff"><div data-testid="leg-old"><h4>Eski metin</h4>{d.oldText ?? (/yeni/i.test(d.typeLabel) ? 'Önceki metin yok: yeni yayın.' : 'Önceki metin bu kayıtta yok.')}</div><div className="new" data-testid="leg-new"><h4>Yeni metin</h4>{d.newText ?? (/kald|iptal|mülga/i.test(d.typeLabel) ? 'Madde yürürlükten kalkmış.' : 'Metin bu kayıtta saklanmıyor; resmî bağlantıdan okunmalı.')}</div></div>
          {d.suggestion ? (
            <div className="gh-note" style={{ marginTop: 10 }} data-testid="leg-suggestion"><b style={{ color: 'var(--ink)' }}>Otomatik karşılaştırma (yalnız öneri, karar vermez): </b>{d.suggestion.relevance}
              {d.suggestion.addedWords?.length ? <div>Eklenen sözcükler: {d.suggestion.addedWords.join(', ')}</div> : null}{d.suggestion.removedWords?.length ? <div>Çıkan sözcükler: {d.suggestion.removedWords.join(', ')}</div> : null}
              {d.suggestion.changedNumbers && (d.suggestion.changedNumbers.from.length || d.suggestion.changedNumbers.to.length) ? <div style={{ color: 'var(--warn)', fontWeight: 600 }}>Değişen sayılar: {d.suggestion.changedNumbers.from.join(', ') || '—'} → {d.suggestion.changedNumbers.to.join(', ') || '—'}</div> : null}</div>) : null}
          {d.suggestion?.effectiveDetail ? (
            <div className="gh-note" style={{ marginTop: 8 }} data-testid="leg-effective-detail"><b style={{ color: 'var(--ink)' }}>Yürürlük ayrıntısı: </b>{d.suggestion.effectiveDetail.general.clause ?? 'Metinde genel yürürlük hükmü bulunamadı.'}
              {d.suggestion.effectiveDetail.transitional.map((t, i) => <div key={i}>Geçiş: {t.sentence} ({t.dates.join(', ')})</div>)}{d.suggestion.effectiveDetail.scope ? <div>Kapsam: {d.suggestion.effectiveDetail.scope.text}</div> : null}</div>) : null}
          {d.dateStatus === 'unclear' ? (
            <Callout tone="warn" testid="leg-date-unclear"><b>Yürürlük tarihi belirsiz. </b>{d.dateNote}
              {d.can.resolveDate ? (<><Field label="Yürürlük tarihi (YYYY-AA-GG)" value={dateIn} onChange={setDateIn} testid="leg-date" /><Field label="Gerekçe (Resmî Gazete metnine göre)" value={dateNote} onChange={setDateNote} testid="leg-date-note" />
                <Btn size="sm" testid="leg-date-save" disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(dateIn) || !dateNote.trim()} onClick={() => act(() => call('POST', `${base}/resolve-date`, { date: dateIn, note: dateNote.trim() }), 'Yürürlük tarihi kaydedildi')}>Tarihi kaydet</Btn></>) : <div className="gh-why">Tarihi belirleme yetkisi bu hesapta yok.</div>}
            </Callout>) : null}
          {d.blockers.map(b => <Callout key={b} tone="warn" testid="leg-blocker">{trText(b)}</Callout>)}
        </Section>

        <Section no={3} title="Kapsam" testid="leg-sec-kapsam">
          <Kv rows={[[d.status === 'pending' ? 'Sözcük eşleşmesi (uygulanabilirlik incelenmedi)' : 'İlgili sektör', d.suggestion?.sectors?.length ? d.suggestion.sectors.map(s => SECTOR_TR[s] ?? s).join(', ') : 'Sektör belirlenemedi (yalnız öneridir)'], ['İnceleme alanı', d.reviewAreas?.required.length ? d.reviewAreas.required.map(r => AREA_TR[r.area] ?? r.area).join(', ') : 'Henüz seçilmedi']]} />
          {d.suggestion?.matchLevel === 'uncertain' ? <Callout tone="warn" testid="leg-uncertain-note">Eşleşme belirsiz: başlıktan hangi iş koluna ait olduğu kesin anlaşılmıyor.</Callout> : null}
          {imp ? (
            <>
              <p className="gh-note" data-testid="leg-impact-sum" style={{ margin: '10px 0 4px' }}><b style={{ color: 'var(--ink)' }}>{dayTr(imp.onDate)} günü: </b>{imp.affectedSites} şube etkilenir · {imp.notifiedSites} şubeye bildirim gider · {imp.outOfScopeSites} şube kapsam dışı (hiçbir şey değişmez).</p>
              <h4 style={{ margin: '10px 0 2px', fontSize: 13 }}>Etkilenebilecek şubeler ({apply.length})</h4><SiteList items={apply} empty="Etkilenecek şube yok." id={`a${id}`} />
              {need.length ? <><h4 style={{ margin: '10px 0 2px', fontSize: 13 }}>Bilgisi eksik olanlar ({need.length})</h4><SiteList items={need} empty="" id={`n${id}`} /></> : null}
              <h4 style={{ margin: '10px 0 2px', fontSize: 13 }}>Kapsam dışı kalanlar ({imp.outOfScopeSites})</h4>
              {(imp.outOfScopeSample ?? []).length ? (imp.outOfScopeSample ?? []).map((x, i) => <div key={i} className="gh-note" data-testid={`leg-out-${i}`}>{x.company} · {x.site}: {x.reason}</div>) : <div className="gh-note">Kapsam dışı şube yok.</div>}
            </>
          ) : <Callout tone="info" testid="leg-impact-none">Etki önizlemesi yok. {d.impactNote ?? 'Önce kural önerisi (kapsam koşulu) yazılmalı; şubeler ancak o zaman eşleştirilir.'}</Callout>}
        </Section>

        <Section no={4} title="Uygulama" testid="leg-sec-uygulama">
          <div className="gh-note" style={{ marginBottom: 6 }}><Tag b="source" /> resmî kaynaktan · <Tag b="business_plan" /> işletmenin kendi planından · <Tag b="admin_choice" /> yönetici seçimi ya da örnek (kaynak değil)</div>
          <Kv rows={[['Yürürlük tarihi', <><span className={`gh-from ${d.dateStatus === 'known' ? 'official' : 'example'}`}>{d.dateStatus === 'known' ? 'Resmî kaynak' : 'Belirsiz'}</span>{d.dateStatus === 'known' ? dayTr(d.effectiveFrom) : 'henüz belirlenmedi'}</>],
            ['Uygulama günü', d.frequency?.applyOn ? dayTr(d.frequency.applyOn) : d.applyOn ? dayTr(d.applyOn) : '—']]} />
          {d.frequency ? (<>
            <div className="gh-note" style={{ margin: '8px 0' }} data-testid="leg-freq-says">{d.frequency.sourceSays}</div>
            {d.frequency.checks.length === 0 ? <div className="gh-note">Görev şablonu yok; bu kural görev üretmez.</div> : d.frequency.checks.map(c => (
              <div key={c.code} className="gh-site" data-testid={`leg-freq-check-${c.code}`}><b>{c.title}</b><div>{c.unset ? <span className="gh-why">Tekrar sıklığı seçilmedi: bu kural görev üretmez.</span> : <>Tekrar: {c.text}</>}</div><div style={{ marginTop: 3 }}><Tag b={c.basis} /> <span className="gh-note">{c.basisLabel}{c.basisNote ? ` — ${c.basisNote}` : ''}</span></div></div>))}
          </>) : <div className="gh-note">Kural önerisi yazılmadı: görev sıklığı ve ilk vadeler öneri yazılınca görünür.</div>}
          {firstDues.length ? <div className="gh-note" style={{ marginTop: 8 }} data-testid="leg-firstdue"><b style={{ color: 'var(--ink)' }}>İlk vadeler (örnek şubelerden): </b>{firstDues.slice(0, 3).map(f => `${f.site}: ${f.t.firstDue ? dateTimeTr(f.t.firstDue) : 'belirsiz'}`).join(' · ')}</div> : null}
          {limits.length ? <div style={{ marginTop: 8 }} data-testid="leg-limits"><b style={{ fontSize: 13 }}>Kabul aralıkları</b>{limits.map((l, i) => <div key={i} className="gh-note"><Tag b={l.basis} /> {l.t}: {l.min ?? '…'} – {l.max ?? '…'} {l.unit}{l.note ? ` (${l.note})` : ''}</div>)}</div> : null}
        </Section>

        <Section no={6} title="Geçmiş" testid="leg-sec-gecmis">
          {d.history.length === 0 ? <div className="gh-note">Henüz kayıt yok.</div> : (
            <ul className="gh-hist" data-testid="leg-history">{[...d.history].reverse().map(h => { const r = (h.payload?.reason ?? h.payload?.notes ?? h.payload?.note) as string | undefined; return (
              <li key={h.seq}><span className="w">{dateTimeTr(h.occurred_at)}</span><span><b>{eventTr(h.event_type)}</b> · {h.actor ?? 'sistem'}{h.payload?.ruleVersion ? ` · kural sürümü ${String(h.payload.ruleVersion)}` : ''}{r ? <div className="gh-note">Gerekçe: {r}</div> : null}</span></li>); })}</ul>)}
          <Btn size="sm" kind="ghost" onClick={() => router.push(`/denetim?entity=${id}` as never)} testid="leg-audit-link">Denetim kaydında aç ›</Btn>
        </Section>
      </div>
      </div>
      <div className="gh-leg-act" data-testid="leg-actions">
        <div className="gh-leg-actscroll">
        <div className="gh-leg-top">
        <div className="gh-basis" data-testid="leg-basis">
          <h3>Resmî dayanak</h3>
          <Kv rows={[['Kaynak', <><Ext href={d.sourceUrl}>{SOURCE_TR[d.sourceCode] ?? d.sourceCode}</Ext> · {d.docRef}{d.articleRef ? ` md. ${d.articleRef}` : ''}</>],
            ['Yürürlük', d.dateStatus === 'known' ? dayTr(d.effectiveFrom) : <span style={{ color: 'var(--warn)' }}>Belirsiz: tarih belirlenmedi</span>],
            ['Kapsam', <span data-testid="leg-now-impact">{imp ? `${imp.affectedSites} şube etkilenir · ${imp.outOfScopeSites} şube kapsam dışı (${dayTr(imp.onDate)})` : 'Etki henüz hesaplanamıyor (kapsam koşulu yazılmadı)'}</span>],
            ['Sıklık', d.proposal && d.frequency ? (d.frequency.checks.length ? d.frequency.checks.map(c => `${c.title}: ${c.unset ? 'seçilmedi' : c.text}`).join(' · ') : 'Bu kural görev üretmez') : 'Kural önerisi yazılmadı']]} />
        </div>
        <NowBox testid="leg-now" title={open ? 'Neden bekliyor' : 'Durum'} why={`${d.nextInLine ? trText(d.nextInLine) : stL}${open && !d.assignment ? ' Dosya sorumlusu atanmamış; bu, yukarıdaki inceleme sırasından ayrıdır.' : ''}`} can={open ? now : null}
          note={open && !isReviewer ? 'Onay, ret ve iade bu hesapta kapalı: kararı yalnız kural inceleyici verir.' : null}>
          {open && d.cannot?.assign === null ? <div style={{ marginTop: 6 }}><Btn size="sm" kind="pri" testid="leg-goto-assign" onClick={jumpAssign}>Atamaya git</Btn></div> : null}
        </NowBox>
        </div>
        <div className="gh-leg-decide">
        <Section no={5} title="Karar" testid="leg-sec-karar">
          {d.reviewAreas?.required.length ? d.reviewAreas.required.map(a => (
            <div key={a.area} className="gh-site" data-testid={`leg-area-${a.area}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{AREA_TR[a.area] ?? a.area}</b><Badge tone={a.approved ? 'ok' : 'warn'}>{a.approved ? 'İncelendi' : a.waiting ? 'Kuyrukta bekliyor' : 'İnceleme bekliyor'}</Badge></div>
              <div className="gh-note">{a.waiting ? trText(a.waiting) : `Tanımlı inceleyici: ${a.names.join(', ') || 'yok'}`} · Bu hesap: {trText(a.myAccess)}</div>
              {a.canIReview && !a.approved && open ? <Btn size="sm" testid={`leg-area-approve-${a.area}`} disabled={busy || reason.trim().length < 5} title={reason.trim().length < 5 ? 'Önce gerekçe yaz (en az 5 karakter)' : undefined}
                onClick={() => act(() => call('POST', `/admin/rule-versions/${d.rule!.id}/area-review`, { area: a.area, decision: 'approved', notes: reason.trim() }), 'Alan incelemesi kaydedildi')}>Bu alanı incelendi olarak onayla</Btn> : null}
              {a.canIReview && !a.approved && open && reason.trim().length < 5 ? <div className="gh-why">Pasif: aşağıdaki gerekçe kutusuna en az 5 karakter yaz.</div> : null}
            </div>)) : <div className="gh-note">Bu kayıt için inceleme alanı henüz seçilmedi.</div>}

          <div className="gh-site" data-testid="leg-assign" style={{ marginTop: 10 }}>
            <b>Atama</b> <span data-testid="leg-assignee">{d.assignment ? `· Atanan: ${d.assignment.name ?? '—'} (${dateTimeTr(d.assignment.at)})${d.assignment.note ? ` — ${d.assignment.note}` : ''}` : '· Kayıt kimseye atanmadı (sahipsiz).'}</span>
            <div className="gh-note">Dosyayı bir kişiye atamak ona karar yetkisi VERMEZ. Alan yetkisi ayrı bir işlemdir; ayrı gerekçeyle denetim kaydına yazılır.</div>
            {d.cannot?.assign ? <div className="gh-why" data-testid="leg-cannot-assign">Atama yapılamaz: {d.cannot.assign}</div> : cands.data ? (
              <>
                {cands.data.note ? <div className="gh-why" data-testid="leg-assign-note">{trText(cands.data.note)}</div> : <div className="gh-note">Gerekli alan: {cands.data.needAreas.map(a => AREA_TR[a] ?? a).join(', ') || '—'}</div>}
                {cands.data.candidates.length === 0 ? <div className="gh-why" data-testid="leg-no-reviewer">Platformda inceleyici rolü olan kimse yok: kayıt bekler.</div> : null}
                {cands.data.candidates.length ? (
                  <div className="gh-field"><label htmlFor="asg">Kime atanacak</label>
                    <select id="asg" data-testid="leg-asg-select" value={asg} onChange={e => setAsg(e.target.value)}><option value="">Kişi seç…</option>
                      {cands.data.candidates.map(c => <option key={c.id} value={c.id} disabled={!c.eligible}>{c.name}{c.eligible ? '' : ' — bu alanda yetkisi yok'}</option>)}</select></div>) : null}
                <Field label="Atama gerekçesi (zorunlu, en az 5 karakter)" value={asgReason} onChange={setAsgReason} testid="leg-asg-reason" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn kind="pri" size="sm" testid="leg-assign-btn" disabled={busy || !asg || asgReason.trim().length < 5 || d.assignment?.userId === asg}
                    onClick={() => act(() => call('POST', `${base}/assign`, { userId: asg, reason: asgReason.trim() }), 'Dosya atandı').then(() => setAsg(''))}>Bu kişiye ata</Btn>
                  {d.assignment ? <Btn size="sm" testid="leg-unassign" disabled={busy || asgReason.trim().length < 5} onClick={() => act(() => call('POST', `${base}/assign`, { userId: null, reason: asgReason.trim() }), 'Atama kaldırıldı')}>Atamayı kaldır</Btn> : null}
                </div>
                {!asg || asgReason.trim().length < 5 ? <div className="gh-why" data-testid="leg-assign-why">Pasif: {!asg ? 'kişi seçilmedi' : 'atama gerekçesi eksik'}.</div> : null}
                {cands.data.candidates.some(c => !c.eligible) && cands.data.needAreas.length ? (
                  <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', color: 'var(--ink2)', fontSize: 13 }}>Alan yetkisi ver (ayrı işlem)</summary>
                    <Field label="Alan yetkisi gerekçesi (en az 10 karakter)" value={grantReason} onChange={setGrantReason} testid="leg-grant-reason" />
                    {cands.data.candidates.filter(c => !c.eligible).map(c => <Btn key={c.id} size="sm" testid={`leg-grant-${c.id}`} className="" disabled={busy || grantReason.trim().length < 10}
                      onClick={() => act(() => call('POST', '/admin/reviewer-areas', { userId: c.id, area: cands.data!.needAreas[0], grant: true, reason: grantReason.trim(), changeId: id }), 'Alan yetkisi verildi; dosya henüz atanmadı')}>{c.name}: “{AREA_TR[cands.data!.needAreas[0]!] ?? cands.data!.needAreas[0]}” yetkisi ver</Btn>)}
                  </details>) : null}
              </>) : null}
          </div>
          {!open ? <Callout tone={d.status === 'rejected' ? undefined : 'ok'} testid="leg-final">{d.status === 'rejected' ? `Reddedildi. Gerekçe: ${d.rejectReason ?? 'kayıtlı değil'}` : `Onaylandı. Gerekçe: ${d.approveReason ?? 'kayıtlı değil'}${d.applyOn ? ` · uygulama günü ${dayTr(d.applyOn)}` : ''}${d.appliedAt ? ` · uygulandı ${dateTimeTr(d.appliedAt)}` : ''}`}</Callout> : null}
          {error ? <Callout tone="crit" testid="leg-error"><b>İşlem yapılamadı: </b>{error} <div>Kayıt yeniden yüklendi; başka bir yönetici bu kaydı değiştirmiş olabilir. Güncel durum yukarıda.</div></Callout> : null}
        </Section>

        </div>
        </div>

      {open && d.cannot && (isReviewer || isAuthor) ? (
        <div className="gh-actbar" data-testid="leg-decision">
          {isReviewer ? <Field label="Gerekçe (iade, onay ve ret için zorunlu)" value={reason} onChange={setReason} testid="leg-reason" multiline placeholder="ör. Resmî kaynak okundu; kapsam yemek hazırlayan şubeler" /> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAuthor ? <Btn testid="leg-prepare" disabled={busy || !!why('prepare', false)} onClick={() => act(() => call('POST', `${base}/prepare`), 'Taslak hazırlandı ve incelemeye gönderildi')}>Taslağı hazırla</Btn> : null}
            {isReviewer ? <><Btn testid="leg-return" disabled={busy || !!why('return', true)} onClick={() => act(() => call('POST', `${base}/return`, { reason: reason.trim() }), 'Gerekçeyle iade edildi')}>Gerekçeli iade</Btn>
            <Btn kind="dng" testid="leg-reject" disabled={busy || !!why('reject', true)} onClick={() => act(() => call('POST', `${base}/reject`, { reason: reason.trim() }).then(() => { DRAFT[id] = ''; setReasonS(''); }), 'Reddedildi: hiçbir işletme etkilenmedi')}>Reddet</Btn>
            <Btn kind="pri" testid="leg-approve" disabled={busy || !!why('approve', true)} onClick={() => act(() => call('POST', `${base}/approve`, { reason: reason.trim() }).then(() => { DRAFT[id] = ''; setReasonS(''); }), 'Onaylandı: yürürlük gününde uygulanır')}>Onayla ve planla</Btn></> : null}
          </div>
          {([['approve', 'Onayla', true], ['reject', 'Reddet', true], ['return', 'İade', true], ['prepare', 'Taslak', false]] as const).map(([k, l, n]) => { const w = (k === 'prepare' ? isAuthor : isReviewer) ? why(k, n) : null; return w ? <div key={k} className="gh-why" data-testid={`leg-why-${k}`}>Pasif · {l}: {w}</div> : null; })}
        </div>
      ) : null}
      </div>
      </div>
    </>
  );
}
