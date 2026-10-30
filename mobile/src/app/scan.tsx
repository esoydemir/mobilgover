import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { Screen } from '../components/Screen';
import { nativeDriver } from '../components/ui';
import { SCAN_STATUS, SCAN_STEPS } from '../data';
import { C, type } from '../theme';

const LINES = [0.92, 0.78, 0.86, 0.64, 0.88, 0.52, 0.72];
const CORNERS = [
  { left: 14, top: 14, borderRightWidth: 0, borderBottomWidth: 0 },
  { right: 14, top: 14, borderLeftWidth: 0, borderBottomWidth: 0 },
  { left: 14, bottom: 14, borderRightWidth: 0, borderTopWidth: 0 },
  { right: 14, bottom: 14, borderLeftWidth: 0, borderTopWidth: 0 },
];

/** Simulated OCR pipeline: four stages, then the extracted fields screen. */
export default function ScanRoute() {
  const [stage, setStage] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: nativeDriver }),
      Animated.timing(sweep, { toValue: 0, duration: 1600, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    const t1 = setTimeout(() => setStage(1), 900);
    const t2 = setTimeout(() => setStage(2), 1800);
    const t3 = setTimeout(() => router.replace('/scan-confirm'), 2700);
    return () => { loop.stop(); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [sweep]);

  return (
    <Screen title="Belge tara" titleEn="Document scan" gap={0}>
      <View style={{ height: 300, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.bd, backgroundColor: '#0B0B0B' }}>
        <View style={{ position: 'absolute', top: 26, left: 26, right: 26, bottom: 26, borderRadius: 8, backgroundColor: '#141414', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingVertical: 22, paddingHorizontal: 20, gap: 9 }}>
          <View style={{ height: 9, width: '58%', borderRadius: 3, backgroundColor: 'rgba(245,245,242,0.18)' }} />
          <View style={{ height: 6, width: '36%', borderRadius: 3, backgroundColor: 'rgba(245,245,242,0.1)' }} />
          <View style={{ height: 1, backgroundColor: C.bd, marginVertical: 6 }} />
          {LINES.map((w, i) => <View key={i} style={{ height: 5, width: `${w * 100}%`, borderRadius: 3, backgroundColor: 'rgba(245,245,242,0.08)' }} />)}
        </View>
        <Animated.View style={{
          position: 'absolute', left: 26, right: 26, top: 26, height: 2, boxShadow: '0 0 24px 6px rgba(198,255,61,0.35)',
          transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, 232] }) }],
        }}>
          <GradientFill angle={90} stops={[[0, 'rgba(198,255,61,0)'], [0.5, C.lime], [1, 'rgba(198,255,61,0)']]} />
        </Animated.View>
        {CORNERS.map((c, i) => <View key={i} style={[{ position: 'absolute', width: 22, height: 22, borderWidth: 2, borderColor: C.lime, borderRadius: 3 }, c]} />)}
      </View>
      <View style={{ alignItems: 'center', marginTop: 22 }}>
        <Text style={type(16, 600, { ls: -0.01 })}>{SCAN_STATUS[stage]}</Text>
        <Text style={[type(12.5, 400, { color: C.t3 }), { marginTop: 5 }]}>Belgeyi çerçevenin içinde sabit tut</Text>
      </View>
      <View style={{ gap: 9, marginTop: 24 }}>
        {SCAN_STEPS.map((label, i) => {
          const on = i <= stage;
          return (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, opacity: on ? 1 : 0.45 }}>
              <View style={{ width: 18, height: 18, borderRadius: 999, borderWidth: 1.5, borderColor: on ? C.lime : C.ringIdle, backgroundColor: on ? C.lime : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={type(10, 800, { color: C.ink })}>{on ? '✓' : ''}</Text>
              </View>
              <Text style={type(13, 500, { color: on ? C.t1 : C.t3 })}>{label}</Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
