import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Chevron, Pill, Tap, Tile, s } from '../components/ui';
import { MORE_ITEMS } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

export default function MoreRoute() {
  const { showToast } = useApp();
  return (
    <Screen title="Yönetim" titleEn="Management" gap={11}>
      {MORE_ITEMS.map(m => (
        <Tap
          key={m.label}
          onPress={() => ('href' in m ? router.push(m.href) : showToast('Denetim dosyası', 'PDF hazırlanıyor · 22 belge, 84 kanıt'))}
          style={[s.row, { gap: 13, borderRadius: 22, paddingVertical: 15, paddingHorizontal: 16 }]}
        >
          <Tile size={36} fontSize={16}>{m.icon}</Tile>
          <View style={{ flex: 1 }}>
            <Text style={type(14, 600, { ls: -0.01 })}>{m.label}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{m.sub}</Text>
          </View>
          {'badge' in m && <Pill label={m.badge} fg={C.crit} bg={tint.crit(0.14)} size={10} ls={0} />}
          <Chevron />
        </Tap>
      ))}
    </Screen>
  );
}
