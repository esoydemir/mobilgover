import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, Loading } from '../components/states';
import { Card, Eyebrow, FilterChip, GhostButton, PrimaryButton } from '../components/ui';
import { PostCard, type Post } from '../features/network';
import { C, type } from '../theme';

type Me = { hasProfile: boolean; moderator: boolean; note: string };

/** Professional network: posts from signed-in network users. User content, not legislation or approved advice. */
export default function NetworkRoute() {
  const { me: session } = useSession();
  const me = useApi<Me>('/network/me');
  const [scope, setScope] = useState<'all' | 'following' | 'mine'>('all');
  const feed = useApi<{ label: string; posts: Post[] }>(me.data?.hasProfile ? `/network/feed?scope=${scope}` : null);
  return (
    <Screen title="Mesleki ağ" titleEn="Network" gap={11} onRefresh={() => { void me.reload(); void feed.reload(); }} refreshing={feed.loading}>
      {me.error ? <ErrorBox message={me.error} onRetry={me.reload} /> : null}
      {!me.data ? <Loading /> : !me.data.hasProfile ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>PROFİLİNİ OLUŞTUR</Eyebrow>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Mesleki ağ, giriş yapmış ve profil oluşturmuş kullanıcılara açıktır. {me.data.note} E-posta ve telefonun sen açmadıkça görünmez; belge dosyaların ağda hiç gösterilmez.</Text>
          <PrimaryButton testID="net-create-profile" label="Profil oluştur" onPress={() => router.push('/network/profile-edit')} />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            <GhostButton testID="net-my-profile" label="Profilim" height={38} size={12} onPress={() => router.push(`/network/p/${session!.userId}`)} />
            <GhostButton testID="net-search" label="Uzman ara" height={38} size={12} onPress={() => router.push('/network/search')} />
            <GhostButton testID="net-compose" label="Paylaş" height={38} size={12} onPress={() => router.push('/network/compose')} />
            {me.data.moderator ? <GhostButton testID="net-moderation" label="Moderasyon" height={38} size={12} onPress={() => router.push('/moderation')} /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {([['all', 'Tümü'], ['following', 'Takip ettiklerim'], ['mine', 'Benimkiler']] as const).map(([k, l]) =>
              <FilterChip key={k} testID={`net-tab-${k}`} label={l} active={scope === k} onPress={() => setScope(k)} />)}
          </View>
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.45 })}>Paylaşımlar kullanıcı içeriğidir; doğrulanmış mevzuat ya da platform onaylı içerik değildir. İşletme kayıtların otomatik paylaşılmaz.</Text>
          {feed.error ? <ErrorBox message={feed.error} onRetry={feed.reload} /> : null}
          {!feed.data && feed.loading ? <Loading /> : null}
          {feed.data?.posts.length === 0 ? <Empty title={scope === 'following' ? 'Takip ettiğin kişilerin paylaşımı yok' : 'Henüz paylaşım yok'} /> : null}
          {(feed.data?.posts ?? []).map(p => <PostCard key={p.id} p={p} />)}
        </>
      )}
    </Screen>
  );
}
