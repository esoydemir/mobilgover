import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goRoot, useApp, type SheetKey } from '../state/app';
import { C, tint, type } from '../theme';
import { GhostButton, PrimaryButton, Tap, nativeDriver } from './ui';

type Row = { icon: string; label: string; sub: string; tone?: 'crit' | 'lime' };
type SheetDef = {
  eyebrow: string;
  title: string;
  body: string;
  rows: Row[];
  meta?: { k: string; v: string }[];
  input?: string;
  primaryLabel: string;
  primary: () => void;
};

function useSheetDefs(): Record<SheetKey, SheetDef> {
  const { closeSheet, showToast, completeTask, setTrained } = useApp();
  return {
    calc: {
      eyebrow: 'SKOR NASIL HESAPLANIR', title: 'Beş süreç, ağırlıklı ortalama',
      body: 'Her süreç tamamlanma oranıyla değil, yasal ağırlığıyla çarpılarak toplanır. Bu yüzden 6/14 ekipman, 18/22 belgeden daha çok puan düşürür.',
      rows: [
        { icon: '◉', label: 'Ekipman ve bakım · ağırlık 30', sub: 'Sağlık riski doğrudan · gecikme çarpanı var', tone: 'crit' },
        { icon: '◉', label: 'Belgeler · ağırlık 25', sub: 'Süresi dolan belge, eksik belgeden az düşürür' },
        { icon: '◉', label: 'Formlar · ağırlık 20', sub: 'Açık uygunsuzluk varsa ek kesinti' },
        { icon: '◉', label: 'Personel · ağırlık 15', sub: 'Eğitim ve portör muayenesi' },
        { icon: '◉', label: 'İSG · ağırlık 10', sub: 'Risk değerlendirmesi güncelliği' },
      ],
      meta: [{ k: 'Hesap zamanı', v: 'Her gece 03:00 · anlık olay sonrası' }, { k: 'Denetim skoru mu?', v: 'Hayır — GoverHub iç göstergesi' }, { k: 'Paylaşım', v: 'Yalnızca sen ve yetkilendirdiğin kişiler' }],
      primaryLabel: 'Anladım', primary: closeSheet,
    },
    why: {
      eyebrow: 'NEDEN BANA UYGULANIYOR', title: 'Restoran işletiyorsun ve LPG kullanıyorsun',
      body: 'Bu yükümlülük tahminle değil, doğruladığın işletme bilgileriyle eşleşti. Koşullardan biri değişirse yükümlülük yeniden hesaplanır.',
      rows: [
        { icon: '✓', label: 'Faaliyet: Yemek hazırlama', sub: 'İşletme kayıt belgenden okundu' },
        { icon: '✓', label: 'LPG kullanımı: Var', sub: 'Kurulum sorusunda sen onayladın' },
        { icon: '✓', label: 'Konum: İstanbul / Kadıköy', sub: 'Belediye kuralı ülke kuralına ekleniyor' },
      ],
      meta: [{ k: 'Dayanak', v: 'Binaların Yangından Korunması Hk. Yönetmelik' }, { k: 'Madde', v: 'Madde 99 · fıkra 2' }, { k: 'Yürürlük', v: '01.01.2024' }, { k: 'Son değişiklik', v: '12.06.2026' }, { k: 'GoverHub durumu', v: 'Uzman onaylı · doğrulanmış' }],
      primaryLabel: 'Kaynağı gör', primary: () => showToast('Resmî Gazete kaydı', 'Kaynak anlık görüntüsü ve karma değeri saklı'),
    },
    ncr: {
      eyebrow: 'UYGUNSUZLUK · KRİTİK', title: '12 °C ölçüldü, limit 4 °C',
      body: 'Kaydı aldık. Bu ünite bu ay 4. kez limit aştı, bu yüzden risk seviyesini yükselttik.',
      rows: [
        { icon: '1', label: 'Ürünü güvenli üniteye taşı', sub: 'Şimdi · sorumlu sen', tone: 'crit' },
        { icon: '2', label: 'Düzeltici faaliyet açıldı', sub: 'Teknik servis kontrolü · 24 saat' },
        { icon: '3', label: 'Şube yöneticisi bilgilendirildi', sub: 'Kritik bildirim gönderildi' },
      ],
      primaryLabel: 'Teknik servis bul',
      primary: () => {
        completeTask('t1');
        closeSheet();
        goRoot('/experts');
        showToast('Uygunsuzluk kaydedildi', 'Düzeltici faaliyet açıldı · servise yönlendirildin', 'warn');
      },
    },
    ai: {
      eyebrow: 'GOVERHUB ASİSTAN', title: 'Bu işletme hakkında ne sormak istersin?',
      body: 'Mevzuat yanıtları yalnızca doğrulanmış GoverHub kaynaklarından gelir. Model kendi başına yükümlülük üretmez.',
      rows: [
        { icon: '◆', label: '"Yeni personel alsam ne yapmam gerekir?"', sub: '6 adımlık işe alış listesi çıkarır' },
        { icon: '◆', label: '"Alerjen tebliği beni nasıl etkiliyor?"', sub: 'Madde ve yürürlük tarihiyle yanıtlar' },
        { icon: '◆', label: '"Bu ay hangi belgem doluyor?"', sub: 'Kasadan okur, yenileme görevi açar' },
      ],
      input: "GoverHub'a sor…",
      primaryLabel: 'Sesli sor', primary: () => showToast('Dinliyorum', 'Konuşmayı bitirdiğinde işleyeceğim'),
    },
    search: {
      eyebrow: 'KOMUT ARAMA', title: 'Her şeyde ara',
      body: 'Görev, belge, personel, ekipman, mevzuat ve uzman aynı yerde. Yetkin olmayan kayıt sonuçlarda çıkmaz.',
      rows: [
        { icon: '📄', label: 'yangın tüpü', sub: '2 belge · 1 görev · 1 ekipman · 1 mevzuat' },
        { icon: '🔎', label: 'anlamsal eşleşme', sub: '"söndürücü", "YSC" gibi terimler de bulunur' },
      ],
      input: 'Ara…',
      primaryLabel: 'Aramayı çalıştır', primary: () => showToast('4 sonuç', 'Varlık türüne göre gruplandı'),
    },
    quote: {
      eyebrow: 'TEKLİF TOPLA', title: '3 sağlayıcıdan aynı formatta teklif',
      body: 'Kapsam, fiyat, süre, dahil olan ve olmayan işler standart alanlarda gelir; elmayla elmayı karşılaştırırsın.',
      rows: [
        { icon: '①', label: 'Kapsamı onayla', sub: 'Soğutma arızası · yerinde · acil' },
        { icon: '②', label: '3 sağlayıcıya gönder', sub: 'Ortalama yanıt 40 dk' },
      ],
      primaryLabel: 'Teklif isteği gönder',
      primary: () => { closeSheet(); showToast('Teklif isteği gönderildi', '3 sağlayıcı · yanıtlar bildirim olarak gelir'); },
    },
    training: {
      eyebrow: 'EĞİTİM ATAMA', title: 'Hijyen eğitimi · 2 personel',
      body: 'Bu bir GoverHub katılım belgesidir; yetkili kurum sertifikası değildir. Ayrımı her ekranda açıkça gösteriyoruz.',
      rows: [
        { icon: '▶', label: 'Kayıtlı eğitim · 45 dk', sub: 'Video + kısa sınav · GoverHub katılım belgesi' },
        { icon: '◉', label: 'Canlı eğitim · 12 Eylül', sub: 'Doğrulanmış eğitmen · resmî sertifika yolu', tone: 'lime' },
      ],
      primaryLabel: 'İkisine de ata',
      primary: () => { closeSheet(); setTrained(true); showToast('Eğitim atandı', 'Elif K. ve Burak T. · takip başladı'); },
    },
    fault: {
      eyebrow: 'ARIZA BİLDİRİMİ', title: 'Buzdolabı · Mutfak arka',
      body: 'Personel arıza bildirebilir. Yönetici anında haber alır, servis geçmişi yapılandırılmış olarak birikir.',
      rows: [
        { icon: '📞', label: 'Kayıtlı servisi ara', sub: 'Soğuk-Tek · sözleşmeli' },
        { icon: '✳', label: 'GoverHub servis talebi oluştur', sub: 'QR girişli, kanıtlı servis kaydı', tone: 'lime' },
      ],
      primaryLabel: 'Servis talebi oluştur',
      primary: () => { closeSheet(); goRoot('/experts'); showToast('Arıza kaydı açıldı', 'Yönetici bilgilendirildi', 'warn'); },
    },
  };
}

function rowColors(tone: Row['tone']) {
  if (tone === 'crit') return { fg: C.t1, bd: tint.crit(0.3), bg: tint.crit(0.07) };
  if (tone === 'lime') return { fg: C.lime, bd: tint.lime(0.28), bg: tint.lime(0.05) };
  return { fg: C.t1, bd: C.bd, bg: C.chip };
}

export function Sheet() {
  const { sheet, closeSheet } = useApp();
  const defs = useSheetDefs();
  if (!sheet) return null;
  return <SheetBody key={sheet} def={defs[sheet]} onClose={closeSheet} />;
}

function SheetBody({ def, onClose }: { def: SheetDef; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }),
      Animated.timing(slide, { toValue: 1, duration: 280, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: nativeDriver }),
    ]).start();
  }, [fade, slide]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 8 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Pressable accessibilityLabel="Kapat" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.62)' }]} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[styles.panel, { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [700, 0] }) }] }]}
      >
        <ScrollView contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 22, paddingBottom: 34 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: tint.white(0.18), alignSelf: 'center', marginBottom: 18 }} />
          <Text style={type(10.5, 600, { ls: 0.12, color: C.t3 })}>{def.eyebrow}</Text>
          <Text style={[type(23, 600, { family: 'outfit', ls: -0.03, lh: 1.15 }), { marginTop: 9 }]}>{def.title}</Text>
          <Text style={[type(14, 400, { lh: 1.5, color: C.t2 }), { marginTop: 9 }]}>{def.body}</Text>

          <View style={{ gap: 9, marginTop: 20 }}>
            {def.rows.map(r => {
              const c = rowColors(r.tone);
              return (
                <View key={r.label} style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start', borderWidth: 1, borderColor: c.bd, borderRadius: 16, backgroundColor: c.bg, paddingVertical: 13, paddingHorizontal: 15 }}>
                  <Text style={[type(13, 400, { color: C.t1 }), { marginTop: 1 }]}>{r.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={type(13.5, 600, { ls: -0.01, color: c.fg })}>{r.label}</Text>
                    <Text style={[type(11.5, 400, { lh: 1.45, color: C.t2 }), { marginTop: 3 }]}>{r.sub}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {def.meta && (
            <View style={{ borderTopWidth: 1, borderTopColor: C.bd, marginTop: 20, paddingTop: 16, gap: 9 }}>
              {def.meta.map(m => (
                <View key={m.k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14 }}>
                  <Text style={type(12.5, 400, { color: C.t3 })}>{m.k}</Text>
                  <Text style={[type(12.5, 500), { textAlign: 'right', flexShrink: 1 }]}>{m.v}</Text>
                </View>
              ))}
            </View>
          )}

          {def.input && (
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 18 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={def.input}
                placeholderTextColor={C.t3}
                style={[type(13.5, 400), { flex: 1, height: 48, borderWidth: 1, borderColor: C.bds, borderRadius: 999, backgroundColor: C.chip, paddingHorizontal: 18 }]}
              />
              <Tap accessibilityLabel="Gönder" onPress={def.primary} style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={type(16, 800, { color: C.ink })}>↑</Text>
              </Tap>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 9, marginTop: 20 }}>
            <PrimaryButton label={def.primaryLabel} onPress={def.primary} height={50} size={13.5} style={{ flex: 1 }} />
            <GhostButton label="Kapat" onPress={onClose} height={50} style={{ paddingHorizontal: 20 }} />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '76%',
    backgroundColor: C.sheet, borderTopWidth: 1, borderTopColor: C.bds, borderTopLeftRadius: 32, borderTopRightRadius: 32,
  },
});
