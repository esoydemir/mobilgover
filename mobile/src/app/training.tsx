import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Bar, Callout, Card, Pill, Tap } from '../components/ui';
import { COURSES } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

const KIND = {
  lime: { fg: C.lime, bg: tint.lime(0.14), bd: C.bd },
  info: { fg: C.info, bg: tint.info(0.14), bd: tint.info(0.24) },
  idle: { fg: C.t2, bg: tint.white(0.08), bd: C.bd },
} as const;

/** Courses, each labelled as GoverHub participation vs. official certificate. */
export default function TrainingRoute() {
  const { showToast } = useApp();
  return (
    <Screen title="Eğitim" titleEn="Training">
      <Callout tone="info" title="İki belge türü aynı şey değil" body="GoverHub katılım belgesi eğitimin tamamlandığını gösterir. Resmî sertifika yalnızca yetkili kurumdan alınır — hangisi olduğunu her kartta yazıyoruz." />
      {COURSES.map(c => {
        const k = KIND[c.tone];
        return (
          <Card key={c.name} border={k.bd} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill label={c.kind} fg={k.fg} bg={k.bg} />
              <Text style={type(11, 400, { color: C.t3 })}>{c.dur}</Text>
            </View>
            <Text style={[type(15, 600, { ls: -0.015 }), { marginTop: 11 }]}>{c.name}</Text>
            <Text style={[type(12.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 5 }]}>{c.cert}</Text>
            <Bar pct={c.pct} track={C.track} style={{ marginTop: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <Text style={[type(11.5, 400, { color: C.t3 }), { flex: 1 }]}>{c.progress}</Text>
              <Tap onPress={() => showToast(c.toast[0], c.toast[1])} style={{ height: 38, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: c.primary ? C.lime : C.tile }}>
                <Text style={type(12.5, 700, { color: c.primary ? C.ink : C.t1 })}>{c.cta}</Text>
              </Tap>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
