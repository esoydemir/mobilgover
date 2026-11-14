import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading, StaleNote } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, Pill, SevPill, Tap, Chevron } from '../components/ui';
import { KIND_LABEL, PENALTY_NOTE, RISK_FILTERS, filterRisk, isRiskFilter, useRiskItems, type RiskFilter } from '../features/risk';
import { C, tint, type } from '../theme';

/**
 * Ceza ve Yasal Risk Merkezi. The cards on the home screen and the list here come from `useRiskItems`
 * (same sources, same site scope, same filters), so a number on a card equals the rows it opens.
 */
export default function RiskRoute() {
  const params = useLocalSearchParams<{ filter?: string; scope?: string }>();
  const { company, siteId, sites, role } = useSession();
  const [filter, setFilter] = useState<RiskFilter>(isRiskFilter(params.filter) ? params.filter : 'all');
  const [scope, setScope] = useState<'site' | 'all'>(params.scope === 'all' ? 'all' : 'site');
  const r = useRiskItems(scope);
  const siteName = sites.find(s => s.id === siteId)?.name;
  const rows = filterRisk(r.items, filter);

  if (!r.manager) {
    return (
      <Screen title="Ceza ve yasal risk" titleEn="Penalty & legal risk">
        <Empty title="Bu ekran yöneticiler içindir" body={role === 'staff' ? 'Personel yalnızca kendisine atanan işi görür; risk ve ceza bilgisi yöneticide kalır.' : 'Bu ekranı işletme sahibi, merkez ve şube yöneticisi görür.'} />
      </Screen>
    );
  }

  return (
    <Screen title="Ceza ve yasal risk" titleEn="Penalty & legal risk" gap={12} onRefresh={r.reload} refreshing={r.loading}>
      <Text testID="risk-context" style={type(12, 500, { color: C.t3 })}>
        {company?.name}{scope === 'site' && siteName ? ` · ${siteName}` : sites.length > 1 ? ' · tüm şubeler' : ''}
      </Text>
      {sites.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 7 }}>
          <FilterChip testID="risk-scope-site" label="Bu şube" active={scope === 'site'} onPress={() => setScope('site')} />
          <FilterChip testID="risk-scope-all" label="Tüm şubeler" active={scope === 'all'} onPress={() => setScope('all')} />
        </View>
      ) : null}

      <Card border={r.counts.crit ? tint.crit(0.3) : undefined} style={{ gap: 6 }}>
        <Eyebrow color={r.counts.crit ? C.crit : undefined}>AÇIK RİSK KALEMİ</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text testID="risk-total" style={type(40, 600, { family: 'outfit', ls: -0.04, color: r.counts.crit ? C.crit : C.t1 })}>{r.ready ? r.counts.all : '—'}</Text>
          <Text style={type(13, 500, { color: C.t2 })}>{r.counts.crit ? `${r.counts.crit} kritik` : 'kritik kalem yok'}</Text>
        </View>
        <Text testID="risk-penalty-note" style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>{PENALTY_NOTE}</Text>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {RISK_FILTERS.map(([k, label]) => (
          <FilterChip key={k} testID={`risk-filter-${k}`} label={`${label} ${r.ready ? r.counts[k] : ''}`.trim()} px={12} active={filter === k} onPress={() => setFilter(k)} />
        ))}
      </View>

      {r.stale ? <StaleNote /> : null}
      {r.error ? <ErrorBox message={r.error} onRetry={r.reload} /> : null}
      {!r.ready && r.loading ? <Loading /> : null}
      {r.ready && rows.length === 0 ? (
        <Empty title={filter === 'all' ? 'Açık risk kalemi yok' : 'Bu filtreye uyan kalem yok'}
          body="Açık uygunsuzluklar, geciken kontroller, süresi dolan belgeler ve bilgi bekleyen yükümlülükler burada toplanır." />
      ) : null}

      {rows.map(i => (
        <View key={i.key} testID={`risk-item-${i.key}`} style={{ borderWidth: 1, borderColor: i.sev === 'crit' ? tint.crit(0.28) : C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SevPill sev={i.sev} />
            <Pill label={KIND_LABEL[i.kind]} fg={C.t2} bg={C.chip} />
          </View>
          <Tap onPress={() => router.push(i.href)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14.5, 600, { ls: -0.01, lh: 1.3 }), { flex: 1 }]}>{i.title}</Text>
            <Chevron />
          </Tap>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.4 })}>{i.sub}</Text>
          <Text style={type(11, 500, { color: C.t2, lh: 1.4 })}>Dayanak: {i.basis} · Ceza tutarı: modellenmedi</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <GhostButton testID={`risk-open-${i.key}`} label="Aç" height={34} size={11.5} onPress={() => router.push(i.href)} />
            {i.service ? <GhostButton testID={`risk-service-${i.key}`} label="Servis bul" height={34} size={11.5} color={C.lime} border={tint.lime(0.35)} onPress={() => router.push(i.service!)} /> : null}
          </View>
        </View>
      ))}
      <Text style={type(11, 400, { color: C.t3, lh: 1.5 })}>Bu ekran puan, sıralama ya da hukuki görüş değildir; denetimde bulgu olabilecek açık kayıtları gösterir.</Text>
    </Screen>
  );
}
