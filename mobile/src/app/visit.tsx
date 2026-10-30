import { useState } from 'react';
import { Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { Screen } from '../components/Screen';
import { Card, Eyebrow, PrimaryButton, Tap, TimelineRow } from '../components/ui';
import { EVIDENCE_CHAIN, RATING_DIMENSIONS } from '../data';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

/** Completed service visit: hash-linked evidence chain and multi-dimension rating. */
export default function VisitRoute() {
  const { showToast } = useApp();
  const [rating, setRating] = useState<number[]>(RATING_DIMENSIONS.map(() => 0));
  return (
    <Screen title="Servis kaydı" titleEn="Service visit">
      <View style={{ borderWidth: 1, borderColor: tint.lime(0.28), borderRadius: 28, padding: 20, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#131d04'], [0.7, C.bg]]} />
        <Text style={type(10, 600, { ls: 0.11, color: C.lime })}>SERVİS · TAMAMLANDI</Text>
        <Text style={[type(22, 600, { family: 'outfit', ls: -0.03 }), { marginTop: 11 }]}>Murat Yıldız · soğutma onarımı</Text>
        <Text style={[type(13, 400, { lh: 1.5, color: C.t2 }), { marginTop: 7 }]}>Termostat değişti, ünite 3 °C'ye indi. Rapor ve fatura kasaya eklendi.</Text>
      </View>
      <Card>
        <Eyebrow>KANIT ZİNCİRİ</Eyebrow>
        <View style={{ marginTop: 14 }}>
          {EVIDENCE_CHAIN.map(c => (
            <TimelineRow key={c.hash} left={c.time} title={c.label} meta={c.hash} dot={C.lime} mono leftSize={10.5} dotTop={5} pb={15} titleSize={13} />
          ))}
        </View>
        <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { paddingTop: 12, borderTopWidth: 1, borderTopColor: C.bd }]}>
          Her kayıt öncekinin karmasını taşır. Sonradan değiştirilirse zincir kırılır ve denetimde görünür.
        </Text>
      </Card>
      <Card>
        <Eyebrow>DEĞERLENDİRME</Eyebrow>
        <Text style={[type(12.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 8 }]}>Yalnızca tamamlanmış işlemi olan işletme puan verebilir.</Text>
        <View style={{ gap: 12, marginTop: 15 }}>
          {RATING_DIMENSIONS.map((label, ri) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={[type(13, 500), { flex: 1 }]}>{label}</Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Tap
                    key={n}
                    accessibilityLabel={`${label}: ${n} yıldız`}
                    onPress={() => setRating(r => r.map((v, i) => (i === ri ? n : v)))}
                    style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={type(15, 400, { color: n <= rating[ri] ? C.lime : C.ringIdle })}>★</Text>
                  </Tap>
                ))}
              </View>
            </View>
          ))}
        </View>
        <PrimaryButton
          label="Değerlendirmeyi gönder"
          height={48}
          size={13.5}
          style={{ marginTop: 18 }}
          onPress={() => { goRoot('/'); showToast('Değerlendirme gönderildi', 'Yalnızca tamamlanmış işlem için geçerli sayıldı'); }}
        />
      </Card>
    </Screen>
  );
}
