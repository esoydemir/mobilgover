import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { PrimaryButton, Rise, Tap, Tile, s } from '../components/ui';
import { ONB_RESULTS, ONB_STEPS } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

/** Five-step setup: document upload/OCR, confirmation, sector questions, size, result. */
export default function OnboardingRoute() {
  const { showToast } = useApp();
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const onb = ONB_STEPS[step];
  const last = ONB_STEPS.length - 1;

  const next = () => {
    if (step === 1 && pick === null) { setPick('a'); return; }
    if (step >= last) {
      goRoot('/');
      showToast('Kurulum %62', 'Çalışmaya başlarken kalanı tamamlarız');
      return;
    }
    setStep(step + 1);
    setPick(null);
  };
  const skip = () => {
    if (step >= last) return;
    setStep(step + 1);
    setPick(null);
  };

  return (
    <Screen title="Kurulum" titleEn="Onboarding" gap={0}>
      <View style={{ flexDirection: 'row', gap: 5, marginBottom: 22 }}>
        {ONB_STEPS.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, backgroundColor: i <= step ? C.lime : tint.white(0.09) }} />)}
      </View>
      <Text style={type(10.5, 600, { ls: 0.12, color: C.lime })}>{onb.step}</Text>
      <Text style={[type(27, 600, { family: 'outfit', ls: -0.035, lh: 1.12 }), { marginTop: 10 }]}>{onb.title}</Text>
      <Text style={[type(14.5, 400, { lh: 1.5, color: C.t2 }), { marginTop: 10 }]}>{onb.body}</Text>

      {onb.options.length > 0 && (
        <View style={{ gap: 10, marginTop: 22 }}>
          {onb.options.map(o => {
            const on = pick === o.v;
            return (
              <Tap
                key={o.v}
                accessibilityState={{ selected: on }}
                onPress={() => setPick(o.v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: on ? tint.lime(0.4) : C.bd, borderRadius: 18, backgroundColor: on ? tint.lime(0.06) : C.sheet, padding: 16 }}
              >
                {o.icon && <Tile size={34} radius={11} fontSize={16}>{o.icon}</Tile>}
                <View style={{ flex: 1 }}>
                  <Text style={type(14.5, 600, { ls: -0.01 })}>{o.label}</Text>
                  <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>{o.sub}</Text>
                </View>
                {on && (
                  <View style={{ width: 21, height: 21, borderRadius: 999, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={type(11, 800, { color: C.ink })}>✓</Text>
                  </View>
                )}
              </Tap>
            );
          })}
        </View>
      )}

      {onb.isResult && (
        <View style={{ gap: 11, marginTop: 20 }}>
          {ONB_RESULTS.map((r, i) => (
            <Rise key={r.label} delay={i * 60} duration={400} style={[s.row, { gap: 12, borderRadius: 22, paddingVertical: 15, paddingHorizontal: 16 }]}>
              <Text style={[type(23, 600, { family: 'outfit', ls: -0.03, color: C.lime }), { minWidth: 34 }]}>{r.n}</Text>
              <View style={{ flex: 1 }}>
                <Text style={type(13.5, 600)}>{r.label}</Text>
                <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{r.sub}</Text>
              </View>
            </Rise>
          ))}
        </View>
      )}

      <PrimaryButton label={onb.cta} onPress={next} style={{ marginTop: 24 }} />
      {onb.skip ? (
        <Tap onPress={skip} style={{ height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          <Text style={type(13, 500, { color: C.t3 })}>{onb.skip}</Text>
        </Tap>
      ) : null}
    </Screen>
  );
}
