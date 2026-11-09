import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { ErrorBox, Loading } from '../components/states';
import { Bar, Card, Eyebrow, FilterChip } from '../components/ui';
import { C, tint, type } from '../theme';

type View_ = {
  label: string; note: string; filters: { regions: string[]; types: string[] };
  groups: ({ region: string; type: string; hidden: true; note: string } | { region: string; type: string; hidden: false; businesses: number; cases: number; repeatRate: number | null; causes: Record<string, number> })[];
  byRegion: ({ region: string; hidden: true; note: string } | { region: string; hidden: false; cases: number; causes: { cause: string; label: string; share: number | null }[]; interpretation: string })[];
  support: { support: string; label: string; cases: number; repeatRate: number | null; note: string | null }[];
  fitByCause: { cause: string; label: string; fitSupport: string; withFit: number | null; withoutSupport: number | null; n: { fit: number; none: number } }[];
};
const CAUSE_COLOR: Record<string, string> = { equipment: C.warn, knowledge: C.info, resource: C.t2, process: C.lime };

/** SYNTHETIC institution view: patterns by region and business type, never identities. */
export default function InstitutionRoute() {
  const [region, setRegion] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (region) qs.set('region', region);
  if (kind) qs.set('type', kind);
  const q = useApi<View_>(`/institution/demo?${qs.toString()}`);
  const v = q.data;
  return (
    <Screen title="Kurum görünümü" titleEn="Institution (synthetic)" gap={11} onRefresh={q.reload} refreshing={q.loading}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !v ? <Loading /> : (
        <>
          <View style={{ borderWidth: 1, borderColor: tint.warn(0.4), backgroundColor: tint.warn(0.08), borderRadius: 16, padding: 12, gap: 4 }}>
            <Text testID="inst-label" style={type(11, 800, { ls: 0.08, color: C.warn })}>{v.label}</Text>
            <Text style={type(12, 400, { color: C.t2, lh: 1.45 })}>{v.note}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <FilterChip label="Tüm bölgeler" px={11} active={!region} onPress={() => setRegion(null)} />
            {v.filters.regions.map(r => <FilterChip key={r} testID={`inst-region-${r}`} label={r} px={11} active={region === r} onPress={() => setRegion(r)} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <FilterChip label="Tüm türler" px={11} active={!kind} onPress={() => setKind(null)} />
            {v.filters.types.map(t => <FilterChip key={t} label={t} px={11} active={kind === t} onPress={() => setKind(t)} />)}
          </View>
          <Eyebrow>BÖLGEYE GÖRE DOĞRULANMIŞ NEDEN DAĞILIMI</Eyebrow>
          {v.byRegion.map(r => (
            <Card key={r.region} style={{ gap: 6 }}>
              <Text style={type(13.5, 600)}>{r.region}</Text>
              {r.hidden ? <Text testID={`inst-hidden-${r.region}`} style={type(12, 500, { color: C.t3 })}>{r.note}</Text> : (
                <>
                  {r.causes.map(c => (
                    <View key={c.cause} style={{ gap: 3 }}>
                      <Text style={type(11.5, 400, { color: C.t2 })}>{c.label} · %{c.share}</Text>
                      <Bar pct={(c.share ?? 0) / 100} height={5} color={CAUSE_COLOR[c.cause]} />
                    </View>
                  ))}
                  <Text testID={`inst-interp-${r.region}`} style={type(12, 600, { color: C.t1, lh: 1.45 })}>{r.interpretation} ({r.cases} vaka)</Text>
                </>
              )}
            </Card>
          ))}
          <Eyebrow>DESTEKTEN SONRA TEKRAR ORANI</Eyebrow>
          <Card style={{ gap: 6 }}>
            {v.fitByCause.map(f => (
              <Text key={f.cause} style={type(12, 400, { color: C.t2, lh: 1.45 })}>
                {f.label}: uygun destek ({f.fitSupport}) sonrası {f.withFit == null ? 'veri az' : `%${f.withFit}`} · destek yokken {f.withoutSupport == null ? 'veri az' : `%${f.withoutSupport}`} ({f.n.fit}/{f.n.none} vaka)
              </Text>
            ))}
            {v.support.map(s => <Text key={s.support} style={type(11.5, 400, { color: C.t3 })}>{s.label}: {s.repeatRate == null ? s.note : `tekrar %${s.repeatRate} (${s.cases} vaka)`}</Text>)}
          </Card>
          <Eyebrow>BÖLGE × İŞLETME TÜRÜ</Eyebrow>
          <Card style={{ gap: 4 }}>
            {v.groups.map(g => (
              <Text key={`${g.region}-${g.type}`} style={type(11.5, 400, { color: g.hidden ? C.t3 : C.t2 })}>
                {g.region} · {g.type}: {g.hidden ? 'gizlendi (küçük grup)' : `${g.businesses} işletme, ${g.cases} vaka, tekrar %${g.repeatRate}`}
              </Text>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
