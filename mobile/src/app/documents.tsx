import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { Chevron, Pill, PrimaryButton, Tap } from '../components/ui';
import { DOC_STATUS, DOC_TYPE, fmtDay, issuerLine, type IssuerCheck } from '../features/documents';
import { C, type } from '../theme';

type Doc = { id: string; docType: string; title: string; siteName: string | null; equipmentName: string | null; status: string; validUntil: string | null; versionCount: number;
  pendingReview: boolean; expiring: boolean; sharedReadOnly: boolean; issuerCheck: IssuerCheck };

/** Document vault: licences, certificates, reports. An upload is valid only after someone else reviewed it. */
export default function DocumentsRoute() {
  const { company } = useSession();
  const q = useApi<Doc[]>(company ? `/companies/${company.id}/documents` : null);
  const order = ['expired', 'unreviewed', 'rejected', 'file_pending', 'no_file', 'internally_reviewed', 'issuer_verified'];
  const docs = [...(q.data ?? [])].sort((a, b) => (order.indexOf(a.status) - (a.expiring ? 0.5 : 0)) - (order.indexOf(b.status) - (b.expiring ? 0.5 : 0)));
  return (
    <Screen title="Belge kasası" titleEn="Document vault" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <PrimaryButton testID="doc-new" label="Belge ekle" onPress={() => router.push('/documents/new')} />
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Durumlar ayrı tutulur: incelenmedi, kurum içi incelendi, düzenleyen kurumdan doğrulandı, reddedildi, süresi doldu. Yükleme ya da kurum içi inceleme resmî geçerlilik doğrulaması değildir; GoverHub kurumu kendisi sorgulamaz.</Text>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty title="Henüz belge yok" /> : null}
      {docs.map(d => {
        const st = DOC_STATUS[d.status] ?? DOC_STATUS.no_file!;
        return (
          <Tap key={d.id} testID={`doc-${d.id}`} onPress={() => router.push(`/documents/${d.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill label={st[0]} fg={st[1]} bg={st[2]} />
              {d.expiring ? <Pill label="SÜRESİ YAKLAŞIYOR" fg={C.warn} bg={C.chip} /> : null}
              {d.pendingReview && d.status !== 'unreviewed' ? <Pill label="YENİ SÜRÜM İNCELEMEDE" fg={C.warn} bg={C.chip} /> : null}
              {d.sharedReadOnly ? <Pill label="PAYLAŞILDI · YALNIZ OKUMA" fg={C.t2} bg={C.chip} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={[type(14, 600), { flex: 1 }]}>{d.title}</Text>
              <Chevron />
            </View>
            <Text style={type(11.5, 400, { color: C.t3 })}>
              {DOC_TYPE[d.docType] ?? d.docType} · {d.equipmentName ?? d.siteName ?? 'İşletme geneli'}
              {d.status === 'internally_reviewed' || d.status === 'issuer_verified' || d.status === 'expired' ? ` · geçerlilik sonu ${fmtDay(d.validUntil)}` : ''}
            </Text>
            {d.issuerCheck ? <Text testID={`doc-issuer-line-${d.id}`} style={type(11, 400, { color: C.t3, lh: 1.4 })}>{issuerLine(d.issuerCheck)}</Text> : null}
          </Tap>
        );
      })}
    </Screen>
  );
}
