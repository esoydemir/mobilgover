import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { ErrorBox, ExampleBadge, Loading } from '../components/states';
import { FilterChip, PrimaryButton, Tap } from '../components/ui';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';
import { fmtDateTime } from './dates';
import { LegislationDetail } from './LegislationDetail';
import { dayTr, STATUS_TR } from './legislation';

/** Masaüstü mevzuat masası: sol iş kuyruğu, sağ kayıt. Yalnız platform inceleyicileri içindir (işletme müşterisi ya da şube müdürü ekranı değildir). */
type Source = { code: string; name: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; last_error_at: string | null; failures_in_row: number; last_error_kind?: string | null; queue_open?: number };
type Skipped = { key: string; url: string | null; status: 'out_of_scope' | 'unreadable'; title: string; why: string; firstDay: string; lastDay: string; scans: number };
type Overview = {
  sources: Source[]; lastSuccessfulScan: { finished_at: string } | null; recentSkipped?: Skipped[]; pendingReview: number; unclearDates: number; counts: Record<string, number>; canScan: boolean;
  schedule: { enabled: boolean; dailyAtHour: number; nextRunAt?: string | null; missedDays?: string[]; retry?: { attempts: number; maxAttempts: number; nextAttemptAt: string | null; exhausted: boolean; lastErrors: string[] } | null };
};
export type DeskRow = { id: string; source_code: string; typeLabel: string; doc_ref: string; doc_title: string; article_ref: string | null; published_on: string | null; effective_from: string | null; status: string; is_example: boolean; detected_at: string;
  match_level?: 'clear' | 'uncertain' | null; sectors?: string[] | null; body_sectors?: string[] | null; waiting_reason?: string | null; review_areas?: string[]; assigned_to?: string | null; assignee_name?: string | null; date_status: 'known' | 'unclear' };

const SOURCE_SHORT: Record<string, string> = { resmi_gazete: 'Resmî Gazete', mevzuat: 'Mevzuat B.S.' };
const SECTOR_TR: Record<string, string> = { food: 'Gıda', electrical: 'Elektrik', estate: 'Emlak' };
const QUICK = [['open', 'Açık'], ['mine', 'Bana atanan'], ['unowned', 'Sahipsiz'], ['review', 'İnceleyici bekleyen'], ['uncertain', 'Eşleşmesi belirsiz'], ['unreadable', 'Metni okunamadı'], ['scheduled', 'Yürürlük bekliyor'], ['applied', 'Uygulandı'], ['rejected', 'Reddedildi']] as const;
type Quick = (typeof QUICK)[number][0];
/** Kayıttan dönünce süzgeç ve seçili satır korunur (aynı oturumda ekran yeniden açılsa bile). */
const keep: { quick: Quick; source: string | null; text: string; sel: string | null } = { quick: 'open', source: null, text: '', sel: null };

export const waitText = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return '—';
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} dk` : m < 1440 ? `${Math.floor(m / 60)} sa` : `${Math.floor(m / 1440)} gün`;
};

export function LegislationDesk() {
  const { me, call } = useSession();
  const { showToast } = useUi();
  const params = useLocalSearchParams<{ sel?: string; quick?: string; health?: string }>();
  const allowed = (me?.platformRoles ?? []).some(r => ['platform_admin', 'rule_author', 'rule_reviewer'].includes(r));
  const fromLink = QUICK.find(q => q[0] === params.quick)?.[0];
  // Ana sayfadaki sayaçtan gelindiğinde başka süzgeç kalıntısı olmasın: sayaç ne sayıyorsa liste onu göstermeli.
  const linked = useRef(false);
  if (fromLink && !linked.current) { keep.quick = fromLink; keep.source = null; keep.text = ''; }
  linked.current = true;
  const [quick, setQuickS] = useState<Quick>(fromLink ?? keep.quick);
  const [source, setSourceS] = useState<string | null>(keep.source);
  const [text, setTextS] = useState(keep.text);
  const [sel, setSelS] = useState<string | null>(params.sel ?? keep.sel);
  const setQuick = (v: Quick) => { keep.quick = v; setQuickS(v); };
  const setSource = (v: string | null) => { keep.source = v; setSourceS(v); };
  const setText = (v: string) => { keep.text = v; setTextS(v); };
  const select = useCallback((id: string | null) => {
    keep.sel = id; setSelS(id);
    if (Platform.OS === 'web' && typeof window !== 'undefined') { try { window.history.replaceState(null, '', id ? `/legislation?sel=${id}` : '/legislation'); } catch { /* adres çubuğu güncellenemezse seçim yine de çalışır */ } }
  }, []);
  const [showHealth, setShowHealth] = useState(params.health === '1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filt = `${source ? `&source=${encodeURIComponent(source)}` : ''}${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ''}${quick === 'mine' ? '&assignee=me' : ''}${quick === 'uncertain' ? '&match=uncertain' : ''}`;
  const sA = quick === 'review' ? 'drafted' : ['scheduled', 'applied', 'rejected'].includes(quick) ? quick : 'pending';
  const wantB = ['open', 'mine', 'unowned', 'uncertain'].includes(quick);
  const ov = useApi<Overview>(allowed ? '/admin/legislation/overview' : null);
  const qa = useApi<DeskRow[]>(allowed && quick !== 'unreadable' ? `/admin/legislation/changes?status=${sA}${filt}` : null);
  const qb = useApi<DeskRow[]>(allowed && wantB ? `/admin/legislation/changes?status=drafted${filt}` : null);
  const reloadAll = useCallback(async () => { await Promise.all([ov.reload(), qa.reload(), qb.reload()]); }, [ov, qa, qb]);

  const unreadable = useMemo(() => (ov.data?.recentSkipped ?? []).filter(k => k.status === 'unreadable'), [ov.data]);
  const rows = useMemo(() => {
    if (quick === 'unreadable') return [] as DeskRow[];
    const all = [...(qa.data ?? []), ...(wantB ? qb.data ?? [] : [])];
    return quick === 'unowned' ? all.filter(r => !r.assigned_to) : all;
  }, [qa.data, qb.data, quick, wantB]);

  // Klavye: ↑/↓ (ya da j/k) satır seçer; yazı alanındayken devreye girmez.
  const rowsRef = useRef(rows); rowsRef.current = rows; const selRef = useRef(sel); selRef.current = sel;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key)) return;
      const list = rowsRef.current; if (!list.length) return;
      e.preventDefault();
      const i = list.findIndex(r => r.id === selRef.current); const next = e.key === 'ArrowDown' || e.key === 'j' ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      select(list[next]!.id);
      setTimeout(() => { document.querySelector<HTMLElement>(`[data-testid="leg-row-${list[next]!.id}"]`)?.focus({ preventScroll: false }); }, 0);
    };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [select]);

  const scan = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ status: string; results: { created: number }[] }>('POST', '/admin/legislation/scan');
      showToast('Tarama bitti', `${r.results.reduce((a, x) => a + (x.created ?? 0), 0)} yeni kayıt kuyruğa düştü`); await reloadAll();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!allowed) return <View style={{ flex: 1, padding: 24 }}><ErrorBox message="Bu ekran yalnız platform yönetimi içindir." /></View>;
  const o = ov.data; const r = o?.schedule.retry;
  const failing = (o?.sources ?? []).filter(s => s.last_error);

  return (
    <View testID="leg-desk" style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bd, flexWrap: 'wrap' }}>
        <Tap testID="desk-back" onPress={() => router.replace('/admin')} accessibilityRole="link"><Text style={type(12.5, 600, { color: C.info })}>‹ Yönetim</Text></Tap>
        <Text accessibilityRole="header" style={type(17, 700)}>Mevzuat masası</Text>
        <Text testID="desk-count" style={type(12, 500, { color: C.t2 })}>{o ? `${o.pendingReview} inceleme bekleyen · ${o.unclearDates} tarihi belirsiz · ${o.counts.scheduled ?? 0} yürürlük bekliyor` : ''}</Text>
        <View style={{ flex: 1 }} />
        <Text testID="desk-lastscan" style={type(11.5, 500, { color: C.t3 })}>Son başarılı tarama: {o?.lastSuccessfulScan ? fmtDateTime(o.lastSuccessfulScan.finished_at) : 'yok'}{o?.schedule.enabled && o.schedule.nextRunAt ? ` · sıradaki: ${fmtDateTime(o.schedule.nextRunAt)}` : ''}</Text>
        <FilterChip testID="desk-health-toggle" label={failing.length || r ? `Kaynak sağlığı ⚠` : 'Kaynak sağlığı'} px={12} active={showHealth} onPress={() => setShowHealth(v => !v)} />
        {o?.canScan ? <PrimaryButton testID="leg-scan" label={busy ? 'Taranıyor…' : 'Şimdi tara'} glow={false} height={36} size={12} disabled={busy} onPress={scan} /> : null}
      </View>
      {error ? <View style={{ padding: 10 }}><ErrorBox message={error} /></View> : null}
      {showHealth && o ? (
        <View testID="desk-health" style={{ padding: 14, gap: 6, borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: C.card }}>
          {o.sources.map(s => (
            <View key={s.code} testID={`leg-source-${s.code}`} style={{ gap: 2 }}>
              <Text style={type(12.5, 700)}>{SOURCE_SHORT[s.code] ?? s.name} <Text style={type(11.5, 500, { color: C.t3 })}>· son deneme {s.last_attempt_at ? fmtDateTime(s.last_attempt_at) : 'yok'} · son başarılı okuma {s.last_success_at ? fmtDateTime(s.last_success_at) : 'yok'} · kuyrukta {s.queue_open ?? 0} açık</Text></Text>
              {s.last_error ? <Text testID={`leg-source-error-${s.code}`} style={type(12, 600, { color: C.crit, lh: 1.4 })}>Son hata ({s.failures_in_row} kez üst üste{s.last_error_at ? ` · ${fmtDateTime(s.last_error_at)}` : ''}): {s.last_error}. Bu "değişiklik yok" demek DEĞİLDİR.</Text> : null}
            </View>
          ))}
          {r ? (
            <Text testID="desk-retry" style={type(12, 600, { color: r.exhausted ? C.crit : C.warn, lh: 1.45 })}>
              Bugünkü planlı tarama başarısız: {r.attempts}/{r.maxAttempts} deneme.{' '}
              {r.exhausted ? 'Bugün için deneme hakkı doldu; yarın planlı saatte yeniden denenir.' : r.nextAttemptAt ? `Sonraki deneme: ${fmtDateTime(r.nextAttemptAt)} (aralık 30 dk, 1 sa, 2 sa, 4 sa).` : 'Sonraki deneme bir sonraki zamanlayıcı turunda.'}
              {r.lastErrors.length ? ` Son hata: ${r.lastErrors.join(' · ')}` : ''}
            </Text>
          ) : <Text style={type(12, 500, { color: C.lime })}>Bugünkü planlı tarama sorunsuz ya da henüz başlamadı.</Text>}
          {o.schedule.missedDays?.length ? <Text style={type(12, 600, { color: C.warn })}>Çalışmayan gün(ler): {o.schedule.missedDays.map(d => d.split('-').reverse().join('.')).join(', ')}</Text> : null}
        </View>
      ) : null}

      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View testID="desk-queue" style={{ width: '46%', minWidth: 520, maxWidth: 760, borderRightWidth: 1, borderRightColor: C.bd }}>
          <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: C.bd }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {QUICK.map(([k, l]) => <FilterChip key={k} testID={`leg-quick-${k}`} label={k === 'unreadable' && unreadable.length ? `${l} (${unreadable.length})` : l} px={11} active={quick === k} onPress={() => setQuick(k)} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <DeskSearch value={text} onChange={setText} />
              <FilterChip testID="leg-src-all" label="Tüm kaynaklar" px={10} active={source === null} onPress={() => setSource(null)} />
              {(o?.sources ?? []).map(s => <FilterChip key={s.code} testID={`leg-src-${s.code}`} label={SOURCE_SHORT[s.code] ?? s.name} px={10} active={source === s.code} onPress={() => setSource(s.code)} />)}
            </View>
          </View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 8, borderBottomWidth: 1, borderBottomColor: C.bd }}>
            {HEAD.map(([l, w]) => <Text key={l} style={[type(10, 700, { ls: 0.06, color: C.t3 }), w ? { width: w } : { flex: 1 }]}>{l.toUpperCase()}</Text>)}
          </View>
          <ScrollView testID="desk-rows" style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {(qa.loading && !qa.data) || (!o && !ov.error) ? <Loading /> : null}
            {ov.error ? <View style={{ padding: 10 }}><ErrorBox message={ov.error} onRetry={reloadAll} /></View> : null}
            {quick === 'unreadable' ? (unreadable.length === 0 ? <Text testID="desk-empty" style={{ padding: 16, ...type(12.5, 400, { color: C.t2 }) }}>Metni okunamayan yayın yok.</Text> : unreadable.map((k, i) => (
              <View key={k.key} testID={`leg-unreadable-${i}`} style={{ padding: 12, gap: 3, borderBottomWidth: 1, borderBottomColor: C.bd }}>
                <Text style={type(10.5, 700, { ls: 0.06, color: C.warn })}>METNİ OKUNAMADI · yayın kimliği {k.key}</Text>
                <Text style={type(13, 600, { lh: 1.35 })}>{k.title}</Text>
                <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{k.why} ({k.firstDay === k.lastDay ? dayTr(k.firstDay) : `${dayTr(k.firstDay)} → ${dayTr(k.lastDay)}`} · {k.scans} taramada). Erişim gelince kuyruğa kendiliğinden bir kez girer.</Text>
                {k.url ? <Text style={type(11.5, 600, { color: C.info })} onPress={() => void Linking.openURL(k.url!)}>Kaynak: {k.url}</Text> : null}
              </View>
            ))) : null}
            {quick !== 'unreadable' && rows.length === 0 && !qa.loading ? <Text testID="desk-empty" style={{ padding: 16, ...type(12.5, 400, { color: C.t2, lh: 1.5 }) }}>Bu süzgeçte kayıt yok. Tarama yeni bir yayın bulduğunda burada görünür; sen onaylayana kadar hiçbir işletme etkilenmez.</Text> : null}
            {rows.map(row => <QueueRow key={row.id} row={row} selected={row.id === sel} onSelect={() => select(row.id)} />)}
          </ScrollView>
          <Text style={{ padding: 8, ...type(10.5, 400, { color: C.t3 }) }}>↑ ↓ ile satır seç · gerekçe yazarken klavye kısayolları kapalıdır.</Text>
        </View>
        <View testID="desk-detail" style={{ flex: 1 }}>
          {sel ? <LegislationDetail key={sel} id={sel} embedded onChanged={() => { void reloadAll(); }} /> : (
            <View style={{ padding: 28, gap: 8 }}>
              <Text style={type(15, 700)}>Soldan bir kayıt seç</Text>
              <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Kaynak bağlantısı, eski ve yeni metin, atama, etki önizlemesi ve karar bu bölümde açılır. Süzgeç ve seçili satır kayıttan dönünce korunur.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const HEAD: [string, number | null][] = [['Kaynak', 74], ['Yayın', 62], ['Başlık · sektör · alan', null], ['Atanan', 84], ['Durum', 84], ['Bekleme', 56]];

function DeskSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Yerel bir <input>: web masaüstünde odak halkası ve klavye davranışı tarayıcıdan gelir.
  if (Platform.OS !== 'web') return null;
  return (
    <input data-testid="leg-search" aria-label="Kayıtlarda ara (belge, madde, başlık)" value={value} onChange={e => onChange(e.target.value)} placeholder="Ara: belge, madde, başlık"
      style={{ flex: 1, minWidth: 160, height: 34, padding: '0 10px', borderRadius: 10, border: `1px solid ${C.bd}`, background: 'transparent', color: C.t1, fontSize: 13 }} />
  );
}

function QueueRow({ row, selected, onSelect }: { row: DeskRow; selected: boolean; onSelect: () => void }) {
  const [focus, setFocus] = useState(false);
  const [label, color] = STATUS_TR[row.status] ?? [row.status, C.t2];
  const short = row.status === 'pending' ? 'Bekliyor' : row.status === 'drafted' ? 'Onay bekliyor' : row.status === 'scheduled' ? 'Planlandı' : row.status === 'applied' ? 'Uygulandı' : 'Reddedildi';
  const sectors = [...new Set([...(row.sectors ?? []), ...(row.body_sectors ?? [])])].map(k => SECTOR_TR[k] ?? k).join(' · ');
  return (
    <Tap testID={`leg-row-${row.id}`} onPress={onSelect} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${row.doc_title}. ${label}. Atanan: ${row.assignee_name ?? 'yok'}`}
      style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: selected ? tint.info(0.12) : 'transparent', borderLeftWidth: 3, borderLeftColor: selected ? C.info : 'transparent',
        ...(focus ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: C.info, outlineOffset: -2 } : {}) } as never}>
      <View style={{ width: 74, gap: 2 }}>
        <Text style={type(11, 600)}>{SOURCE_SHORT[row.source_code] ?? row.source_code}</Text>
        <Text numberOfLines={1} style={type(9.5, 500, { color: C.t3 })}>{row.doc_ref}</Text>
      </View>
      <Text style={[type(11.5, 500), { width: 62 }]}>{dayTr(row.published_on)}</Text>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={2} style={type(12.5, 600, { lh: 1.3 })}>{row.doc_title}{row.article_ref ? ` · md. ${row.article_ref}` : ''}</Text>
        <Text numberOfLines={1} style={type(10.5, 500, { color: C.info })}>{sectors || 'sektör belirsiz'} · {row.review_areas?.length ? row.review_areas.join(', ') : 'alan seçilmedi'}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {row.is_example ? <ExampleBadge label="ÖRNEK" /> : null}
          {row.match_level === 'uncertain' ? <Text style={type(10, 700, { color: C.warn })}>EŞLEŞME BELİRSİZ</Text> : null}
          {row.date_status === 'unclear' ? <Text style={type(10, 700, { color: C.warn })}>TARİH BELİRSİZ</Text> : null}
        </View>
        {row.waiting_reason ? <Text testID={`leg-waiting-${row.id}`} numberOfLines={2} style={type(10.5, 600, { color: C.warn, lh: 1.35 })}>{row.waiting_reason}</Text> : null}
      </View>
      <Text numberOfLines={2} style={[type(11, row.assignee_name ? 600 : 500, { color: row.assignee_name ? C.t1 : C.t3 }), { width: 84 }]}>{row.assignee_name ?? 'sahipsiz'}</Text>
      <Text style={[type(10, 700, { ls: 0.04, color }), { width: 84 }]}>{short.toUpperCase()}</Text>
      <Text style={[type(11, 500, { color: C.t2 }), { width: 56 }]}>{waitText(row.detected_at)}</Text>
    </Tap>
  );
}
