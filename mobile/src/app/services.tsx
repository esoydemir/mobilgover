import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { Chevron, Pill, PrimaryButton, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { ServiceSuggestions } from '../features/ServiceExtras';
import { C, tint, type } from '../theme';

type Req = { id: string; title: string; category_name: string; status: string; open_quotes: number; job_status: string | null; created_at: string };

export const REQ_STATUS: Record<string, [string, string, string]> = {
  open: ['TEKLİF BEKLİYOR', C.info, tint.info(0.14)], awarded: ['İŞ VERİLDİ', C.warn, tint.warn(0.14)],
  completed: ['TAMAMLANDI', C.lime, tint.lime(0.14)], cancelled: ['İPTAL', C.t2, tint.white(0.08)],
};

export default function ServicesRoute() {
  const { company } = useSession();
  const q = useApi<Req[]>(company ? `/companies/${company.id}/service-requests` : null);
  return (
    <Screen title="Hizmet talepleri" titleEn="Service requests" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <PrimaryButton testID="service-new" label="Yeni hizmet talebi" onPress={() => router.push('/service/new')} />
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Ödeme bu aşamada uygulama dışında yapılır. Uzman sıralamasında ücretli öne çıkarma yoktur ve ticari tercih uygunsuzluğun önemini etkilemez.</Text>
      <ServiceSuggestions onOpen={code => router.push({ pathname: '/service/new', params: { category: code } })} />
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty title="Henüz talep yok" /> : null}
      {(q.data ?? []).map(r => (
        <Tap key={r.id} onPress={() => router.push(`/service/${r.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pill label={REQ_STATUS[r.status]![0]} fg={REQ_STATUS[r.status]![1]} bg={REQ_STATUS[r.status]![2]} />
            <Text style={type(11, 500, { color: C.t3 })}>{r.category_name}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{r.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: C.t3 })}>{fmtDateTime(r.created_at)} · {r.open_quotes} teklif{r.job_status ? ` · iş: ${r.job_status}` : ''}</Text>
        </Tap>
      ))}
    </Screen>
  );
}
