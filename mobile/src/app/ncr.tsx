import { Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { Screen } from '../components/Screen';
import { Card, Eyebrow, GhostButton, PrimaryButton, StepMark } from '../components/ui';
import { CAPA } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

/** Nonconformity detail with the corrective/preventive action (CAPA) flow. */
export default function NcrRoute() {
  const { showToast } = useApp();
  return (
    <Screen title="Uygunsuzluk" titleEn="Nonconformity">
      <View style={{ borderWidth: 1, borderColor: tint.crit(0.3), borderRadius: 28, padding: 20, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#1a0a0a'], [0.6, '#0a0505'], [1, C.bg]]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: C.crit }} />
          <Text style={type(10, 700, { ls: 0.11, color: C.crit })}>KRİTİK · AÇIK · 4. TEKRAR</Text>
        </View>
        <Text style={[type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 12 }]}>Soğuk zincir limit aşımı</Text>
        <Text style={[type(13.5, 400, { lh: 1.5, color: C.t2 }), { marginTop: 8 }]}>Buzdolabı · Mutfak arka · 12 °C ölçüldü (limit 4 °C). Aynı ünitede bu ay 4. kez. Risk seviyesi yükseltildi.</Text>
      </View>
      <Card>
        <Eyebrow>DÜZELTİCİ FAALİYET AKIŞI</Eyebrow>
        <View style={{ marginTop: 14 }}>
          {CAPA.map(c => (
            <View key={c.label} style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
              <View style={{ width: 22, alignItems: 'center' }}>
                <StepMark state={c.state} />
                <View style={{ flex: 1, width: 1, backgroundColor: C.bd }} />
              </View>
              <View style={{ flex: 1, paddingBottom: 18 }}>
                <Text style={type(13.5, 600, { ls: -0.01, color: c.state === 'todo' ? C.t2 : C.t1 })}>{c.label}</Text>
                <Text style={[type(11.5, 400, { lh: 1.45, color: C.t3 }), { marginTop: 3 }]}>{c.meta}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { paddingTop: 13, borderTopWidth: 1, borderTopColor: C.bd }]}>
          Küçük işletmede akış üç adımda kapanır. Yüksek riskli operasyonda kök neden ve yönetici doğrulaması da istenir.
        </Text>
      </Card>
      <PrimaryButton label="Teknik servis çağır" onPress={() => goRoot('/experts')} />
      <GhostButton label="Ekipman değişimi değerlendir" onPress={() => showToast('Değişim analizi', "4 arıza · 11 yıl yaş · onarım maliyeti değişimin %58'i")} />
    </Screen>
  );
}
