import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, PrimaryButton, Rise, Tap } from '../components/ui';
import { FORM_QUESTIONS } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

type Answer = 'Evet' | 'Hayır' | null;
type Key = (typeof FORM_QUESTIONS)[number]['key'];

/** Dynamic form engine: conditional question, live scoring, version lock. */
export default function FormRoute() {
  const { showToast } = useApp();
  const [answers, setAnswers] = useState<Record<Key, Answer>>({ f1: 'Evet', f2: null, f3: null, f4: null });
  const values = Object.values(answers);
  const hasNo = values.includes('Hayır');
  const score = values.filter(v => v === 'Evet').length * 25;

  const submit = () => {
    if (hasNo) {
      goRoot('/');
      router.push('/ncr');
      showToast('Form gönderildi', '1 uygunsuzluk açıldı · düzeltici faaliyet atandı', 'warn');
    } else {
      goRoot('/');
      showToast('Form gönderildi', 'HIJ-KTRL v4 · kanıt zincirine yazıldı');
    }
  };

  return (
    <Screen title="Hijyen kontrol formu" titleEn="Dynamic form">
      <Card radius={22} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16 }}>
        <View>
          <Text style={type(10, 600, { ls: 0.11, color: C.t3 })}>FORM SÜRÜMÜ</Text>
          <Text style={[type(12, 400, { family: 'mono' }), { marginTop: 5 }]}>HIJ-KTRL v4 · 12.06.2026</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={type(10, 600, { ls: 0.11, color: C.t3 })}>PUAN</Text>
          <Text style={[type(19, 600, { family: 'outfit', ls: -0.03, color: hasNo ? C.crit : C.lime }), { marginTop: 3 }]}>{score} / 100</Text>
        </View>
      </Card>
      {FORM_QUESTIONS.map(q => {
        const ans = answers[q.key];
        return (
          <Card key={q.key} border={ans === 'Hayır' ? tint.crit(0.24) : C.bd} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
              <Text style={type(11, 400, { family: 'mono', color: C.t3 })}>{q.no}</Text>
              <Text style={[type(14.5, 600, { ls: -0.01, lh: 1.35 }), { flex: 1 }]}>{q.label}</Text>
              {q.required && <Text style={type(9.5, 700, { ls: 0.08, color: C.warn })}>ZORUNLU</Text>}
            </View>
            {q.isCond && <Text style={[type(11.5, 400, { color: C.info }), { marginTop: 7 }]}>"Evet" yanıtı verdiğin için bu soru eklendi</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
              {(['Evet', 'Hayır'] as const).map(o => {
                const on = ans === o;
                const bad = o === 'Hayır';
                return (
                  <Tap
                    key={o}
                    accessibilityState={{ selected: on }}
                    onPress={() => setAnswers(a => ({ ...a, [q.key]: o }))}
                    style={{
                      flex: 1, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                      borderColor: on ? (bad ? tint.crit(0.5) : tint.lime(0.45)) : C.bds,
                      backgroundColor: on ? (bad ? tint.crit(0.12) : tint.lime(0.1)) : C.chip,
                    }}
                  >
                    <Text style={type(13, 600, { color: on ? (bad ? C.crit : C.lime) : C.t2 })}>{o}</Text>
                  </Tap>
                );
              })}
            </View>
            {ans === 'Hayır' && (
              <Rise duration={200} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start', borderWidth: 1, borderColor: tint.crit(0.3), backgroundColor: tint.crit(0.08), borderRadius: 14, paddingVertical: 12, paddingHorizontal: 13, marginTop: 11 }}>
                <Text style={type(12, 800, { color: C.crit })}>!</Text>
                <Text style={[type(12, 400, { lh: 1.45, color: C.t2 }), { flex: 1 }]}>
                  <Text style={type(12, 600, { color: C.crit })}>Uygunsuzluk açılacak.</Text> Bu yanıt kritik kontrol noktası — formu gönderdiğinde düzeltici faaliyet oluşur.
                </Text>
              </Rise>
            )}
          </Card>
        );
      })}
      <PrimaryButton label="Formu gönder" onPress={submit} style={{ marginTop: 4 }} />
      <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { textAlign: 'center' }]}>Gönderilen form, o anki sürümüne kilitlenir. Sonradan form değişse bile bu kayıt v4 olarak kalır.</Text>
    </Screen>
  );
}
