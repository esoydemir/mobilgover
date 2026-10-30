import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Chevron, s } from '../components/ui';
import { QR_ACTIONS, QR_CELLS } from '../data';
import { C, type } from '../theme';

/** Equipment QR: staff scan opens today's checks, an expert scan logs a visit. */
export default function QrRoute() {
  return (
    <Screen title="GoverHub QR" titleEn="QR" gap={0} contentStyle={{ alignItems: 'center', paddingTop: 14 }}>
      <View style={{ width: 236, height: 236, borderRadius: 26, backgroundColor: C.t1, padding: 18, flexDirection: 'row', flexWrap: 'wrap', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        {QR_CELLS.map((on, i) => <View key={i} style={{ width: '10%', height: '10%', backgroundColor: on ? '#0A0A0A' : 'transparent' }} />)}
      </View>
      <Text style={[type(11, 400, { family: 'mono', color: C.t3 }), { marginTop: 20 }]}>GH-EQ-4471-KDK</Text>
      <Text style={[type(17, 600, { ls: -0.015 }), { marginTop: 12 }]}>Buzdolabı · Mutfak arka</Text>
      <Text style={[type(13, 400, { lh: 1.5, color: C.t2 }), { textAlign: 'center', marginTop: 8, maxWidth: 270 }]}>
        Personel okuttuğunda günün kontrolleri açılır. Uzman okuttuğunda ziyaret giriş kaydı oluşur.
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 9, marginTop: 26 }}>
        {QR_ACTIONS.map(a => (
          <View key={a.label} style={[s.row, { gap: 11, borderRadius: 20, paddingVertical: 13, paddingHorizontal: 15 }]}>
            <Text style={{ fontSize: 15 }}>{a.icon}</Text>
            <Text style={[type(13.5, 500), { flex: 1 }]}>{a.label}</Text>
            <Chevron size={14} />
          </View>
        ))}
      </View>
    </Screen>
  );
}
