import { router, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { useQueue } from '../api/queue';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { Chevron, Pill, Tap, Tile, s } from '../components/ui';
import { C, tint, type } from '../theme';

type Item = { icon: string; label: string; sub: string; href: Href; badge?: number; show?: boolean };

export default function MoreRoute() {
  const { role, me, env, companies, company, sites, siteId, selectSite } = useSession();
  const { ops } = useQueue();
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const verifier = !!company?.grants?.some(g => g.scopes.includes('ncr_verify'));
  const items: Item[] = [
    { icon: '🛒', label: 'Pazar', sub: 'Uzmanlar / servisler, teklifler, profesyonel akış', href: '/market', show: manager },
    { icon: '₺', label: 'Ceza ve yasal risk', sub: 'Açık risk kalemleri; ceza tutarı modellenmedi', href: '/risk', show: manager },
    { icon: '📊', label: 'Rapor ve denetim dosyası', sub: 'Uyum göstergeleri, PDF denetim dosyası', href: '/report', show: manager },
    { icon: '📋', label: 'Yükümlülükler', sub: 'Neden uygulandığı, kaynak ve kural sürümü', href: '/obligations', show: manager },
    { icon: '🧭', label: 'Bugün · yönetici ekranı', sub: 'Kritik riskler, gecikmeler, doğrulama, belge süreleri, tekrarlar', href: '/board', show: manager },
    { icon: '📌', label: 'Bana atananlar', sub: 'Açık aksiyonların, geciken kontrollerin, sorumlusu olduğun kayıtlar', href: '/board', show: role === 'staff' },
    { icon: '🔔', label: 'Bildirimler', sub: 'Atama, termin, gecikme ve doğrulama istekleri', href: '/notifications' },
    { icon: '✅', label: 'Doğrulama bekleyenler', sub: '"Yapıldı" beyanları ve kapanışlar', href: '/verify-queue', show: manager || verifier },
    { icon: '🎓', label: 'Eğitimler', sub: 'Atanan eğitimler, içerikler, sahada etkinlik', href: '/trainings', show: !!role },
    { icon: '⚠️', label: 'Uygunsuzluklar', sub: 'Sorun bildir, sorumlu ve termin, neden, aksiyon, doğrulama', href: '/ncrs' },
    { icon: '🗂️', label: 'Belge kasası', sub: 'Ruhsat, sertifika, rapor; sürüm, inceleme ve süre hatırlatması', href: '/documents', show: manager },
    { icon: '🧑‍🔧', label: 'Uzman bul · hizmet talepleri', sub: 'Talep aç, teklifleri karşılaştır, teslim kabul', href: '/services', show: manager },
    { icon: '🏢', label: 'İşletme profili', sub: 'Yükümlülükleri belirleyen yanıtlar', href: '/profile', show: role === 'owner' || role === 'hq_manager' },
    { icon: '🧭', label: 'Dış doğrulayıcılar', sub: 'Sınırlı ve süreli bağımsız doğrulama izni', href: '/verifiers', show: role === 'owner' || role === 'hq_manager' },
    { icon: '👥', label: 'Ekip', sub: 'Şube yöneticisi ve personel ekle', href: '/team', show: role === 'owner' || role === 'hq_manager' },
    { icon: '🧊', label: 'Ekipmanlar', sub: 'Soğutucular ve ölçüm cihazları', href: '/equipment', show: manager },
    { icon: '🔄', label: 'Eşitleme', sub: 'Cihazda bekleyen kayıtlar', href: '/sync', badge: ops.length },
    { icon: '🤝', label: 'Mesleki ağ', sub: 'Profil, uzman arama, takip, paylaşım ve yorum', href: '/network' },
    { icon: '🚩', label: 'Ağ moderasyonu', sub: 'Şikâyetler, gerekçeli kararlar', href: '/moderation', show: !!me?.platformRoles.includes('network_moderator') },
    { icon: '🪪', label: 'Uzman alanı', sub: 'Mesleki profil, doğrulama, teklifler', href: '/pro' },
    { icon: '🛡️', label: 'Yönetim', sub: 'Kural onayı ve pazar yeri incelemesi', href: '/admin', show: (me?.platformRoles.length ?? 0) > 0 },
    { icon: '🏛️', label: 'Kurum görünümü (sentetik demo)', sub: 'Bölge ve işletme türüne göre tekrar ve neden dağılımı; gerçek veri değil', href: '/institution', show: (me?.platformRoles.length ?? 0) > 0 || env?.mode === 'demo' },
    { icon: '⚙️', label: 'Hesap ve güvenlik', sub: 'Ek doğrulama, ortam bilgisi, çıkış', href: '/account' },
  ];
  return (
    <Screen title="Daha" titleEn="More" gap={11}>
      {sites.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text style={type(11, 700, { ls: 0.08, color: C.t3 })}>ÇALIŞILAN ŞUBE</Text>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {sites.map(st => (
              <Tap key={st.id} testID={`site-pick-${st.id}`} onPress={() => selectSite(st.id)}
                style={{ paddingHorizontal: 13, height: 34, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: st.id === siteId ? tint.lime(0.5) : C.bd, backgroundColor: st.id === siteId ? tint.lime(0.1) : 'transparent' }}>
                <Text style={type(12, 600, { color: st.id === siteId ? C.lime : C.t2 })}>{st.name}</Text>
              </Tap>
            ))}
          </View>
        </View>
      ) : null}
      {companies.length === 0 ? <Text style={type(12.5, 400, { color: C.t2 })}>Bir işletmeye bağlı değilsin.</Text> : null}
      {items.filter(i => i.show !== false).map(m => (
        <Tap key={m.label} testID={`more-${String(m.href).slice(1)}`} onPress={() => router.push(m.href)} style={[s.row, { gap: 13, borderRadius: 22, paddingVertical: 15, paddingHorizontal: 16 }]}>
          <Tile size={36} fontSize={16}>{m.icon}</Tile>
          <View style={{ flex: 1 }}>
            <Text style={type(14, 600, { ls: -0.01 })}>{m.label}</Text>
            <Text style={[type(11.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{m.sub}</Text>
          </View>
          {m.badge ? <Pill label={String(m.badge)} fg={C.warn} bg={tint.warn(0.14)} size={10} ls={0} /> : null}
          <Chevron />
        </Tap>
      ))}
    </Screen>
  );
}
