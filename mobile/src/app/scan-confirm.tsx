import { Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { Screen } from '../components/Screen';
import { Callout, Card, GhostButton, PrimaryButton } from '../components/ui';
import { OCR_FIELDS } from '../data';
import { goBack, goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

export default function ScanConfirmRoute() {
  const { showToast } = useApp();
  return (
    <Screen title="Okunan alanlar" titleEn="Extracted fields">
      <View style={{ borderWidth: 1, borderColor: tint.lime(0.28), borderRadius: 22, padding: 18, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#131d04'], [0.7, C.bg]]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={type(11, 800, { color: C.ink })}>✓</Text>
          </View>
          <Text style={[type(10, 700, { ls: 0.11, color: C.lime }), { flexShrink: 1 }]}>OKUNDU · İŞLETME KAYIT BELGESİ</Text>
        </View>
        <Text style={[type(14, 400, { lh: 1.5, color: C.t2 }), { marginTop: 10 }]}>7 alan çıkarıldı. Kritik alanları onaylamadan kaydetmiyoruz.</Text>
      </View>
      {OCR_FIELDS.map(f => (
        <Card key={f.label} radius={22} border={f.low ? tint.warn(0.26) : C.bd} style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={type(10, 600, { ls: 0.11, color: C.t3 })}>{f.label}</Text>
            <Text style={type(10, 500, { family: 'mono', color: f.low ? C.warn : C.lime })}>{f.conf}</Text>
          </View>
          <Text style={[type(15, 600, { ls: -0.01 }), { marginTop: 7 }]}>{f.value}</Text>
          {f.low && <Text style={[type(11.5, 400, { color: C.warn }), { marginTop: 6 }]}>Düşük güven — kontrol et</Text>}
        </Card>
      ))}
      <Callout tone="info" title="Bu belge 3 yükümlülüğü etkiliyor" body="Onayladığında geçerlilik takibi, yenileme görevi ve 14.02.2027 hatırlatması otomatik kurulur." />
      <PrimaryButton
        label="Onayla ve kasaya kaydet"
        style={{ marginTop: 4 }}
        onPress={() => { goRoot('/docs'); showToast('Kasaya kaydedildi', '3 yükümlülük güncellendi · hatırlatma kuruldu'); }}
      />
      <GhostButton label="Elle düzelt" onPress={goBack} />
    </Screen>
  );
}
