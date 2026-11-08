import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { Chevron, Pill, Tap } from '../components/ui';
import { C, tint, type } from '../theme';

type Item = { kind: 'action' | 'closure'; ncrId: string; title: string; riskLevel: string; actionId?: string; description?: string; legacy?: boolean;
  canVerify: boolean; selfOnly: boolean; blockedReason: string | null };
const RISK: Record<string, string> = { low: 'DÜŞÜK', medium: 'ORTA', high: 'YÜKSEK', critical: 'KRİTİK' };

/** What is waiting for this person's verification (managers and invited outside verifiers). */
export default function VerifyQueueRoute() {
  const { company } = useSession();
  const q = useApi<Item[]>(company ? `/companies/${company.id}/verification-queue` : null);
  return (
    <Screen title="Doğrulama bekleyenler" titleEn="Waiting for verification" gap={10} onRefresh={q.reload} refreshing={q.loading}>
      <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>"Yapıldı" beyanları ve etkinlik kontrolü yapılmış kayıtlar. Payın olan işleri bağımsız olarak doğrulayamazsın; düşük riskte etiketli öz doğrulama yapılabilir.</Text>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty title="Bekleyen doğrulama yok" /> : null}
      {(q.data ?? []).map(i => (
        <Tap key={`${i.kind}-${i.actionId ?? i.ncrId}`} testID={`queue-${i.kind}-${i.actionId ?? i.ncrId}`} onPress={() => router.push(`/ncr/${i.ncrId}`)}
          style={{ borderWidth: 1, borderColor: i.canVerify ? tint.lime(0.3) : C.bd, borderRadius: 20, backgroundColor: C.card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill label={i.kind === 'action' ? (i.legacy ? 'ESKİ AKSİYON' : 'AKSİYON BEYANI') : 'KAPANIŞ'} fg={C.info} bg={tint.info(0.12)} />
            <Pill label={`RİSK ${RISK[i.riskLevel] ?? i.riskLevel}`} fg={i.riskLevel === 'high' || i.riskLevel === 'critical' ? C.crit : C.t2} bg={C.chip} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(13.5, 600), { flex: 1 }]}>{i.description ?? i.title}</Text>
            <Chevron />
          </View>
          {i.description ? <Text style={type(11.5, 400, { color: C.t3 })}>{i.title}</Text> : null}
          <Text style={type(11.5, 500, { color: i.canVerify ? C.lime : i.selfOnly ? C.warn : C.t3 })}>{i.canVerify ? 'Doğrulayabilirsin' : i.blockedReason}</Text>
        </Tap>
      ))}
    </Screen>
  );
}
