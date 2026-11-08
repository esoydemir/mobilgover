import { router, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { useQueue } from '../api/queue';
import { useSession } from '../api/session';
import { Screen } from '../components/Screen';
import { Chevron, Pill, Tap, Tile, s } from '../components/ui';
import { C, tint, type } from '../theme';

type Item = { icon: string; label: string; sub: string; href: Href; badge?: number; show?: boolean };

export default function MoreRoute() {
  const { role, me, companies, company } = useSession();
  const { ops } = useQueue();
  const manager = role === 'owner' || role === 'hq_manager' || role === 'site_manager';
  const verifier = !!company?.grants?.some(g => g.scopes.includes('ncr_verify'));
  const items: Item[] = [
    { icon: '📋', label: 'Yükümlülükler', sub: 'Neden uygulandığı, kaynak ve kural sürümü', href: '/obligations', show: manager },
    { icon: '🔔', label: 'Bildirimler', sub: 'Atama, termin, gecikme ve doğrulama istekleri', href: '/notifications' },
    { icon: '✅', label: 'Doğrulama bekleyenler', sub: '"Yapıldı" beyanları ve kapanışlar', href: '/verify-queue', show: manager || verifier },
    { icon: '⚠️', label: 'Uygunsuzluklar', sub: 'Sorun bildir, sorumlu ve termin, neden, aksiyon, doğrulama', href: '/ncrs' },
    { icon: '🗂️', label: 'Belge kasası', sub: 'Ruhsat, sertifika, rapor; sürüm, inceleme ve süre hatırlatması', href: '/documents', show: manager },
    { icon: '🧑‍🔧', label: 'Hizmet talepleri', sub: 'Uzman bul, teklif karşılaştır, teslim kabul', href: '/services', show: manager },
    { icon: '🏢', label: 'İşletme profili', sub: 'Yükümlülükleri belirleyen yanıtlar', href: '/profile', show: role === 'owner' || role === 'hq_manager' },
    { icon: '🧭', label: 'Dış doğrulayıcılar', sub: 'Sınırlı ve süreli bağımsız doğrulama izni', href: '/verifiers', show: role === 'owner' || role === 'hq_manager' },
    { icon: '👥', label: 'Ekip', sub: 'Şube yöneticisi ve personel ekle', href: '/team', show: role === 'owner' || role === 'hq_manager' },
    { icon: '🧊', label: 'Ekipmanlar', sub: 'Soğutucular ve ölçüm cihazları', href: '/equipment', show: manager },
    { icon: '🔄', label: 'Eşitleme', sub: 'Cihazda bekleyen kayıtlar', href: '/sync', badge: ops.length },
    { icon: '🪪', label: 'Uzman alanı', sub: 'Mesleki profil, doğrulama, teklifler', href: '/pro' },
    { icon: '🛡️', label: 'Yönetim', sub: 'Kural onayı ve pazar yeri incelemesi', href: '/admin', show: (me?.platformRoles.length ?? 0) > 0 },
    { icon: '⚙️', label: 'Hesap ve güvenlik', sub: 'Ek doğrulama, ortam bilgisi, çıkış', href: '/account' },
  ];
  return (
    <Screen title="Daha" titleEn="More" gap={11}>
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
