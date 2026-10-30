import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { GhostButton, Pill, Tap } from '../components/ui';
import { goRoot, useApp } from '../state/app';
import { C, tint, type } from '../theme';

type Action = { label: string; primary?: boolean; go: () => void };

/** Notifications by level — every one is tied to an action. */
export default function NotificationsRoute() {
  const { showToast, openSheet } = useApp();
  const items: { lvl: string; fg: string; bg: string; bd: string; cardBg: string; time: string; title: string; body: string; actions: Action[] }[] = [
    { lvl: 'KRİTİK', fg: C.crit, bg: tint.crit(0.14), bd: tint.crit(0.28), cardBg: tint.crit(0.04), time: '09:12',
      title: 'Yangın tüpü kontrolü 3 gün içinde', body: 'Süre geçerse denetimde eksik sayılır ve ceza riski yükselir.',
      actions: [{ label: 'Servis bul', primary: true, go: () => goRoot('/experts') }, { label: 'Hatırlat', go: () => showToast('Hatırlatma kuruldu', 'Yarın 09:00') }] },
    { lvl: 'İŞLEM GEREKLİ', fg: C.warn, bg: tint.warn(0.14), bd: tint.warn(0.24), cardBg: C.sheet, time: 'Dün',
      title: 'Alerjen Etiketleme Tebliği güncellendi', body: 'Menü kartlarında 14 alerjen için yeni format 01.09.2026 itibarıyla aranıyor. 30 gün süren var.',
      actions: [{ label: 'Görevi aç', primary: true, go: () => router.push('/task/t3') }, { label: 'Neden?', go: () => openSheet('why') }] },
    { lvl: 'BİLGİ', fg: C.info, bg: tint.info(0.14), bd: C.bd, cardBg: C.sheet, time: 'Dün',
      title: 'Elif K. hijyen eğitimini tamamladı', body: 'Uyum skorun 4 puan arttı. Katılım belgesi kasaya eklendi.',
      actions: [{ label: 'Belgeyi gör', go: () => goRoot('/docs') }] },
    { lvl: 'PAZAR YERİ', fg: C.t2, bg: tint.white(0.08), bd: C.bd, cardBg: C.sheet, time: '2 gün',
      title: '3 teklif geldi', body: 'Soğutma arızası talebine Murat Yıldız, Soğuk-Tek ve Hakan Bulut yanıt verdi.',
      actions: [{ label: 'Teklifleri karşılaştır', primary: true, go: () => goRoot('/quotes') }] },
  ];
  return (
    <Screen title="Bildirimler" titleEn="Notifications" gap={11}>
      {items.map(n => (
        <View key={n.title} style={{ borderWidth: 1, borderColor: n.bd, borderRadius: 22, backgroundColor: n.cardBg, paddingVertical: 16, paddingHorizontal: 17 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pill label={n.lvl} fg={n.fg} bg={n.bg} ls={0.09} />
            <Text style={[type(11, 400, { color: C.t3 }), { marginLeft: 'auto' }]}>{n.time}</Text>
          </View>
          <Text style={[type(14.5, 600, { ls: -0.01, lh: 1.3 }), { marginTop: 10 }]}>{n.title}</Text>
          <Text style={[type(12.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 5 }]}>{n.body}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {n.actions.map(a => (
              <Tap key={a.label} onPress={a.go} style={{ height: 38, paddingHorizontal: 15, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: a.primary ? 'transparent' : C.bds, backgroundColor: a.primary ? C.lime : 'transparent' }}>
                <Text style={type(12.5, 600, { color: a.primary ? C.ink : C.t1 })}>{a.label}</Text>
              </Tap>
            ))}
          </View>
        </View>
      ))}
      <GhostButton label="Kanal tercihlerini düzenle" onPress={() => router.push('/settings')} style={{ marginTop: 4 }} />
    </Screen>
  );
}
