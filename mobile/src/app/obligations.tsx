import { router } from 'expo-router';
import { factLabels } from '../features/factLabels';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import type { Obligation } from '../api/types';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, ExampleBadge, Loading, StaleNote } from '../components/states';
import { Chevron, Pill, Tap } from '../components/ui';
import { C, tint, type } from '../theme';

export const DECISION: Record<Obligation['decision'], [string, string, string]> = {
  applies: ['UYGULANIR', C.lime, tint.lime(0.14)],
  not_applicable: ['UYGULANMAZ', C.t2, tint.white(0.08)],
  needs_info: ['BİLGİ EKSİK', C.warn, tint.warn(0.14)],
  needs_review: ['UZMAN İNCELEMESİ', C.info, tint.info(0.14)],
};

export default function ObligationsRoute() {
  const { company, role, siteId, sites } = useSession();
  // A site manager may read only their own site's obligations; asking for all sites is refused (403).
  const q = useApi<Obligation[]>(company ? `/companies/${company.id}/obligations${role === 'site_manager' && siteId ? `?siteId=${siteId}` : ''}` : null);
  // With more than one branch the same rule appears once per branch: each group says which one it is about.
  const rows = q.data ?? [];
  const nameOf = (id: string) => sites.find(s => s.id === id)?.name ?? 'Diğer şube';
  const order = [...new Set([...sites.map(s => s.id), ...rows.map(o => o.siteId)])].filter(id => rows.some(o => o.siteId === id));
  const grouped = order.length > 1;
  return (
    <Screen title="Yükümlülükler" titleEn="Obligations" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      {q.stale ? <StaleNote /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <Loading /> : null}
      {order.map(sid => (
        <View key={sid} testID={`obl-site-${sid}`} style={{ gap: 11 }}>
          {grouped ? <Text testID={`obl-site-name-${sid}`} style={[type(10.5, 600, { ls: 0.12, color: C.t3 }), { marginTop: 8 }]}>{nameOf(sid).toLocaleUpperCase('tr')} · {rows.filter(o => o.siteId === sid && o.decision === 'applies').length} uygulanıyor</Text> : null}
          {rows.filter(o => o.siteId === sid).map(o => (
        <Tap key={o.id} testID={`obl-${o.rule}`} onPress={() => router.push(`/obligation/${o.id}`)} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 16, backgroundColor: C.card, padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pill label={DECISION[o.decision][0]} fg={DECISION[o.decision][1]} bg={DECISION[o.decision][2]} />
            {o.isExample ? <ExampleBadge /> : null}
            {o.kind === 'good_practice' ? <ExampleBadge label="İYİ UYGULAMA" /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[type(14, 600, { ls: -0.01 }), { flex: 1 }]}>{o.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{o.missingFacts.length ? `Eksik bilgi: ${factLabels(o.missingFacts)} · ` : ''}kural sürümü {o.version} · kayıt kodu {o.rule}</Text>
        </Tap>
          ))}
        </View>
      ))}
    </Screen>
  );
}
