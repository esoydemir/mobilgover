import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Callout, Pill, Tap, Tile, s } from '../components/ui';
import { STAFF } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

const CHIP = { warn: [C.warn, tint.warn(0.14)], ok: [C.lime, tint.lime(0.14)], info: [C.info, tint.info(0.14)] } as const;

export default function PersonnelRoute() {
  const { openSheet, trained } = useApp();
  return (
    <Screen title="Personel" titleEn="Personnel" gap={11}>
      {trained ? (
        <Callout tone="lime" title="Hijyen eğitimi atandı" body="Elif K. ve Burak T. · takip başladı. Tamamlandığında belge kasaya eklenir." />
      ) : (
        <Callout tone="warn" title="2 personelin hijyen eğitimi eksik" body="Eğitim kanunu bilmene gerek yok — tek dokunuşla ata.">
          <Tap onPress={() => openSheet('training')} style={{ alignSelf: 'flex-start', height: 40, paddingHorizontal: 16, marginTop: 12, borderRadius: 999, backgroundColor: C.warn, justifyContent: 'center' }}>
            <Text style={type(12.5, 700, { color: '#1A1400' })}>İkisine de ata</Text>
          </Tap>
        </Callout>
      )}
      {STAFF.map(p => (
        <View key={p.initials} style={[s.row, { gap: 12, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16 }]}>
          <Tile size={40} radius={13} fontSize={14} initials>{p.initials}</Tile>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type(14, 600, { ls: -0.01 })}>{p.name}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{p.role}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {p.chips.map(c => (
                <Pill key={c.label} label={c.label} fg={CHIP[c.tone][0]} bg={CHIP[c.tone][1]} size={10} ls={0} style={{ paddingVertical: 3, paddingHorizontal: 7 }} />
              ))}
            </View>
          </View>
          <Text style={type(11, 400, { family: 'mono', color: C.t3 })}>{p.tasks}</Text>
        </View>
      ))}
    </Screen>
  );
}
