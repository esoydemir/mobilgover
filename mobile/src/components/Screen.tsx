import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PERSONA_HEADER } from '../data';
import { goBack, useApp } from '../state/app';
import { C, tint, type } from '../theme';
import { GradientFill } from './Gradient';
import { BackIcon, BellIcon, SearchIcon } from './Icons';
import { Pulse, Tap } from './ui';

/** Bottom padding that keeps content clear of the floating tab bar. */
export const TAB_CLEARANCE = 142;

type Props = {
  children: ReactNode;
  /** Sub-screen title (Turkish) and its English sublabel. Omit for the brand header. */
  title?: string;
  titleEn?: string;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({ children, title, titleEn, gap = 12, contentStyle }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        {title === undefined ? <BrandHeader /> : <SubHeader title={title} titleEn={titleEn} />}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingHorizontal: 22, paddingBottom: TAB_CLEARANCE + insets.bottom, gap }, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function BrandHeader() {
  const { persona, openSheet } = useApp();
  const h = PERSONA_HEADER[persona];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 4, paddingHorizontal: 22, paddingBottom: 14 }}>
      <View style={{ width: 44, height: 44, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 22px rgba(198,255,61,0.28)' }}>
        <GradientFill angle={150} stops={[[0, C.lime], [1, '#9BD718']]} />
        <Text style={type(20, 800, { family: 'outfit', color: C.ink })}>G</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={type(11, 500, { color: C.t2 })}>{h.greeting}</Text>
          {/* The app is not connected to the API yet; say so instead of implying real records. */}
          <View accessibilityLabel="Demo: örnek veri, sunucuya bağlı değil" style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: tint.warn(0.4) }}>
            <Text style={type(8.5, 700, { ls: 0.08, color: C.warn })}>DEMO · ÖRNEK VERİ</Text>
          </View>
        </View>
        <Text style={[type(16, 700, { ls: -0.015 }), { marginTop: 2 }]}>{h.org}</Text>
      </View>
      <RoundIcon label="Ara" onPress={() => openSheet('search')}><SearchIcon /></RoundIcon>
      <RoundIcon label="Bildirimler" onPress={() => router.push('/notifications')}>
        <BellIcon />
        <View style={{ position: 'absolute', top: 4, right: 5 }}>
          <Pulse><View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: C.lime, borderWidth: 1.5, borderColor: C.bg }} /></Pulse>
        </View>
      </RoundIcon>
    </View>
  );
}

function RoundIcon({ children, onPress, label }: { children: ReactNode; onPress: () => void; label: string }) {
  return (
    <Tap accessibilityLabel={label} onPress={onPress} style={{ width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: tint.white(0.09), backgroundColor: '#141414', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </Tap>
  );
}

function SubHeader({ title, titleEn }: { title: string; titleEn?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 22, paddingBottom: 14 }}>
      <Tap accessibilityLabel="Geri" onPress={goBack} style={{ width: 36, height: 36, borderRadius: 999, borderWidth: 1, borderColor: C.bd, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' }}>
        <BackIcon />
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(16, 700, { ls: -0.015 })}>{title}</Text>
        {titleEn ? <Text style={[type(10.5, 400, { color: C.t3 }), { marginTop: 1 }]}>{titleEn}</Text> : null}
      </View>
    </View>
  );
}
