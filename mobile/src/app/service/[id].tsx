import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../api/session';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { ErrorBox, Field, Loading } from '../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton } from '../../components/ui';
import { fmtDateTime } from '../../features/dates';
import { useUi } from '../../state/app';
import { C, tint, type } from '../../theme';
import { REQ_STATUS } from '../services';

type Quote = { id: string; display_name: string; provider_profile_id: string; scope: string; exclusions: string; price_net: number; vat_rate: number; price_gross: number;
  materials: string; duration_text: string; warranty_text: string; valid_until: string; status: string; expired: boolean };
type Job = { id: string; status: string; checkin_code: string; checked_in_at: string | null; report: string | null; report_submitted_at: string | null; accepted_at: string | null; business_note: string | null; payment_status: string };
type Detail = { request: { id: string; title: string; description: string; category_name: string; status: string; ncr_id: string | null; created_at: string }; quotes: Quote[]; job: Job | null };

const JOB_TEXT: Record<string, string> = {
  scheduled: 'Planlandı · uzman gelince giriş kodunu ona göster', checked_in: 'Uzman giriş yaptı (yalnızca yerinde bulunma kaydı)',
  report_submitted: 'Hizmet raporu geldi · teslim kabulünü yap', accepted: 'Teslim kabul edildi', disputed: 'İtiraz edildi',
};

export default function ServiceDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { company, call } = useSession();
  const { showToast } = useUi();
  const q = useApi<Detail>(company ? `/companies/${company.id}/service-requests/${id}` : null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Screen title="Hizmet talebi" titleEn="Service request">{q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : <Loading />}</Screen>;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); showToast(msg); await q.reload(); } catch (e) { setError(errorText(e)); }
  };

  return (
    <Screen title="Hizmet talebi" titleEn="Service request" onRefresh={q.reload} refreshing={q.loading}>
      <Pill label={REQ_STATUS[d.request.status]![0]} fg={REQ_STATUS[d.request.status]![1]} bg={REQ_STATUS[d.request.status]![2]} style={{ alignSelf: 'flex-start' }} />
      <Text style={type(22, 600, { family: 'outfit', ls: -0.03 })}>{d.request.title}</Text>
      <Text style={type(13.5, 400, { color: C.t2, lh: 1.5 })}>{d.request.description}</Text>
      <Text style={type(11.5, 400, { color: C.t3 })}>{d.request.category_name} · {fmtDateTime(d.request.created_at)}</Text>
      {d.request.ncr_id ? <GhostButton label="Bağlı uygunsuzluğu aç" height={40} size={12.5} onPress={() => router.push(`/ncr/${d.request.ncr_id}`)} /> : null}

      {d.job ? (
        <Card border={tint.lime(0.3)}>
          <Eyebrow color={C.lime}>HİZMET İŞİ</Eyebrow>
          <Text testID="job-status" style={[type(14, 600), { marginTop: 10 }]}>{JOB_TEXT[d.job.status] ?? d.job.status}</Text>
          {d.job.status === 'scheduled' ? (
            <View style={{ marginTop: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.bds, borderRadius: 16, padding: 14 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>UZMANA GÖSTERECEĞİN GİRİŞ KODU</Text>
              <Text testID="job-code" style={type(30, 600, { family: 'mono', ls: 0.1 })}>{d.job.checkin_code}</Text>
            </View>
          ) : null}
          {d.job.report ? (
            <View style={{ marginTop: 12, gap: 4 }}>
              <Text style={type(11, 600, { ls: 0.1, color: C.t3 })}>UZMAN RAPORU · {fmtDateTime(d.job.report_submitted_at!)}</Text>
              <Text style={type(13, 400, { lh: 1.5 })}>{d.job.report}</Text>
            </View>
          ) : null}
          {d.job.status === 'report_submitted' ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Field testID="job-note" value={note} onChangeText={setNote} multiline placeholder="Raporu okudun mu, işi kontrol ettin mi? (ör. ölçüm tekrarlandı 3 °C)" />
              <PrimaryButton testID="job-accept" label="Teslim kabul et" disabled={note.trim().length < 5} height={46} size={13.5}
                onPress={() => act(() => call('POST', `/companies/${company!.id}/jobs/${d.job!.id}/acceptance`, { accept: true, note: note.trim() }), 'Teslim kabul edildi')} />
              <GhostButton label="İtiraz et" disabled={note.trim().length < 5} color={C.crit} border={tint.crit(0.35)}
                onPress={() => act(() => call('POST', `/companies/${company!.id}/jobs/${d.job!.id}/acceptance`, { accept: false, note: note.trim() }), 'İtiraz kaydedildi')} />
            </View>
          ) : null}
          {d.job.business_note ? <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 10 }]}>Notun: {d.job.business_note}</Text> : null}
          <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 12 }]}>Ödeme: bu aşamada uygulama dışında. QR/kod girişi işin yapıldığını kanıtlamaz; rapor ve teslim kabulü ayrıdır.</Text>
        </Card>
      ) : null}

      <Eyebrow>TEKLİFLER ({d.quotes.length})</Eyebrow>
      {d.quotes.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Henüz teklif gelmedi. Yalnızca bu kategoride onaylı uzmanlar teklif verebilir.</Text> : null}
      {d.quotes.map(qt => (
        <Card key={qt.id} border={qt.status === 'accepted' ? tint.lime(0.35) : C.bd} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type(14, 600), { flex: 1 }]} onPress={() => router.push(`/pro?view=${qt.provider_profile_id}`)}>{qt.display_name}</Text>
            <Text style={type(19, 600, { family: 'outfit' })}>₺{qt.price_gross}</Text>
          </View>
          {[['Kapsam', qt.scope], ['Dahil değil', qt.exclusions], ['Fiyat', `₺${qt.price_net} + KDV %${qt.vat_rate}`], ['Malzeme', qt.materials], ['Süre', qt.duration_text], ['Garanti', qt.warranty_text], ['Geçerlilik', `${fmtDateTime(qt.valid_until)}${qt.expired ? ' · süresi doldu' : ''}`]].map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[type(12, 400, { color: C.t3 }), { width: 82 }]}>{k}</Text>
              <Text style={[type(12, 400, { color: k === 'Dahil değil' ? C.warn : C.t1, lh: 1.4 }), { flex: 1 }]}>{v}</Text>
            </View>
          ))}
          {d.request.status === 'open' && qt.status === 'submitted' && !qt.expired ? (
            <PrimaryButton testID="quote-accept" label="Bu teklifi kabul et" height={44} size={13} glow={false}
              onPress={() => act(() => call('POST', `/companies/${company!.id}/quotes/${qt.id}/accept`), 'Teklif kabul edildi')} />
          ) : <Text style={type(11.5, 600, { color: qt.status === 'accepted' ? C.lime : C.t3 })}>{qt.status === 'accepted' ? 'Kabul edildi' : qt.status === 'rejected' ? 'Başka teklif seçildi' : qt.status}</Text>}
        </Card>
      ))}
      {error ? <ErrorBox message={error} /> : null}
    </Screen>
  );
}
