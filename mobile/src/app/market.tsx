import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, ExampleBadge, Loading } from '../components/states';
import { Card, Chevron, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, Tap, Tile } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { PostCard, type Post } from '../features/network';
import { C, tint, type } from '../theme';
import { reqStatus } from './services';

type Category = { code: string; name: string; description: string; is_example: boolean };
type Provider = { id: string; display_name: string; headline: string; city: string; district: string | null; verified_credentials: number };
type Req = { id: string; title: string; category_name: string; status: string; open_quotes: number; acceptable_quotes: number; job_status: string | null; created_at: string };
type Section = 'experts' | 'quotes' | 'feed';

/**
 * Pazar: the three marketplace sections (Uzmanlar · Servisler ve Teklifler · Profesyonel Akış) in one place, separate from the "Servis bul" shortcuts that open from a task,
 * a nonconformity or a document.
 *  - Uzmanlar / Servisler: approved providers by service category (organic order, no paid placement)
 *  - Teklifler: this business's service requests and the quotes waiting for comparison
 *  - Profesyonel akış: the professional network (posts, search)
 * Prices, distances and arrival times are NOT shown for providers: they exist only inside a real quote.
 */
export default function MarketRoute() {
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(params.section === 'quotes' || params.section === 'feed' ? params.section : 'experts');
  const { company } = useSession();
  const reqs = useApi<Req[]>(company ? `/companies/${company.id}/service-requests` : null);
  const waiting = (reqs.data ?? []).filter(r => r.status === 'open' && r.acceptable_quotes > 0).length;

  return (
    <Screen title="Pazar" titleEn="Marketplace" gap={12} onRefresh={() => void reqs.reload()} refreshing={reqs.loading}>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        <FilterChip testID="market-tab-experts" label="Uzmanlar" px={12} active={section === 'experts'} onPress={() => setSection('experts')} />
        <FilterChip testID="market-tab-quotes" label={`Servisler ve Teklifler${reqs.data ? ` ${reqs.data.length}` : ''}`} px={12} active={section === 'quotes'} onPress={() => setSection('quotes')} />
        <FilterChip testID="market-tab-feed" label="Profesyonel Akış" px={12} active={section === 'feed'} onPress={() => setSection('feed')} />
      </View>
      {waiting > 0 && section !== 'quotes' ? (
        <Tap testID="market-waiting" onPress={() => setSection('quotes')} style={{ borderWidth: 1, borderColor: tint.lime(0.3), backgroundColor: tint.lime(0.05), borderRadius: 18, padding: 13 }}>
          <Text style={type(12.5, 600, { color: C.lime })}>{waiting} talepte teklif karşılaştırmayı bekliyor →</Text>
        </Tap>
      ) : null}
      {section === 'experts' ? <Experts /> : section === 'quotes' ? <Quotes reqs={reqs} /> : <Feed />}
    </Screen>
  );
}

function Experts() {
  const { company } = useSession();
  const cats = useApi<Category[]>('/service-categories');
  const [cat, setCat] = useState<string | null>(null);
  const providers = useApi<Provider[]>(company && cat ? `/companies/${company.id}/providers?category=${cat}` : null);
  const current = cats.data?.find(c => c.code === cat);
  return (
    <>
      <Text style={type(12, 500, { color: C.t2, lh: 1.5 })}>Neye ihtiyacın var? Bir hizmet türü seç; o türde geçerli onayı olan uzmanlar listelenir. Meslek adı bilmen gerekmez.</Text>
      {cats.error ? <ErrorBox message={cats.error} onRetry={cats.reload} /> : null}
      {!cats.data && cats.loading ? <Loading /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {(cats.data ?? []).map(c => <FilterChip key={c.code} testID={`market-cat-${c.code}`} label={c.name} px={12} active={cat === c.code} onPress={() => setCat(c.code)} />)}
      </View>
      {current ? (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Eyebrow>{current.name.toUpperCase()}</Eyebrow>
            {current.is_example ? <ExampleBadge /> : null}
          </View>
          <Text style={type(12, 400, { color: C.t2, lh: 1.5 })}>{current.description}</Text>
          <PrimaryButton testID="market-request-open" label="Herkese açık talep aç" height={44} size={13.5} onPress={() => router.push(`/service/new?category=${current.code}` as Href)} />
        </Card>
      ) : <Empty title="Bir hizmet türü seç" body="Seçince o kategoride onaylı uzmanlar burada sıralanır." />}
      {cat && providers.error ? <ErrorBox message={providers.error} onRetry={providers.reload} /> : null}
      {cat && !providers.data && providers.loading ? <Loading /> : null}
      {cat && providers.data?.length === 0 ? <Empty title="Bu kategoride henüz onaylı uzman yok" body="Talep yine de açılabilir; onaylı bir uzman çıkınca bildirim alır." /> : null}
      {(providers.data ?? []).map(p => (
        <View key={p.id} testID={`market-provider-${p.id}`} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 16, backgroundColor: C.card, padding: 15, gap: 9 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Tile size={44} fontSize={15} initials>{p.display_name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</Tile>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type(14.5, 600, { ls: -0.01 })}>{p.display_name}</Text>
              <Text style={[type(12, 400, { color: C.t2, lh: 1.4 }), { marginTop: 2 }]}>{p.headline}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            <Pill label={p.verified_credentials > 0 ? `${p.verified_credentials} DOĞRULANMIŞ YETERLİLİK` : 'YETERLİLİK DOĞRULAMASI YOK'} fg={p.verified_credentials > 0 ? C.lime : C.warn} bg={p.verified_credentials > 0 ? tint.lime(0.14) : tint.warn(0.14)} />
            <Pill label={`${p.city}${p.district ? ` · ${p.district}` : ''}`.toUpperCase()} fg={C.t2} bg={C.chip} />
          </View>
          <GhostButton testID={`market-profile-${p.id}`} label="Profili aç" height={40} size={12.5} onPress={() => router.push(`/pro?view=${p.id}` as Href)} />
          <GhostButton testID={`market-ask-${p.id}`} label="Bu uzmandan teklif iste" height={40} size={12.5} color={C.lime} border={tint.lime(0.35)}
            onPress={() => router.push({ pathname: '/service/new', params: { providerId: p.id, providerName: p.display_name, categories: cat!, category: cat! } })} />
        </View>
      ))}
      <Text style={type(11, 400, { color: C.t3, lh: 1.5 })}>Sıralama: doğrulanmış yeterlilik sayısı, sonra ad. Ücretli öne çıkarma yoktur. Fiyat, mesafe ve geliş zamanı uzmanlar için gösterilmez; yalnız gerçek teklifte yazar.</Text>
    </>
  );
}

function Quotes({ reqs }: { reqs: ReturnType<typeof useApi<Req[]>> }) {
  return (
    <>
      <PrimaryButton testID="market-new-request" label="Yeni hizmet talebi" onPress={() => router.push('/service/new')} />
      {reqs.data ? (
        <View testID="market-summary" style={{ flexDirection: 'row', gap: 8 }}>
          {([['Açık talep', reqs.data.filter(r => r.status === 'open').length], ['Karşılaştır', reqs.data.filter(r => r.status === 'open' && r.acceptable_quotes > 0).length], ['İş verildi', reqs.data.filter(r => r.status === 'awarded').length], ['Tamamlanan', reqs.data.filter(r => r.status === 'completed').length]] as const).map(([l, n]) => (
            <View key={l} style={{ flex: 1, borderWidth: 1, borderColor: C.bd, borderRadius: 16, backgroundColor: C.card, padding: 10, gap: 3 }}>
              <Text style={type(9, 700, { ls: 0.06, color: C.t3 })}>{String(l).toUpperCase()}</Text>
              <Text style={type(20, 600, { ls: -0.03 })}>{n}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {reqs.error ? <ErrorBox message={reqs.error} onRetry={reqs.reload} /> : null}
      {!reqs.data && reqs.loading ? <Loading /> : null}
      {reqs.data?.length === 0 ? <Empty title="Henüz talep yok" body="Bir uzmandan teklif istediğinde talepler ve gelen teklifler burada toplanır." /> : null}
      {(reqs.data ?? []).map(r => (
        <Tap key={r.id} testID={`market-req-${r.id}`} onPress={() => router.push(`/service/${r.id}`)} style={{ borderWidth: 1, borderColor: r.status === 'open' && r.acceptable_quotes > 0 ? tint.lime(0.3) : C.bd, borderRadius: 16, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill label={reqStatus(r.status, r.acceptable_quotes, r.open_quotes)[0]} fg={reqStatus(r.status, r.acceptable_quotes, r.open_quotes)[1]} bg={reqStatus(r.status, r.acceptable_quotes, r.open_quotes)[2]} />
            <Text style={type(11, 500, { color: C.t3 })}>{r.category_name}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{r.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: r.status === 'open' && r.acceptable_quotes > 0 ? C.lime : C.t3 })}>
            {fmtDateTime(r.created_at)} · {r.open_quotes} teklif{r.status === 'open' && r.acceptable_quotes > 0 ? ' · karşılaştır' : ''}{r.job_status ? ` · iş: ${r.job_status}` : ''}
          </Text>
        </Tap>
      ))}
    </>
  );
}

function Feed() {
  const me = useApi<{ hasProfile: boolean; note: string }>('/network/me');
  const [scope, setScope] = useState<'all' | 'following'>('all');
  const feed = useApi<{ label: string; posts: Post[] }>(me.data?.hasProfile ? `/network/feed?scope=${scope}` : null);
  return (
    <>
      {me.error ? <ErrorBox message={me.error} onRetry={me.reload} /> : null}
      {!me.data && me.loading ? <Loading /> : null}
      {me.data && !me.data.hasProfile ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>PROFİLİNİ OLUŞTUR</Eyebrow>
          <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Profesyonel akış, profil oluşturmuş kullanıcılara açıktır. {me.data.note}</Text>
          <PrimaryButton testID="market-feed-profile" label="Profil oluştur" height={44} size={13.5} onPress={() => router.push('/network/profile-edit')} />
        </Card>
      ) : null}
      {me.data?.hasProfile ? (
        <>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            <FilterChip testID="market-feed-all" label="Tümü" active={scope === 'all'} onPress={() => setScope('all')} />
            <FilterChip testID="market-feed-following" label="Takip ettiklerim" active={scope === 'following'} onPress={() => setScope('following')} />
            <GhostButton testID="market-feed-compose" label="Paylaş" height={34} size={12} onPress={() => router.push('/network/compose')} />
            <GhostButton testID="market-feed-search" label="Uzman ara" height={34} size={12} onPress={() => router.push('/network/search')} />
          </View>
          {feed.error ? <ErrorBox message={feed.error} onRetry={feed.reload} /> : null}
          {!feed.data && feed.loading ? <Loading /> : null}
          {feed.data?.posts.length === 0 ? <Empty title="Bu akışta paylaşım yok" body={scope === 'following' ? 'Takip ettiğin kimse henüz paylaşım yapmadı.' : 'İlk paylaşımı sen yapabilirsin.'} /> : null}
          {(feed.data?.posts ?? []).map(p => <PostCard key={p.id} p={p} />)}
        </>
      ) : null}
      <Text style={type(11, 400, { color: C.t3, lh: 1.5 })}>Kullanıcı içeriğidir; doğrulanmış mevzuat ya da onaylı tavsiye değildir. Gönderiye dokununca tam içerik, yorumlar ve paylaşanın profili açılır.</Text>
    </>
  );
}
