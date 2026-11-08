import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../../../api/client';
import { useSession } from '../../../api/session';
import { useApi } from '../../../api/useApi';
import { Screen } from '../../../components/Screen';
import { ErrorBox, Loading } from '../../../components/states';
import { Card, Eyebrow, GhostButton, Pill, PrimaryButton, Tap } from '../../../components/ui';
import { credentialLabel } from '../../../features/labels';
import { Avatar, PostCard, ReportBox, type Post } from '../../../features/network';
import { useUi } from '../../../state/app';
import { C, tint, type } from '../../../theme';

type Profile = {
  userId: string; own: boolean; status: string; note: string; hasPhoto: boolean;
  declared: { displayName: string; title: string; bio: string; city: string; district: string | null; specialties: string[];
    categories: { code: string; name: string; approved: boolean }[];
    experience: { id: string; role_title: string; organization: string; start_year: number; end_year: number | null; description: string }[] };
  checked: { identityVerified: boolean; credentials: { kind: string; type: string; issuer: string; method: string; checkedAt: string; validUntil: string | null; expired: boolean }[] };
  approvals: { category_code: string; name: string; valid_until: string }[];
  verifiedHistory: { count: number; items: { month: string; category_name: string; city: string; quality: number; timeliness: number; communication: number }[] };
  contact: { email: string | null; phone: string | null; showEmail: boolean; showPhone: boolean };
  counts: { followers: number; following: number; posts: number };
  following: boolean; blockedByMe: boolean; proProfileId: string | null; requestableCategories: { code: string; name: string }[];
};

const day = (iso: string) => new Date(iso).toLocaleDateString('tr-TR');

function Section({ eyebrow, sub, children, tone }: { eyebrow: string; sub: string; children: React.ReactNode; tone?: string }) {
  return (
    <Card style={{ gap: 8 }}>
      <Eyebrow color={tone}>{eyebrow}</Eyebrow>
      <Text style={type(11, 400, { color: C.t3, lh: 1.4 })}>{sub}</Text>
      {children}
    </Card>
  );
}

/** Declared statement, checked documents, service approvals and platform-verified history are kept apart. */
export default function NetworkProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call, role, company } = useSession();
  const { showToast } = useUi();
  const q = useApi<Profile>(`/network/profiles/${id}`);
  const posts = useApi<{ posts: Post[] }>(q.data ? `/network/feed?scope=all&authorId=${id}` : null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const p = q.data;
  const run = async (path: string, ok: string) => { setError(null); try { await call('POST', path, {}); showToast(ok); await q.reload(); await posts.reload(); } catch (e) { setError(errorText(e)); } };
  const canRequest = !!company && (role === 'owner' || role === 'hq_manager' || role === 'site_manager');
  if (!p) {
    const noProfile = q.error?.includes('profilini oluştur');
    return (
      <Screen title="Profil" titleEn="Profile">
        {q.error ? <ErrorBox message={q.error} /> : <Loading />}
        {noProfile ? <PrimaryButton label="Profil oluştur" onPress={() => router.replace('/network/profile-edit')} /> : null}
      </Screen>
    );
  }
  const d = p.declared;
  return (
    <Screen title={d.displayName} titleEn="Network profile" onRefresh={q.reload} refreshing={q.loading}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Avatar userId={p.userId} has={p.hasPhoto} name={d.displayName} size={64} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={type(17, 700)}>{d.displayName}</Text>
          {d.title ? <Text style={type(13, 500, { color: C.t2 })}>{d.title}</Text> : null}
          <Text style={type(12, 400, { color: C.t3 })}>{d.city}{d.district ? ` / ${d.district}` : ''} · {p.counts.followers} takipçi · {p.counts.posts} paylaşım</Text>
        </View>
      </View>
      {p.status !== 'active' ? <Text style={type(12, 600, { color: C.crit })}>Profil askıya alındı.</Text> : null}
      <Text testID="net-profile-note" style={type(11.5, 500, { color: C.warn, lh: 1.45 })}>{p.note}</Text>

      {p.own ? (
        <GhostButton testID="net-edit-profile" label="Profili düzenle" onPress={() => router.push('/network/profile-edit')} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {!p.blockedByMe ? (p.following
            ? <GhostButton testID="net-unfollow" label="Takibi bırak" height={40} size={12.5} onPress={() => run(`/network/profiles/${p.userId}/unfollow`, 'Takip bırakıldı')} />
            : <PrimaryButton testID="net-follow" label="Takip et" glow={false} height={40} size={12.5} onPress={() => run(`/network/profiles/${p.userId}/follow`, 'Takip ediliyor')} />) : null}
          {p.blockedByMe
            ? <GhostButton testID="net-unblock" label="Engeli kaldır" height={40} size={12.5} onPress={() => run(`/network/profiles/${p.userId}/unblock`, 'Engel kaldırıldı')} />
            : <GhostButton testID="net-block" label="Engelle" height={40} size={12.5} color={C.crit} onPress={() => run(`/network/profiles/${p.userId}/block`, 'Engellendi; birbirinizin paylaşımlarını görmezsiniz')} />}
          <GhostButton testID="net-report-profile" label="Şikâyet et" height={40} size={12.5} onPress={() => setReport(r => !r)} />
        </View>
      )}
      {report ? <ReportBox targetType="profile" targetId={p.userId} onDone={() => setReport(false)} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      {!p.own && canRequest ? (
        <Card style={{ gap: 8 }} border={tint.lime(0.3)}>
          <Eyebrow>HİZMET TALEBİ</Eyebrow>
          {p.requestableCategories.length ? (
            <>
              <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>Bu uzmanın hizmet onayı olan kategorilerde talep açabilirsin. Formu açmak sipariş ya da ücretli işlem oluşturmaz; talep yalnız bu uzmana gider.</Text>
              <PrimaryButton testID="net-request-service" label="Hizmet talebi başlat" glow={false} height={44} size={13}
                onPress={() => router.push({ pathname: '/service/new', params: { providerId: p.proProfileId!, providerName: d.displayName, categories: p.requestableCategories.map(c => c.code).join(',') } })} />
            </>
          ) : (
            <Text testID="net-request-unavailable" style={type(12, 500, { color: C.t3, lh: 1.5 })}>Bu kişinin onaylı hizmet kategorisi yok; ağ üyeliği hizmet verme onayı sağlamaz, bu yüzden profilden talep açılamaz.</Text>
          )}
        </Card>
      ) : null}

      <Section eyebrow="KİŞİSEL BEYAN" sub="Kişinin kendi yazdığı bilgiler; platform kontrol etmedi.">
        {d.bio ? <Text style={type(13, 400, { lh: 1.55 })}>{d.bio}</Text> : null}
        {d.specialties.length ? <Text style={type(12.5, 500, { color: C.t2 })}>Uzmanlık: {d.specialties.join(', ')}</Text> : null}
        {d.categories.length ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {d.categories.map(c => <Pill key={c.code} label={`${c.name}${c.approved ? ' · ONAYLI' : ' · BEYAN'}`} fg={c.approved ? C.lime : C.t2} bg={c.approved ? tint.lime(0.12) : tint.white(0.06)} />)}
          </View>
        ) : null}
        {d.experience.map(x => (
          <View key={x.id} testID={`net-exp-${x.id}`} style={{ borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 7 }}>
            <Text style={type(13, 600)}>{x.role_title}{x.organization ? ` · ${x.organization}` : ''}</Text>
            <Text style={type(11.5, 400, { color: C.t3 })}>{x.start_year}–{x.end_year ?? 'devam'}{x.description ? ` · ${x.description}` : ''}</Text>
          </View>
        ))}
        {!d.bio && !d.specialties.length && !d.experience.length ? <Text style={type(12, 400, { color: C.t3 })}>Beyan yok.</Text> : null}
      </Section>

      <Section eyebrow="KONTROL EDİLMİŞ BELGELER" sub="Platform incelemecisinin kontrol ettiği kimlik ve yeterlilikler. Belge dosyaları ağda gösterilmez." tone={C.info}>
        <Text style={type(12.5, 500)}>Kimlik: {p.checked.identityVerified ? 'doğrulandı' : 'doğrulanmadı'}</Text>
        {p.checked.credentials.map((c, i) => (
          <Text key={i} style={type(12, 400, { color: c.expired ? C.warn : C.t2, lh: 1.45 })}>
            {credentialLabel(c.type)} · {c.issuer} · kontrol: {c.method}{c.validUntil ? ` · ${c.expired ? 'süresi doldu' : 'geçerlilik'} ${day(c.validUntil)}` : ''}
          </Text>
        ))}
        {!p.checked.credentials.length ? <Text style={type(12, 400, { color: C.t3 })}>Kontrol edilmiş yeterlilik yok.</Text> : null}
      </Section>

      <Section eyebrow="HİZMET ONAYI" sub="Teklif verebileceği kategoriler. Onay gerektiren kategoride onaysız kişi teklif veremez (sunucu kontrol eder)." tone={C.lime}>
        {p.approvals.map(a => <Text key={a.category_code} testID={`net-approval-${a.category_code}`} style={type(12.5, 500)}>{a.name} · {day(a.valid_until)} tarihine kadar</Text>)}
        {!p.approvals.length ? <Text testID="net-no-approval" style={type(12, 400, { color: C.t3 })}>Hizmet onayı yok.</Text> : null}
      </Section>

      <Section eyebrow="PLATFORMDA DOĞRULANMIŞ HİZMET GEÇMİŞİ" sub="Platform üzerinden tamamlanıp işletmenin kabul ettiği işler (işletme adı gösterilmez).">
        {p.verifiedHistory.items.map((h, i) => <Text key={i} style={type(12, 400, { color: C.t2 })}>{h.month} · {h.category_name} · {h.city} · kalite {h.quality}/5</Text>)}
        {!p.verifiedHistory.count ? <Text style={type(12, 400, { color: C.t3 })}>Henüz doğrulanmış hizmet yok.</Text> : null}
      </Section>

      <Section eyebrow="İLETİŞİM" sub={p.own ? 'Sen açmadıkça diğer ağ kullanıcıları görmez.' : 'Yalnız kişinin açtığı bilgiler görünür.'}>
        <Text style={type(12.5, 400, { color: C.t2 })}>E-posta: {p.contact.email ?? 'gizli'}{p.own ? (p.contact.showEmail ? ' · ağa açık' : ' · ağa kapalı') : ''}</Text>
        <Text style={type(12.5, 400, { color: C.t2 })}>Telefon: {p.contact.phone ?? 'gizli'}{p.own ? (p.contact.showPhone ? ' · ağa açık' : ' · ağa kapalı') : ''}</Text>
      </Section>

      <Text style={type(12.5, 600)}>Paylaşımlar</Text>
      {(posts.data?.posts ?? []).map(x => <PostCard key={x.id} p={x} />)}
      {posts.data && !posts.data.posts.length ? <Text style={type(12, 400, { color: C.t3 })}>Paylaşım yok.</Text> : null}
      {p.own ? <Tap onPress={() => router.push('/network/compose')}><Text style={type(12.5, 600, { color: C.lime })}>Yeni paylaşım yap ›</Text></Tap> : null}
    </Screen>
  );
}
