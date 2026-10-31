import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { Chevron, FilterChip, Pill, Tap } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { C, tint, type } from '../theme';

type Ncr = { id: string; title: string; risk_level: string; depth: string; status: string; recurrence_count: number; detected_at: string };

export const RISK: Record<string, [string, string, string]> = {
  low: ['DÜŞÜK', C.info, tint.info(0.14)], medium: ['ORTA', C.warn, tint.warn(0.14)],
  high: ['YÜKSEK', C.crit, tint.crit(0.14)], critical: ['KRİTİK', C.crit, tint.crit(0.2)],
};

export default function NcrsRoute() {
  const { company } = useSession();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const q = useApi<Ncr[]>(company ? `/companies/${company.id}/nonconformities?status=${status}` : null);
  return (
    <Screen title="Uygunsuzluklar" titleEn="Nonconformities" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <FilterChip label="Açık" active={status === 'open'} onPress={() => setStatus('open')} />
        <FilterChip label="Kapalı" active={status === 'closed'} onPress={() => setStatus('closed')} />
      </View>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {q.data?.length === 0 ? <Empty title={status === 'open' ? 'Açık uygunsuzluk yok' : 'Kapalı kayıt yok'} /> : null}
      {(q.data ?? []).map(n => (
        <Tap key={n.id} onPress={() => router.push(`/ncr/${n.id}`)} style={{ borderWidth: 1, borderColor: n.risk_level === 'high' || n.risk_level === 'critical' ? tint.crit(0.25) : C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pill label={RISK[n.risk_level]![0]} fg={RISK[n.risk_level]![1]} bg={RISK[n.risk_level]![2]} />
            <Text style={type(11, 500, { color: C.t3 })}>{n.depth === 'capa' ? 'Tam CAPA' : 'Düzeltme'}{n.recurrence_count ? ` · ${n.recurrence_count + 1}. tekrar` : ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{n.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: C.t3 })}>Tespit {fmtDateTime(n.detected_at)}</Text>
        </Tap>
      ))}
    </Screen>
  );
}
