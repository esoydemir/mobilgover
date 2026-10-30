import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, Eyebrow, GhostButton, Pulse, Tap, s } from '../components/ui';
import { NOTIFICATION_MATRIX, PERSONAS, SETTINGS_TOGGLES } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

type ToggleKey = (typeof SETTINGS_TOGGLES)[number]['key'];

export default function SettingsRoute() {
  const { showToast, persona, setPersona } = useApp();
  const [on, setOn] = useState<Record<ToggleKey, boolean>>({ dark: true, onehand: false, sms: true, morning: true, lang: true });
  const [offline, setOffline] = useState(false);

  return (
    <Screen title="Ayarlar" titleEn="Settings" gap={11}>
      {SETTINGS_TOGGLES.map(t => {
        const v = on[t.key];
        return (
          <Tap
            key={t.key}
            accessibilityRole="switch"
            accessibilityState={{ checked: v }}
            onPress={() => setOn(o => ({ ...o, [t.key]: !o[t.key] }))}
            style={[s.row, { gap: 13, borderRadius: 22, paddingVertical: 15, paddingHorizontal: 16 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={type(14, 600, { ls: -0.01 })}>{t.label}</Text>
              <Text style={[type(11.5, 400, { lh: 1.4, color: C.t3 }), { marginTop: 3 }]}>{t.sub}</Text>
            </View>
            <View style={{ width: 44, height: 26, borderRadius: 999, padding: 2, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: v ? 'flex-end' : 'flex-start', backgroundColor: v ? tint.lime(0.9) : C.tile, borderColor: v ? 'transparent' : C.bds }}>
              <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: v ? C.ink : C.t2 }} />
            </View>
          </Tap>
        );
      })}

      <Card style={{ marginTop: 4 }}>
        <Eyebrow>BİLDİRİM MATRİSİ</Eyebrow>
        <View style={{ gap: 11, marginTop: 14 }}>
          {NOTIFICATION_MATRIX.map(m => (
            <View key={m.cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[type(13, 500), { flex: 1 }]}>{m.cat}</Text>
              <Text style={type(10.5, 400, { family: 'mono', color: m.on ? C.lime : C.t2 })}>{m.channels}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Eyebrow>EŞİTLEME</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 }}>
          <Pulse><View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: offline ? C.warn : C.lime }} /></Pulse>
          <Text style={[type(13.5, 600), { flex: 1 }]}>{offline ? 'Çevrimdışı · 3 kayıt bekliyor' : 'Eşitlendi · 09:41'}</Text>
        </View>
        <Text style={[type(12, 400, { lh: 1.5, color: C.t2 }), { marginTop: 8 }]}>
          {offline
            ? '2 form ve 1 fotoğraf cihazda kuyrukta. Bağlantı gelince sıra korunarak yüklenir; çakışma olursa üzerine yazmadan sana sorar.'
            : 'Tüm görev, form ve kanıtlar sunucuda. Çevrimdışıyken de görev doldurmaya devam edebilirsin.'}
        </Text>
        <GhostButton
          label={offline ? 'Şimdi eşitle' : 'Çevrimdışı modu dene'}
          height={40}
          size={12.5}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 16, marginTop: 13 }}
          onPress={() => {
            setOffline(!offline);
            showToast(offline ? 'Eşitleme tamamlandı' : 'Çevrimdışı mod', '3 kayıt sıraya alındı · kayıp yok', offline ? 'ok' : 'warn');
          }}
        />
      </Card>

      <Card>
        <Eyebrow>ROL / PERSONA</Eyebrow>
        <Text style={[type(12, 400, { lh: 1.5, color: C.t2 }), { marginTop: 8 }]}>Aynı iş grafiği, dört farklı rol. Ana sayfa seçilen role göre değişir.</Text>
        <View style={{ gap: 7, marginTop: 14 }}>
          {PERSONAS.map(p => {
            const active = persona === p.key;
            return (
              <Tap
                key={p.key}
                accessibilityState={{ selected: active }}
                onPress={() => setPersona(p.key)}
                style={{ gap: 2, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: active ? tint.lime(0.4) : C.bd, backgroundColor: active ? tint.lime(0.07) : C.sheet }}
              >
                <Text style={type(13, 600, { ls: -0.01, color: active ? C.lime : C.t1 })}>{p.tr}</Text>
                <Text style={type(10.5, 400, { color: C.t3 })}>{p.en}</Text>
              </Tap>
            );
          })}
        </View>
      </Card>
    </Screen>
  );
}
