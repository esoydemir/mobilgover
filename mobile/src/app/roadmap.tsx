import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, Pill, PrimaryButton, StepMark } from '../components/ui';
import { ROADMAP, ROADMAP_SEGMENTS } from '../data';
import { goRoot } from '../state/app';
import { C, STATUS, tint, type } from '../theme';

const STATE_STYLE = { done: STATUS.ok, active: { ...STATUS.warn, bd: tint.warn(0.24) }, todo: STATUS.idle } as const;
const ITEM_MARK = { done: '✓', active: '●', todo: '○' } as const;

/** Official processes (e.g. opening a café): steps, where to apply, how long. */
export default function RoadmapRoute() {
  return (
    <Screen title="Resmî süreçler" titleEn="Official processes">
      <Card>
        <Text style={type(14.5, 600, { ls: -0.01 })}>Kafe açılışı · 7 resmî süreç</Text>
        <Text style={[type(12.5, 400, { lh: 1.5, color: C.t2 }), { marginTop: 6 }]}>3'ü tamam, 1'i sürüyor, 3'ü başlamadı. Doğrulanmadan hiçbir adımı "zorunlu" diye göstermiyoruz.</Text>
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 14 }}>
          {ROADMAP_SEGMENTS.map((st, i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: st === 'done' ? C.lime : st === 'active' ? C.warn : tint.white(0.09) }} />
          ))}
        </View>
      </Card>
      {ROADMAP.map(r => {
        const st = STATE_STYLE[r.state];
        return (
          <Card key={r.name} border={st.bd} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <StepMark state={r.state} />
              <Text style={[type(14.5, 600, { ls: -0.01 }), { flex: 1 }]}>{r.name}</Text>
              <Pill label={r.status} fg={st.fg} bg={st.bg} ls={0.07} />
            </View>
            <View style={{ gap: 7, marginTop: 13 }}>
              {r.items.map(i => (
                <View key={i.label} style={{ flexDirection: 'row', gap: 9, alignItems: 'baseline' }}>
                  <Text style={type(11, 400, { color: STATE_STYLE[i.state].fg })}>{ITEM_MARK[i.state]}</Text>
                  <Text style={[type(12.5, 400, { lh: 1.4, color: C.t2 }), { flex: 1 }]}>{i.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.bd }}>
              <Text style={type(11, 400, { color: C.t3 })}>{r.where}</Text>
              <Text style={[type(11, 400, { color: C.t3 }), { marginLeft: 'auto' }]}>{r.dur}</Text>
            </View>
          </Card>
        );
      })}
      <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: tint.lime(0.32), borderRadius: 22, backgroundColor: tint.lime(0.04), paddingVertical: 16, paddingHorizontal: 17 }}>
        <Text style={type(14, 600, { ls: -0.01 })}>Bu süreci benim için yürüt</Text>
        <Text style={[type(12, 400, { lh: 1.5, color: C.t2 }), { marginTop: 5 }]}>Uygun bir danışmanla eşleştirir, evrak takibini GoverHub üzerinden yürütürüz.</Text>
        <PrimaryButton label="Uygun danışmanları gör" onPress={() => goRoot('/experts')} height={42} size={12.5} glow={false} style={{ alignSelf: 'flex-start', marginTop: 13 }} />
      </View>
    </Screen>
  );
}
