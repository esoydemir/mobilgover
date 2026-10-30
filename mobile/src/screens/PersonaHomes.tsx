import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { GradientFill } from '../components/Gradient';
import { Callout, Card, Chevron, PrimaryButton, Tap, Tile, s } from '../components/ui';
import { BRANCHES, PROVIDER_ROWS } from '../data';
import { useApp } from '../state/app';
import { C, STATUS, type } from '../theme';

/** Multi-location HQ: the riskiest branch comes first; deviation beats the average. */
export function HqHome() {
  return (
    <>
      <View style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 28, padding: 20, overflow: 'hidden' }}>
        <GradientFill angle={155} stops={[[0, '#1a2207'], [0.6, '#0a0d04'], [1, C.bg]]} />
        <Text style={type(11, 600, { ls: 0.12, color: C.t3 })}>7 ŞUBE · MERKEZ GÖRÜNÜMÜ</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 12 }}>
          <Text style={type(52, 600, { family: 'outfit', ls: -0.04 })}>68</Text>
          <Text style={type(22, 400, { color: C.t3 })}>/100</Text>
        </View>
        <Text style={[type(14, 400, { lh: 1.45, color: C.t2 }), { marginTop: 9 }]}>
          ortalama uyum. <Text style={type(14, 600, { color: C.crit })}>Bostancı</Text> iki haftadır geriliyor.
        </Text>
      </View>
      {BRANCHES.map(b => {
        const fg = STATUS[b.tone].fg;
        return (
          <View key={b.name} style={[s.row, { gap: 12, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16, borderColor: b.tone === 'crit' ? STATUS.crit.bd : C.bd }]}>
            <View style={{ width: 5, height: 34, borderRadius: 999, backgroundColor: fg }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(14, 600, { ls: -0.01 })}>{b.name}</Text>
              <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 3 }]}>{b.meta}</Text>
            </View>
            <Text style={type(19, 600, { family: 'outfit', ls: -0.03, color: fg })}>{b.score}</Text>
          </View>
        );
      })}
      <Card radius={22} style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
        <Text style={type(13.5, 600)}>Şube standardını kopyala</Text>
        <Text style={[type(12, 400, { lh: 1.5, color: C.t2 }), { marginTop: 5 }]}>"Kafe Standardı" şablonu: 14 görev, 6 form, 9 belge beklentisi. Yeni şubeye tek dokunuşla uygula.</Text>
      </Card>
    </>
  );
}

/** Employee: only their own assigned checks — no penalties, score or others' data. */
export function EmployeeHome() {
  const { showToast, openSheet } = useApp();
  const [checkedIn, setCheckedIn] = useState(false);
  const tasks = [
    { icon: '❄️', title: 'Soğuk zincir sıcaklık kaydı', meta: 'Fotoğraf + değer · 1 dk', open: () => router.push('/task/t1') },
    { icon: '🧼', title: 'El yıkama istasyonu kontrolü', meta: 'Onay kutusu · 20 sn', open: () => showToast('Tamamlandı', 'Kanıt gerekmiyordu') },
    { icon: '🎓', title: 'Hijyen eğitimi · 45 dk', meta: 'Sana atandı · bu hafta', open: () => openSheet('training') },
  ];
  return (
    <>
      <Card radius={32} style={{ padding: 20 }}>
        <Text style={type(11, 600, { ls: 0.12, color: C.t3 })}>VARDİYA · 09:00 – 17:00</Text>
        <Text style={[type(24, 600, { family: 'outfit', ls: -0.03 }), { marginTop: 12 }]}>Günaydın, Elif</Text>
        <Text style={[type(14, 400, { lh: 1.45, color: C.t2 }), { marginTop: 6 }]}>
          Sana atanmış <Text style={type(14, 600)}>3 kontrol</Text> var. Hepsi 2 dakikadan kısa.
        </Text>
        <Tap
          onPress={() => { setCheckedIn(v => !v); showToast(checkedIn ? 'Çıkış yapıldı' : 'Vardiyaya giriş yapıldı', 'QR ile kaydedildi · 09:41'); }}
          style={{ height: 48, marginTop: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: checkedIn ? C.tile : C.lime }}
        >
          <Text style={type(13.5, 700, { color: checkedIn ? C.t1 : C.ink })}>{checkedIn ? 'Vardiyadan çık' : 'QR ile vardiyaya giriş'}</Text>
        </Tap>
      </Card>
      {tasks.map(t => (
        <Tap key={t.title} onPress={t.open} style={[s.row, { gap: 13, borderRadius: 22, paddingVertical: 15, paddingHorizontal: 16 }]}>
          <Tile size={36} fontSize={16}>{t.icon}</Tile>
          <View style={{ flex: 1 }}>
            <Text style={type(14, 600, { ls: -0.01 })}>{t.title}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{t.meta}</Text>
          </View>
          <Chevron />
        </Tap>
      ))}
      <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { padding: 4 }]}>Personel yalnızca kendisine atanan işi, kendi belgelerini ve eğitimlerini görür. Ceza tutarı, skor ve diğer personelin verisi görünmez.</Text>
    </>
  );
}

/** Professional / service provider: today's jobs and their own credential compliance. */
export function ProviderHome() {
  return (
    <>
      <Card radius={32} style={{ padding: 20 }}>
        <Text style={type(11, 600, { ls: 0.12, color: C.t3 })}>BUGÜN · 3 İŞ</Text>
        <Text style={[type(24, 600, { family: 'outfit', ls: -0.03 }), { marginTop: 12 }]}>Sıradaki: Kahve Durağı</Text>
        <Text style={[type(14, 400, { lh: 1.45, color: C.t2 }), { marginTop: 6 }]}>Soğutma arızası · Kadıköy · 11:30. Vardığında işletme QR'ını okut.</Text>
        <PrimaryButton label="QR ile giriş yap" onPress={() => router.push('/qr')} height={48} size={13.5} style={{ marginTop: 16 }} />
      </Card>
      <Callout tone="warn" title="Yetki belgen 24 gün sonra doluyor" body={'Yenilenmezse "Soğutma Bakım Sözleşmesi" paketi satıştan çıkar. Profilin silinmez, yenileme durumuna geçer.'} />
      {PROVIDER_ROWS.map(r => (
        <View key={r.label} style={[s.row, { gap: 12, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={type(13.5, 600)}>{r.label}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{r.sub}</Text>
          </View>
          <Text style={type(17, 600, { family: 'outfit', ls: -0.03 })}>{r.value}</Text>
        </View>
      ))}
    </>
  );
}
