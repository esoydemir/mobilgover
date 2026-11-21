import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton, Tap } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { AppointmentCard, MessageThread } from '../../features/ServiceExtras';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { REQ_STATUS } from '../services';

type Quote = { id: string; display_name: string; provider_profile_id: string; scope: string; exclusions: string; price_net: number; vat_rate: number; price_gross: number;
  materials: string; duration_text: string; warranty_text: string; deliverable: string; valid_until: string; status: string; expired: boolean;
  providerStatus: { live: boolean; label: string; note: string | null } };
type Job = { id: string; status: string; checkin_code: string; checked_in_at: string | null; report: string | null; report_submitted_at: string | null; accepted_at: string | null;
  business_note: string | null; payment_status: string; cancel_reason: string | null };
type Review = { id: string; quality: number; timeliness: number; communication: number; comment: string | null; show_on_profile: boolean; created_at: string };
type Detail = { request: { id: string; title: string; description: string; category_name: string; status: string; ncr_id: string | null; created_at: string; cancel_reason: string | null };
  quotes: Quote[]; job: Job | null; review?: Review | null; canReview?: boolean; canCancel: boolean; mode: 'direct' | 'open' | 'selected'; modeNote: string; invitedProviders?: { profileId: string; name: string }[];
  comparison: { key: string; label: string }[] | null; jobProviderStatus: Quote['providerStatus'] | null;
  reportDocuments?: { document_id: string; version_id: string; version: number; review_status: string; is_latest: boolean; site_name: string; task_title: string | null }[];
  reports: { version: number; report: string; submitted_at: string; decision: string | null; decision_note: string | null; decided_at: string | null; decided_by_name: string | null }[];
  history: { event_type: string; payload: any; occurred_at: string; actor_name: string | null }[] };

const JOB_TEXT: Record<string, string> = {
  scheduled: 'Planlandı · uzman gelince giriş kodunu ona göster', checked_in: 'Uzman giriş yaptı (yalnızca yerinde bulunma kaydı)',
  report_submitted: 'Hizmet raporu geldi · kabul et ya da gerekçeyle revizyon iste', accepted: 'Teslim kabul edildi', disputed: 'İtiraz edildi',
  revision_requested: 'Revizyon istendi · uzmanın yeni raporu bekleniyor', cancelled: 'İş iptal edildi',
};
const EVENT: Record<string, string> = { 'service.requested': 'Talep açıldı', 'service.quote_submitted': 'Teklif geldi', 'service.quote_accepted': 'Teklif kabul edildi',
  'service.checked_in': 'Uzman giriş yaptı', 'service.report_submitted': 'Rapor teslim edildi', 'service.revision_requested': 'Revizyon istendi', 'service.accepted': 'Teslim kabul edildi',
  'service.disputed': 'İtiraz edildi', 'service.reviewed': 'Değerlendirildi', 'service.job_cancelled': 'İş iptal edildi', 'service.request_cancelled': 'Talep iptal edildi' };
const cell = (q: Quote, k: string) => k === 'price' ? `₺${q.price_gross} (₺${q.price_net} + KDV %${q.vat_rate})` : k === 'valid_until' ? `${fmtDateTime(q.valid_until)}${q.expired ? ' · süresi doldu' : ''}`
  : (q as unknown as Record<string, string>)[k] || '—';

export default function ServiceDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Detail>(company ? `/companies/${company.id}/service-requests/${id}` : null);
  const [note, setNote] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadWith, setThreadWith] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Screen title="Hizmet talebi" titleEn="Service request">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); showToast(msg); setNote(''); await q.reload(); } catch (e) { setError(errorText(e)); }
  };
  const live = d.quotes.filter(x => x.status !== 'rejected');

  return (
    <Screen title="Hizmet talebi" titleEn="Service request" onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill label={REQ_STATUS[d.request.status]![0]} fg={REQ_STATUS[d.request.status]![1]} bg={REQ_STATUS[d.request.status]![2]} />
        <Pill label={d.mode === 'direct' ? 'DOĞRUDAN TEK UZMAN' : d.mode === 'selected' ? 'SEÇİLİ UZMANLAR' : 'ÇOK TEKLİFLİ'} fg={C.info} bg={tint.info(0.12)} />
      </View>
      <Text style={type(22, 600, { family: 'outfit', ls: -0.03 })}>{d.request.title}</Text>
      <Text style={type(13.5, 400, { color: C.t2, lh: 1.5 })}>{d.request.description}</Text>
      <Text style={type(11.5, 400, { color: C.t3 })}>{d.request.category_name} · {fmtDateTime(d.request.created_at)}</Text>
      <Text testID="svc-mode" style={type(12, 500, { color: C.t2, lh: 1.45 })}>{d.modeNote}</Text>
      {d.request.cancel_reason ? <Text style={type(12.5, 600, { color: C.crit })}>İptal edildi: {d.request.cancel_reason}</Text> : null}
      {d.request.ncr_id ? <GhostButton label="Bağlı uygunsuzluğu aç" height={40} size={12.5} onPress={() => router.push(`/ncr/${d.request.ncr_id}`)} /> : null}

      {d.job ? (
        <Card border={tint.lime(0.3)}>
          <Eyebrow color={C.lime}>HİZMET İŞİ</Eyebrow>
          <Text testID="job-status" style={[type(14, 600), { marginTop: 10 }]}>{JOB_TEXT[d.job.status] ?? d.job.status}</Text>
          {d.jobProviderStatus && !d.jobProviderStatus.live && d.job.status !== 'accepted' && d.job.status !== 'cancelled' ? (
            <View testID="job-provider-warning" style={{ marginTop: 10, borderWidth: 1, borderColor: tint.warn(0.4), borderRadius: 14, padding: 11, gap: 4 }}>
              <Text style={type(12, 700, { color: C.warn })}>{d.jobProviderStatus.label.toLocaleUpperCase('tr')}</Text>
              <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{d.jobProviderStatus.note}</Text>
            </View>
          ) : null}
          {d.job.status === 'scheduled' ? (
            <View style={{ marginTop: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.bds, borderRadius: 16, padding: 14 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>UZMANA GÖSTERECEĞİN GİRİŞ KODU</Text>
              <Text testID="job-code" style={type(30, 600, { family: 'mono', ls: 0.1 })}>{d.job.checkin_code}</Text>
            </View>
          ) : null}
          {d.reports.map(r => (
            <View key={r.version} testID={`job-report-${r.version}`} style={{ marginTop: 12, gap: 4, opacity: r.version === d.reports.length ? 1 : 0.75 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>UZMAN RAPORU · SÜRÜM {r.version} · {fmtDateTime(r.submitted_at)}</Text>
              <Text style={type(13, 400, { lh: 1.5 })}>{r.report}</Text>
              {r.decision ? <Text style={type(11.5, 500, { color: r.decision === 'accepted' ? C.lime : C.warn, lh: 1.45 })}>{r.decision === 'accepted' ? 'Kabul edildi' : 'Revizyon istendi'} · {r.decided_by_name} · {r.decision_note}</Text> : null}
            </View>
          ))}
          {d.reportDocuments?.length ? (
            <View testID="job-report-docs" style={{ marginTop: 12, gap: 6, borderWidth: 1, borderColor: tint.info(0.3), borderRadius: 16, padding: 12 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.info })}>RAPOR DOSYASI · BELGE KASASI</Text>
              <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>Şube: {d.reportDocuments[0]!.site_name}{d.reportDocuments[0]!.task_title ? ` · Görev: ${d.reportDocuments[0]!.task_title}` : ''}</Text>
              {d.reportDocuments.map(v => (
                <Text key={v.version_id} style={type(12, v.is_latest ? 600 : 400, { color: v.is_latest ? C.t1 : C.t3, lh: 1.45 })}>
                  Sürüm {v.version}{v.is_latest ? ' · SON SÜRÜM' : ' · önceki'} · {({ unreviewed: 'İNCELEME BEKLİYOR', verified: 'İNCELENDİ', rejected: 'KABUL EDİLMEDİ' } as Record<string, string>)[v.review_status]}
                </Text>
              ))}
              <GhostButton testID="job-report-doc-open" label="Raporu belge kasasında aç" height={36} size={12} onPress={() => router.push(`/documents/${d.reportDocuments![0]!.document_id}` as never)} />
              <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Teslimi kabul etmek dosyayı doğrulamaz; dosyayı belge kasasında ayrıca inceleyen kişi doğrular. Bağlı görev o zamana kadar açık kalır.</Text>
            </View>
          ) : null}
          {d.job.status === 'report_submitted' ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Field testID="job-note" value={note} onChangeText={setNote} multiline placeholder="Raporu okudun mu, işi kontrol ettin mi? Revizyon istiyorsan neyin eksik olduğunu yaz." />
              {note.trim().length < 5 ? (
                <Text testID="job-accept-hint" style={type(11.5, 600, { color: C.warn, lh: 1.45 })}>Teslim kabul etmek için en az 5 karakterlik bir not yaz ({note.trim().length}/5). Not kabul kaydına eklenir.</Text>
              ) : null}
              <PrimaryButton testID="job-accept" label="Teslim kabul et" disabled={note.trim().length < 5} height={46} size={13.5}
                onPress={() => act(() => call('POST', `/companies/${company!.id}/jobs/${d.job!.id}/acceptance`, { accept: true, note: note.trim() }), 'Teslim kabul edildi')} />
              <GhostButton testID="job-revision" label="Gerekçeyle revizyon iste" disabled={note.trim().length < 10} color={C.warn} border={tint.warn(0.35)}
                onPress={() => act(() => call('POST', `/companies/${company!.id}/jobs/${d.job!.id}/acceptance`, { accept: false, note: note.trim() }), 'Revizyon istendi', )} />
              <Text style={type(11, 400, { color: C.t3, lh: 1.45 })}>Teslim kabulü teknik etkinlik değildir: bağlı uygunsuzlukta sorunun giderildiğini ayrıca (ör. yeni ölçümle) kontrol et.</Text>
            </View>
          ) : null}
          {d.job.cancel_reason ? <Text style={[type(12, 500, { color: C.crit }), { marginTop: 10 }]}>İptal gerekçesi: {d.job.cancel_reason}</Text> : null}
          {d.review ? (
            <View testID="job-review" style={{ marginTop: 12, gap: 3 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>DEĞERLENDİRMEN</Text>
              <Text style={type(12.5, 500)}>Kalite {d.review.quality} · zamanlama {d.review.timeliness} · iletişim {d.review.communication} (5 üzerinden)</Text>
              {d.review.comment ? <Text style={type(12, 400, { color: C.t2 })}>{d.review.comment}</Text> : null}
              <Text style={type(11, 400, { color: C.t3 })}>{d.review.show_on_profile ? 'Uzman profilinde işletme adın olmadan görünür.' : 'Uzman profilinde görünmez.'}</Text>
            </View>
          ) : d.canReview ? <ReviewForm jobId={d.job.id} onDone={q.reload} /> : d.job.status !== 'accepted' ? <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 10 }]}>Değerlendirme yalnız teslimi kabul edilmiş işe yapılır.</Text> : null}
          <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 12 }]}>Ödeme: bu aşamada uygulama dışında. QR/kod girişi işin yapıldığını kanıtlamaz; rapor ve teslim kabulü ayrıdır.</Text>
        </Card>
      ) : null}

      {d.job && d.job.status !== 'cancelled' ? <AppointmentCard jobId={d.job.id} editable={d.job.status === 'scheduled'} /> : null}

      <Eyebrow>TEKLİFLER ({d.quotes.length})</Eyebrow>
      {d.quotes.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz teklif gelmedi. Yalnızca bu kategoride onaylı uzmanlar teklif verebilir.</Text> : null}
      {d.comparison && live.length > 1 ? (
        <View testID="quote-compare"><Card style={{ gap: 0, paddingHorizontal: 0 }}>
          <Text style={[type(11, 700, { ls: 0.08, color: C.t3 }), { paddingHorizontal: 16, marginBottom: 8 }]}>KARŞILAŞTIRMA · AYNI SIRA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ paddingHorizontal: 16 }}>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 96 }} />
                {live.map(qt => <Text key={qt.id} style={[type(12.5, 700), { width: 170, paddingRight: 10 }]} numberOfLines={2}>{qt.display_name}</Text>)}
              </View>
              {d.comparison.map(row => (
                <View key={row.key} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.bd, paddingVertical: 6 }}>
                  <Text style={[type(11.5, 600, { color: C.t3 }), { width: 96 }]}>{row.label}</Text>
                  {live.map(qt => <Text key={qt.id} style={[type(11.5, 400, { color: row.key === 'exclusions' ? C.warn : C.t1, lh: 1.4 }), { width: 170, paddingRight: 10 }]}>{cell(qt, row.key)}</Text>)}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card></View>
      ) : null}
      {d.quotes.map(qt => (
        <Card key={qt.id} border={qt.status === 'accepted' ? tint.lime(0.35) : C.bd} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type(14, 600), { flex: 1 }]} onPress={() => router.push(`/pro?view=${qt.provider_profile_id}`)}>{qt.display_name}</Text>
            <Text style={type(19, 600, { family: 'outfit' })}>₺{qt.price_gross}</Text>
          </View>
          <Text testID={`quote-provider-${qt.id}`} style={type(11.5, 600, { color: qt.providerStatus.live ? C.lime : C.crit })}>{qt.providerStatus.label}</Text>
          {(d.comparison ?? [{ key: 'scope', label: 'Kapsam' }, { key: 'exclusions', label: 'Hariç tutulanlar' }, { key: 'price', label: 'Ücret (KDV dahil)' }, { key: 'duration_text', label: 'Süre' },
            { key: 'deliverable', label: 'Teslim edilecek çıktı' }, { key: 'warranty_text', label: 'Garanti' }, { key: 'valid_until', label: 'Teklif geçerliliği' }]).map(row => (
            <View key={row.key} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[type(12, 400, { color: C.t3 }), { width: 96 }]}>{row.label}</Text>
              <Text style={[type(12, 400, { color: row.key === 'exclusions' ? C.warn : C.t1, lh: 1.4 }), { flex: 1 }]}>{cell(qt, row.key)}</Text>
            </View>
          ))}
          {qt.providerStatus.note && qt.status === 'submitted' ? <Text style={type(11.5, 400, { color: C.crit, lh: 1.45 })}>{qt.providerStatus.note}</Text> : null}
          {d.request.status === 'open' && qt.status === 'submitted' && !qt.expired && qt.providerStatus.live ? (
            <PrimaryButton testID="quote-accept" label="Bu teklifi kabul et" height={44} size={13} glow={false}
              onPress={() => act(() => call('POST', `/companies/${company!.id}/quotes/${qt.id}/accept`), 'Teklif kabul edildi')} />
          ) : <Text style={type(11.5, 600, { color: qt.status === 'accepted' ? C.lime : C.t3 })}>{qt.status === 'accepted' ? 'Kabul edildi' : qt.status === 'rejected' ? 'Seçilmedi / kapandı' : qt.expired ? 'Süresi doldu' : !qt.providerStatus.live ? 'Kabul edilemez' : qt.status}</Text>}
        </Card>
      ))}
      {d.canCancel ? (
        cancelOpen ? (
          <Card style={{ gap: 8 }}>
            <Field label="İptal gerekçesi" testID="svc-cancel-reason" value={cancelReason} onChangeText={setCancelReason} multiline />
            <GhostButton testID="svc-cancel" label={d.job ? 'İşi iptal et' : 'Talebi iptal et'} color={C.crit} border={tint.crit(0.35)} disabled={cancelReason.trim().length < 10}
              onPress={() => act(() => call('POST', `/companies/${company!.id}/service-requests/${d.request.id}/cancel`, { reason: cancelReason.trim() }), 'İptal edildi')} />
          </Card>
        ) : <Text testID="svc-cancel-open" onPress={() => setCancelOpen(true)} style={type(12, 500, { color: C.crit })}>{d.job ? 'İşi gerekçeyle iptal et' : 'Talebi gerekçeyle iptal et'}</Text>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      {(() => {
        const people = new Map<string, string>();
        for (const x of d.invitedProviders ?? []) people.set(x.profileId, x.name);
        for (const x of d.quotes) people.set(x.provider_profile_id, x.display_name);
        if (!people.size || d.request.status === 'cancelled') return null;
        return (
          <View style={{ gap: 8 }}>
            <Eyebrow>YAZIŞMA</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {[...people].map(([pid, name]) => <GhostButton key={pid} testID={`msg-with-${pid}`} label={`${name} ile yaz`} height={36} size={12} onPress={() => setThreadWith(threadWith === pid ? null : pid)} />)}
            </View>
            {threadWith ? <MessageThread requestId={d.request.id} profileId={threadWith} /> : null}
          </View>
        );
      })()}
      {d.history.length ? (
        <Card style={{ gap: 5 }}>
          <Eyebrow>GEÇMİŞ</Eyebrow>
          {d.history.map((h, i) => <Text key={i} style={type(12, 400, { color: C.t2, lh: 1.4 })}>{EVENT[h.event_type] ?? h.event_type}{h.payload?.reason ? ` · ${h.payload.reason}` : h.payload?.note ? ` · ${h.payload.note}` : ''} · {h.actor_name ?? 'uzman'} · {fmtDateTime(h.occurred_at)}</Text>)}
        </Card>
      ) : null}
    </Screen>
  );
}

/** Only for a job whose report was delivered and accepted; one review per job. */
function ReviewForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { company, call } = useSession();
  const { showToast } = useUi();
  const [scores, setScores] = useState<Record<'quality' | 'timeliness' | 'communication', number>>({ quality: 0, timeliness: 0, communication: 0 });
  const [comment, setComment] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Object.values(scores).every(v => v >= 1);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await call('POST', `/companies/${company!.id}/jobs/${jobId}/review`, { ...scores, comment: comment.trim() || null, showOnProfile: show });
      showToast('Değerlendirme kaydedildi', show ? 'Uzman profilinde işletme adın olmadan görünecek.' : 'Uzman profilinde görünmeyecek.');
      onDone();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: 14, gap: 10, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 12 }}>
      <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>HİZMETİ DEĞERLENDİR</Text>
      {([['quality', 'İşin kalitesi'], ['timeliness', 'Zamanlama'], ['communication', 'İletişim']] as const).map(([k, l]) => (
        <View key={k} style={{ gap: 6 }}>
          <Text style={type(12.5, 600)}>{l}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <Tap key={n} testID={`review-${k}-${n}`} onPress={() => setScores(s => ({ ...s, [k]: n }))}
                style={{ width: 38, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                  borderColor: scores[k] >= n ? tint.lime(0.4) : C.bd, backgroundColor: scores[k] >= n ? tint.lime(0.1) : C.chip }}>
                <Text style={type(13, 600, { color: scores[k] >= n ? C.lime : C.t2 })}>{n}</Text>
              </Tap>
            ))}
          </View>
        </View>
      ))}
      <Field label="Yorum (isteğe bağlı)" testID="review-comment" value={comment} onChangeText={setComment} multiline />
      <Tap testID="review-show" onPress={() => setShow(x => !x)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: show ? C.lime : C.t3, backgroundColor: show ? C.lime : 'transparent' }} />
        <Text style={[type(12.5, 500), { flex: 1 }]}>Uzman profilinde gösterilmesine izin ver (işletme adı gösterilmez; kategori, şehir ve ay görünür)</Text>
      </Tap>
      {error ? <ErrorBox message={error} /> : null}
      <PrimaryButton testID="review-save" label={busy ? 'Kaydediliyor…' : 'Değerlendirmeyi kaydet'} glow={false} height={44} size={13} disabled={busy || !ready} onPress={save} />
    </View>
  );
}
