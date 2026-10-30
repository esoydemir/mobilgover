import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ScanIcon } from '../components/Icons';
import { Screen } from '../components/Screen';
import { FilterChip, Pill, Tap, Tile, s } from '../components/ui';
import { DOCS, DOC_FILTERS, type DocFilter } from '../data';
import { C, STATUS, limeGlow, type } from '../theme';

export default function DocsRoute() {
  const [filter, setFilter] = useState<DocFilter>('all');
  return (
    <Screen title="Dijital kasa" titleEn="Document vault" gap={11}>
      <Tap onPress={() => router.push('/scan')} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 22, backgroundColor: C.lime, paddingVertical: 17, paddingHorizontal: 18, boxShadow: limeGlow }}>
        <ScanIcon size={21} color={C.ink} stroke={2} />
        <View style={{ flex: 1 }}>
          <Text style={type(15, 700, { ls: -0.01, color: C.ink })}>Belge tara</Text>
          <Text style={[type(11.5, 400, { color: 'rgba(10,21,0,0.6)' }), { marginTop: 2 }]}>Tarih, numara ve kurumu kendisi okur</Text>
        </View>
      </Tap>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 }}>
        {DOC_FILTERS.map(([k, label]) => <FilterChip key={k} label={label} px={14} active={filter === k} onPress={() => setFilter(k)} />)}
      </View>
      {DOCS.filter(d => filter === 'all' || d.cat === filter).map(d => {
        const st = STATUS[d.st];
        return (
          <View key={d.id} style={[s.row, { gap: 13, borderColor: st.bd, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16 }]}>
            <Tile>{d.icon}</Tile>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(14, 600, { ls: -0.01 })}>{d.title}</Text>
              <Text style={[type(11.5, 400, { color: d.st === 'ok' ? C.t3 : st.fg }), { marginTop: 3 }]}>{d.meta}</Text>
            </View>
            <Pill label={d.status} fg={st.fg} bg={st.bg} ls={0.07} />
          </View>
        );
      })}
    </Screen>
  );
}
