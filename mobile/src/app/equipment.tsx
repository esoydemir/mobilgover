import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, GhostButton, Pill, Tile } from '../components/ui';
import { EQUIPMENT } from '../data';
import { useApp } from '../state/app';
import { C, STATUS, tint, type } from '../theme';

export default function EquipmentRoute() {
  const { openSheet } = useApp();
  return (
    <Screen title="Ekipman" titleEn="Equipment" gap={11}>
      {EQUIPMENT.map(e => {
        const st = STATUS[e.st];
        return (
          <Card key={e.serial} border={st.bd} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Tile size={40} radius={13}>{e.icon}</Tile>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type(14.5, 600, { ls: -0.01 })}>{e.name}</Text>
                <Text style={[type(10.5, 400, { family: 'mono', color: C.t3 }), { marginTop: 3 }]}>{e.serial}</Text>
              </View>
              <Pill label={e.status} fg={st.fg} bg={st.bg} ls={0.07} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <GhostButton label="QR göster" onPress={() => router.push('/qr')} height={40} size={12.5} style={{ flex: 1 }} />
              <GhostButton label="Arıza bildir" onPress={() => openSheet('fault')} height={40} size={12.5} color={C.crit} border={tint.crit(0.3)} bg={tint.crit(0.08)} style={{ flex: 1 }} />
            </View>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 11 }]}>{e.next}</Text>
          </Card>
        );
      })}
    </Screen>
  );
}
