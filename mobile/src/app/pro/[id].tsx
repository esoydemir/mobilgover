import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { Card, Eyebrow, GhostButton, PrimaryButton, Tile } from '../../components/ui';
import { PROS, PRO_SERVICES, PRO_STATS, VERIFICATIONS } from '../../data';
import { useApp } from '../../state/app';
import { C, tint, type } from '../../theme';

/** Expert profile with an honest list of what was and wasn't verified. */
export default function ProRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pro = PROS.find(p => p.id === id) ?? PROS[0];
  const { showToast, openSheet } = useApp();
  const [booked, setBooked] = useState(false);
  return (
    <Screen title="Uzman profili" titleEn="Professional profile">
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Tile size={64} radius={20} fontSize={23} initials>{pro.initials}</Tile>
        <View style={{ flex: 1 }}>
          <Text style={type(21, 600, { family: 'outfit', ls: -0.03 })}>{pro.name}</Text>
          <Text style={[type(12.5, 400, { color: C.t2 }), { marginTop: 3 }]}>Soğutma teknik servisi · 11 yıl</Text>
        </View>
      </View>
      <Card>
        <Eyebrow>DOĞRULAMA · NE KONTROL EDİLDİ</Eyebrow>
        <View style={{ gap: 11, marginTop: 14 }}>
          {VERIFICATIONS.map(v => (
            <View key={v.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 19, height: 19, borderRadius: 999, backgroundColor: v.ok ? tint.lime(0.16) : C.track, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={type(11, 800, { color: v.ok ? C.lime : C.t3 })}>{v.ok ? '✓' : '–'}</Text>
              </View>
              <Text style={[type(13.5, 500), { flex: 1 }]}>{v.label}</Text>
              <Text style={type(11, 400, { color: v.ok ? C.lime : C.t3 })}>{v.ok ? 'Doğrulandı' : 'Kontrol edilmedi'}</Text>
            </View>
          ))}
        </View>
        <Text style={[type(11.5, 400, { lh: 1.45, color: C.t3 }), { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.bd }]}>
          Oda yetki belgesi doğrulanmadı. Bu sağlayıcı "GoverHub Onaylı Uzman" değil.
        </Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: 11 }}>
        {PRO_STATS.map(st => (
          <Card key={st.label} radius={22} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 13 }}>
            <Text style={type(21, 600, { family: 'outfit', ls: -0.03 })}>{st.value}</Text>
            <Text style={[type(10, 600, { ls: 0.09, color: C.t3 }), { marginTop: 5 }]}>{st.label}</Text>
          </Card>
        ))}
      </View>
      <Card>
        <Eyebrow>HİZMET PAKETLERİ</Eyebrow>
        {PRO_SERVICES.map(sv => (
          <View key={sv.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.bd }}>
            <View style={{ flex: 1 }}>
              <Text style={type(13.5, 600)}>{sv.name}</Text>
              <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{sv.scope}</Text>
            </View>
            <Text style={type(15, 600, { family: 'outfit' })}>{sv.price}</Text>
          </View>
        ))}
        <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 12 }]}>Uzman geldiğinde işletme QR'ını okutur; giriş–çıkış ve teslim edilen rapor kanıt zincirine yazılır.</Text>
      </Card>
      <PrimaryButton
        label={booked ? 'Randevu oluşturuldu ✓' : 'Bugün 11:30 için tut · ₺850'}
        onPress={() => { setBooked(true); showToast('Randevu oluşturuldu', 'Bugün 11:30 · QR ile giriş yapacak'); }}
      />
      <GhostButton label="3 teklif topla" onPress={() => openSheet('quote')} />
    </Screen>
  );
}
