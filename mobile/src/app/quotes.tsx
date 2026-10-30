import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, Tap, Tile } from '../components/ui';
import { QUOTES } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

const ROW_COLOR = { warn: C.warn, crit: C.crit, muted: C.t2 } as const;

/** Like-for-like quote comparison; excluded work is called out on its own line. */
export default function QuotesRoute() {
  const { showToast } = useApp();
  return (
    <Screen title="Teklifler" titleEn="Quotes">
      <Text style={[type(12.5, 400, { lh: 1.5, color: C.t2 }), { paddingHorizontal: 2 }]}>Aynı kapsam, aynı alanlar. Dahil olmayan işler ayrı satırda — sürpriz maliyet çıkmasın.</Text>
      {QUOTES.map(q => (
        <Card key={q.name} border={q.featured ? tint.lime(0.28) : C.bd} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Tile size={34} radius={11} fontSize={13} initials>{q.initials}</Tile>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(14, 600, { ls: -0.01 })}>{q.name}</Text>
              <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 2 }]}>{q.meta}</Text>
            </View>
            <Text style={type(19, 600, { family: 'outfit', ls: -0.03 })}>{q.price}</Text>
          </View>
          <View style={{ gap: 8, marginTop: 14 }}>
            {q.rows.map(r => (
              <View key={r.k} style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={[type(12, 400, { color: C.t3 }), { width: 96 }]}>{r.k}</Text>
                <Text style={[type(12, 400, { lh: 1.4, color: r.tone ? ROW_COLOR[r.tone] : C.t1 }), { flex: 1 }]}>{r.v}</Text>
              </View>
            ))}
          </View>
          <Tap
            onPress={() => { router.push('/visit'); showToast(q.toast[0], q.toast[1], q.toast[2]); }}
            style={{ height: 44, marginTop: 15, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: q.featured ? C.lime : C.tile }}
          >
            <Text style={type(13, 700, { color: q.featured ? C.ink : C.t1 })}>{q.cta}</Text>
          </Tap>
        </Card>
      ))}
      <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { paddingHorizontal: 2 }]}>Teklif geçerlilik süresi dolduğunda otomatik kapanır. Kabul ettiğinde ödeme ve QR girişli servis kaydı başlar.</Text>
    </Screen>
  );
}
