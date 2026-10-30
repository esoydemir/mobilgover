import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { ScoreRings } from '../components/ScoreRings';
import { Screen } from '../components/Screen';
import { Chevron, Tap, s } from '../components/ui';
import { SCORE_DOMAINS } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, STATUS, tint, type } from '../theme';

const DOMAIN_ROUTES: Record<(typeof SCORE_DOMAINS)[number]['key'], Href> = {
  docs: '/docs', personnel: '/personnel', form: '/form', roadmap: '/roadmap', equipment: '/equipment',
};

export default function ScoreRoute() {
  const { openSheet } = useApp();
  const [width, setWidth] = useState(346);
  return (
    <Screen title="Uyum skoru" titleEn="Compliance score">
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: C.warn }} />
            <Text style={type(10.5, 700, { ls: 0.13, color: C.warn })}>İZLEME GEREKTİRİYOR</Text>
          </View>
          <Text style={[type(26, 600, { family: 'outfit', ls: -0.035, lh: 1.12 }), { marginTop: 7 }]}>Beş süreç,{'\n'}tek skor</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={type(46, 600, { family: 'outfit', ls: -0.045 })}>58</Text>
            <Text style={type(17, 600, { color: C.t3 })}>/100</Text>
          </View>
          <Text style={[type(11.5, 600, { color: C.lime }), { marginTop: 6 }]}>▲ +4 bu hafta</Text>
        </View>
      </View>

      <ScoreRings width={width} />

      <Tap onPress={() => openSheet('calc')} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 2, paddingBottom: 6 }}>
        <View style={{ width: 15, height: 15, borderRadius: 999, borderWidth: 1, borderColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(9, 700, { color: C.lime })}>i</Text>
        </View>
        <Text style={type(12.5, 600, { color: C.lime })}>Nasıl hesaplanır?</Text>
      </Tap>

      <View style={{ gap: 8, marginTop: 2 }}>
        {SCORE_DOMAINS.map(d => {
          const color = STATUS[d.tone].fg;
          const href = DOMAIN_ROUTES[d.key];
          return (
            <Tap
              key={d.key}
              onPress={() => (d.key === 'docs' ? goRoot(href) : router.push(href))}
              style={[s.row, { gap: 12, height: 52, paddingHorizontal: 16, borderRadius: 18 }]}
            >
              <View style={{ width: 4, height: 22, borderRadius: 999, backgroundColor: color }} />
              <Text style={[type(14, 600, { ls: -0.01 }), { flex: 1 }]}>{d.label}</Text>
              <Text style={type(12, 600, { family: 'mono', color })}>{d.value}</Text>
              <Text style={[type(11, 600, { color: C.t3 }), { minWidth: 26, textAlign: 'right' }]}>{d.unit}</Text>
              <Chevron />
            </Tap>
          );
        })}
      </View>

      <Text style={type(14, 400, { lh: 1.55 })}>
        Skor bu hafta 4 puan arttı — hijyen eğitimi tamamlandı. En dış halka belgeler, en iç halka ekipman bakımı. Yay ne kadar kısaysa o süreçte iş o kadar birikmiş. Şu an en zayıf halka{' '}
        <Text style={type(14, 600, { color: C.crit })}>ekipman bakımı</Text>: 14 kalemde 6'sı tamam.
      </Text>

      <Tap onPress={() => router.push('/equipment')} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: tint.crit(0.28), borderRadius: 26, overflow: 'hidden', paddingVertical: 16, paddingHorizontal: 17, marginTop: 2 }}>
        <GradientFill angle={160} stops={[[0, '#1a0b0b'], [0.6, C.card]]} />
        <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: tint.crit(0.14), alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(16, 800, { color: C.crit })}>!</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type(14.5, 600, { ls: -0.01 })}>Ekipman halkasını kapat</Text>
          <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 3 }]}>2 gecikmiş kontrol · tahmini +11 puan</Text>
        </View>
        <Chevron />
      </Tap>
    </Screen>
  );
}
