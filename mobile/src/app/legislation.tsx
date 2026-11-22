import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, ExampleBadge, Field, Loading, SectionLabel } from '../components/states';
import { Card, FilterChip, PrimaryButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { dayTr, STATUS_TR } from '../features/legislation';
import { useUi } from '../state/app';
import { C, tint, type } from '../theme';

type Source = { code: string; name: string; base_url: string; is_example: boolean; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; last_error_at: string | null; failures_in_row: number;
  last_error_kind?: string | null; last_docs_read?: number | null; last_items_seen?: number | null; queue_total?: number; queue_open?: number };
type Overview = {
  sources: Source[]; lastSuccessfulScan: { finished_at: string; trigger: string } | null; lastRun: { status: string; started_at: string; trigger: string; results?: { source: string; seen: number; selected?: number; uncertain?: number; skipped?: { title: string; why: string }[]; docsRead: number; created: number }[] } | null;
  recentSkipped?: { key: string; url: string | null; status: 'out_of_scope' | 'unreadable'; title: string; why: string; firstDay: string; lastDay: string; scans: number }[];
  pendingReview: number; counts: Record<string, number>; unclearDates: number; schedule: { enabled: boolean; timezone: string; dailyAtHour: number; nextRunAt?: string | null; missedDays?: string[] }; baselineNote?: string; canScan: boolean; exampleNote: string;
};
type Row = { id: string; source_code: string; change_type: string; typeLabel: string; doc_ref: string; doc_title: string; article_ref: string | null; published_on: string | null; effective_from: string | null;
  date_status: 'known' | 'unclear'; status: string; is_example: boolean; apply_on: string | null; match_level?: 'clear' | 'uncertain' | null; sectors?: string[] | null; body_sectors?: string[] | null; waiting_reason?: string | null; source_pub_id?: string | null; source_url?: string | null };
const SECTOR_TR: Record<string, string> = { food: 'Gıda', electrical: 'Elektrik', estate: 'Emlak' };

const ERROR_KIND_TR: Record<string, string> = { timeout: 'Zaman aşımı', blocked: 'Erişim engeli', not_found: 'Sayfa yok', http_error: 'Sunucu hatası', network: 'Bağlantı hatası', empty: 'Boş yanıt', unexpected_format: 'Beklenmeyen biçim (HTML değil / sayfa yapısı değişmiş)', corrupt: 'Bozuk/eksik metin', refused_link: 'Resmî olmayan bağlantı reddedildi', unknown: 'Sınıflanmamış hata' };
const SOURCE_TR: Record<string, string> = { resmi_gazete: 'Resmî Gazete', mevzuat: 'Mevzuat Bilgi Sistemi' };

/** Legislation watch: daily scan health, review queue, manual rescan. Platform staff only. */
export default function LegislationRoute() {
  const { me, call } = useSession();
  const { showToast } = useUi();
  const allowed = (me?.platformRoles ?? []).some(r => ['platform_admin', 'rule_author', 'rule_reviewer'].includes(r));
  const [status, setStatus] = useState<'open' | 'scheduled' | 'applied' | 'rejected'>('open');
  // Masa süzgeçleri: kaynak, metin ve tarih durumu (sunucu tarafında uygulanır).
  const [source, setSource] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [unclearOnly, setUnclearOnly] = useState(false);
  const filt = `${source ? `&source=${encodeURIComponent(source)}` : ''}${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ''}${unclearOnly ? '&dateStatus=unclear' : ''}`;
  const ov = useApi<Overview>(allowed ? '/admin/legislation/overview' : null);
  const pending = useApi<Row[]>(allowed ? `/admin/legislation/changes?status=pending${filt}` : null);
  const drafted = useApi<Row[]>(allowed ? `/admin/legislation/changes?status=drafted${filt}` : null);
  const other = useApi<Row[]>(allowed && status !== 'open' ? `/admin/legislation/changes?status=${status}${filt}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadAll = async () => { await Promise.all([ov.reload(), pending.reload(), drafted.reload(), other.reload()]); };
  const scan = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ status: string; results: { source: string; ok: boolean; created: number; error?: string }[] }>('POST', '/admin/legislation/scan');
      const made = r.results.reduce((a, x) => a + (x.created ?? 0), 0);
      showToast('Tarama bitti', `${made} yeni kayıt kuyruğa düştü${r.status === 'ok' ? '' : ' · bazı kaynaklar okunamadı'}`);
      await reloadAll();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (!allowed) return <Screen title="Mevzuat takibi" titleEn="Legislation watch"><ErrorBox message="Bu ekran yalnız platform yönetimi içindir." /></Screen>;
  const rows = status === 'open' ? [...(pending.data ?? []), ...(drafted.data ?? [])] : other.data ?? [];
  const o = ov.data;

  return (
    <Screen title="Mevzuat takibi" titleEn="Legislation watch" onRefresh={reloadAll} refreshing={ov.loading}>
      {ov.error ? <ErrorBox message={ov.error} onRetry={reloadAll} /> : null}
      {!o && !ov.error ? <Loading /> : null}
      {o ? (
        <>
          <Card testID="leg-health" style={{ gap: 8 }}>
            <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>SON BAŞARILI TARAMA</Text>
            <Text testID="leg-last-ok" style={type(16, 700)}>{o.lastSuccessfulScan ? fmtDateTime(o.lastSuccessfulScan.finished_at) : 'Henüz başarılı tarama yok'}</Text>
            <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>
              {o.schedule.enabled ? `Her gün ${String(o.schedule.dailyAtHour).padStart(2, '0')}:00 (${o.schedule.timezone}) kendiliğinden taranır; başarısız gün yarım saat arayla yeniden denenir.` : 'Günlük otomatik tarama bu ortamda kapalı; yalnız elle taranır.'}
            </Text>
            {o.schedule.enabled ? <Text testID="leg-next-run" style={type(12.5, 600)}>Sıradaki planlı tarama: {o.schedule.nextRunAt ? fmtDateTime(o.schedule.nextRunAt) : '—'}</Text> : null}
            {o.schedule.enabled && o.schedule.missedDays?.length ? <Text testID="leg-missed-days" style={type(12, 600, { color: C.warn, lh: 1.45 })}>⚠ Planlı tarama çalışmayan gün(ler): {o.schedule.missedDays.map(d => d.split('-').reverse().join('.')).join(', ')} (makine/Docker kapalıydı). Sonraki açılışta telafi edilir; Resmî Gazete taraması aradaki günleri geriye dönük okur.</Text> : null}
            {o.baselineNote ? <Text testID="leg-baseline-note" style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{o.baselineNote}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
              <View><Text testID="leg-pending-count" style={type(26, 700, { color: o.pendingReview ? C.warn : C.t1 })}>{o.pendingReview}</Text><Text style={type(11, 500, { color: C.t3 })}>İnceleme bekleyen</Text></View>
              <View><Text style={type(26, 700, { color: o.unclearDates ? C.warn : C.t1 })}>{o.unclearDates}</Text><Text style={type(11, 500, { color: C.t3 })}>Tarihi belirsiz</Text></View>
              <View><Text style={type(26, 700)}>{o.counts.scheduled ?? 0}</Text><Text style={type(11, 500, { color: C.t3 })}>Yürürlük bekliyor</Text></View>
              <View><Text style={type(26, 700)}>{o.counts.applied ?? 0}</Text><Text style={type(11, 500, { color: C.t3 })}>Uygulandı</Text></View>
            </View>
            {o.canScan ? <PrimaryButton testID="leg-scan" label={busy ? 'Taranıyor…' : 'Şimdi tara'} glow={false} height={42} size={12.5} disabled={busy} onPress={scan} /> : null}
            {error ? <ErrorBox message={error} /> : null}
          </Card>

          <SectionLabel>KAYNAKLAR</SectionLabel>
          {o.sources.map(s => (
            <Card key={s.code} testID={`leg-source-${s.code}`} style={{ gap: 5 }} border={s.last_error ? tint.crit(0.35) : C.bd}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={type(14, 700)}>{SOURCE_TR[s.code] ?? s.name}</Text>
                {s.is_example ? <ExampleBadge label="SENTETİK KAYNAK" /> : null}
              </View>
              <Text style={type(11.5, 400, { color: C.t3 })}>{s.base_url}</Text>
              <Text testID={`leg-source-attempt-${s.code}`} style={type(12, 500, { color: C.t2 })}>Son deneme: {s.last_attempt_at ? fmtDateTime(s.last_attempt_at) : 'henüz yok'}</Text>
              <Text style={type(12, 500, { color: C.t2 })}>Son başarılı okuma: {s.last_success_at ? fmtDateTime(s.last_success_at) : 'yok'}</Text>
              <Text testID={`leg-source-counts-${s.code}`} style={type(12, 500, { color: C.t2 })}>Okunan belge: {s.last_docs_read ?? 0} · Taranan kalem/madde: {s.last_items_seen ?? 0} · Kuyrukta: {s.queue_open ?? 0} açık / {s.queue_total ?? 0} toplam</Text>
              {s.last_error ? (
                <Text testID={`leg-source-error-${s.code}`} style={type(12, 600, { color: C.crit, lh: 1.45 })}>{s.last_error_kind ? `${ERROR_KIND_TR[s.last_error_kind] ?? s.last_error_kind} — ` : ''}Hata ({s.failures_in_row} kez üst üste): {s.last_error}{s.last_error_at ? ` · ${fmtDateTime(s.last_error_at)}` : ''}. Son sağlıklı okuma taban olarak korunuyor; bu "değişiklik yok" demek DEĞİLDİR.</Text>
              ) : <Text style={type(12, 500, { color: C.lime })}>Hata yok</Text>}
            </Card>
          ))}
          {(() => { const g = o.lastRun?.results?.find(x => x.source === 'resmi_gazete'); return g && g.selected !== undefined ? (
            <Card testID="leg-stages" style={{ gap: 4 }}>
              <Text style={type(14, 700)}>Son tarama · aşamalar (Resmî Gazete)</Text>
              <Text testID="leg-stage-seen" style={type(12.5, 500, { color: C.t2 })}>1 · Kaynakta görülen yayın: {g.seen}</Text>
              <Text testID="leg-stage-selected" style={type(12.5, 500, { color: C.t2 })}>2 · Desteklenen iş koluna eşleşen aday: {g.selected} · belirsiz (insan sınıflar): {g.uncertain ?? 0} · kapsam dışı: {g.skipped?.length ?? 0}</Text>
              <Text testID="leg-stage-queue" style={type(12.5, 500, { color: C.t2 })}>3 · Onay kuyruğuna bu taramada yeni eklenen: {g.created}</Text>
              <Text testID="leg-stage-applied" style={type(12.5, 500, { color: C.t2 })}>4 · Şubeye uygulanan: onaydan sonra, uygulama kaydında görünür (onaydan önce hiçbir işletme etkilenmez).</Text>
                          </Card>) : null; })()}
          <Card testID="leg-skipped" style={{ gap: 4 }}>
            <Text style={type(14, 700)}>Kapsam dışı sayılan yayınlar · son 14 gün ({o.recentSkipped?.length ?? 0})</Text>
            <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Bunlar kuyruğa GİRMEZ ve bir işletmeyi etkilemez. Bir yayının atlanmış olabileceğini düşünüyorsan buradan bul; sınıflandırma yalnız başlığa ve metindeki iş kolu ifadelerine dayanır.</Text>
            {(o.recentSkipped ?? []).length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Atlanan yayın yok.</Text> : null}
            {(o.recentSkipped ?? []).map((k, i) => (
              <View key={k.key} testID={`leg-skipped-${i}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 6, gap: 2 }}>
                <Text style={type(12.5, 600)}>{k.title}</Text>
                <Text testID={`leg-skipped-status-${i}`} style={type(10.5, 700, { ls: 0.06, color: k.status === 'unreadable' ? C.warn : C.t3 })}>{k.status === 'unreadable' ? 'METNİ OKUNAMADI · SINIFLANDIRILAMADI' : 'KAPSAM DIŞI'} · yayın kimliği {k.key}</Text>
                <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{k.why} ({k.firstDay === k.lastDay ? k.firstDay : `${k.firstDay} → ${k.lastDay}`} · {k.scans} taramada)</Text>
                {k.url ? <Tap testID={`leg-skipped-link-${i}`} onPress={() => { void Linking.openURL(k.url!); }}><Text style={type(11.5, 600, { color: C.info })}>Kaynak yayını aç: {k.url}</Text></Tap> : null}
              </View>
            ))}
          </Card>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>{o.exampleNote}</Text>
        </>
      ) : null}

      <SectionLabel>İNCELEME KUYRUĞU</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {([['open', 'Açık'], ['scheduled', 'Yürürlük bekliyor'], ['applied', 'Uygulandı'], ['rejected', 'Reddedildi']] as const).map(([k, l]) => <FilterChip key={k} testID={`leg-filter-${k}`} label={l} px={12} active={status === k} onPress={() => setStatus(k)} />)}
      </View>
      <Field testID="leg-search" label="Ara (belge, madde, başlık)" value={text} onChangeText={setText} placeholder="ör. LPG, 5996, madde 12" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <FilterChip testID="leg-src-all" label="Tüm kaynaklar" px={12} active={source === null} onPress={() => setSource(null)} />
        {(ov.data?.sources ?? []).map(src => <FilterChip key={src.code} testID={`leg-src-${src.code}`} label={src.name ?? src.code} px={12} active={source === src.code} onPress={() => setSource(src.code)} />)}
        <FilterChip testID="leg-unclear" label="Tarihi belirsiz" px={12} active={unclearOnly} onPress={() => setUnclearOnly(v => !v)} />
      </View>
      {rows.length === 0 && !pending.loading ? <Empty title="Kayıt yok" body="Tarama yeni bir yayın, madde değişikliği ya da yürürlükten kaldırma bulduğunda burada görünür. Hiçbir işletme, sen onaylayana kadar etkilenmez." /> : null}
      {rows.map(r => {
        const [label, color] = STATUS_TR[r.status] ?? [r.status, C.t2];
        return (
          <Tap key={r.id} testID={`leg-row-${r.id}`} onPress={() => router.push(`/legislation/${r.id}`)}>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={type(10.5, 700, { ls: 0.06, color })}>{label}</Text>
                {r.is_example ? <ExampleBadge label="ÖRNEK" /> : null}
                {r.date_status === 'unclear' ? <Text style={type(10.5, 700, { color: C.warn })}>TARİH BELİRSİZ</Text> : null}
                {r.match_level === 'uncertain' ? <Text testID={`leg-uncertain-${r.id}`} style={type(10.5, 700, { color: C.warn })}>BELİRSİZ EŞLEŞME · İNSAN İNCELEMESİ</Text> : null}
                {r.body_sectors?.length ? <Text testID={`leg-body-sectors-${r.id}`} style={type(10.5, 700, { color: C.info })}>METİNDE: {r.body_sectors.map(k => SECTOR_TR[k] ?? k).join(' · ').toUpperCase()}</Text> : null}
                {r.sectors?.length ? <Text testID={`leg-sectors-${r.id}`} style={type(10.5, 700, { color: C.info })}>{r.sectors.map(k => SECTOR_TR[k] ?? k).join(' · ').toUpperCase()}</Text> : null}
              </View>
              <Text style={type(14, 600, { lh: 1.35 })}>{r.doc_title}{r.article_ref ? ` · md. ${r.article_ref}` : ''}</Text>
              <Text style={type(12, 400, { color: C.t2 })}>{r.typeLabel} · {SOURCE_TR[r.source_code] ?? r.source_code} · {r.doc_ref} · yayın {dayTr(r.published_on)} · yürürlük {r.effective_from ? dayTr(r.effective_from) : 'belirsiz'}</Text>
              {r.waiting_reason ? <Text testID={`leg-waiting-${r.id}`} style={type(11.5, 600, { color: C.warn, lh: 1.4 })}>Kuyrukta bekliyor: {r.waiting_reason}</Text> : null}
            </Card>
          </Tap>
        );
      })}
    </Screen>
  );
}
