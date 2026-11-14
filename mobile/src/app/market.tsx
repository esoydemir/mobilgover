import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { Screen } from '../components/Screen';
import { Empty, ErrorBox, ExampleBadge, Loading } from '../components/states';
import { Card, Chevron, Eyebrow, FilterChip, GhostButton, Pill, PrimaryButton, Tap, Tile } from '../components/ui';
import { fmtDateTime } from '../features/dates';
import { C, tint, type } from '../theme';
import { REQ_STATUS } from './services';

type Category = { code: string; name: string; description: string; is_example: boolean };
type Provider = { id: string; display_name: string; headline: string; city: string; district: string | null; verified_credentials: number };
type Req = { id: string; title: string; category_name: string; status: string; open_quotes: number; job_status: string | null; created_at: string };
type Section = 'experts' | 'quotes' | 'feed';

/**
 * Pazar: the three marketplace sections in one place, separate from the "Servis bul" shortcuts that open from a task,
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
  const waiting = (reqs.data ?? []).filter(r => r.status === 'open' && r.open_quotes > 0).length;

  return (
    <Screen title="Pazar" titleEn="Marketplace" gap={12} onRefresh={() => void reqs.reload()} refreshing={reqs.loading}>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        <FilterChip testID="market-tab-experts" label="Uzmanlar / Servisler" px={12} active={section === 'experts'} onPress={() => setSection('experts')} />
        <FilterChip testID="market-tab-quotes" label={`Teklifler${reqs.data ? ` ${reqs.data.length}` : ''}`} px={12} active={section === 'quotes'} onPress={() => setSection('quotes')} />
        <FilterChip testID="market-tab-feed" label="Profesyonel akış" px={12} active={section === 'feed'} onPress={() => setSection('feed')} />
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
        <View key={p.id} testID={`market-provider-${p.id}`} style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 9 }}>
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
      {reqs.error ? <ErrorBox message={reqs.error} onRetry={reqs.reload} /> : null}
      {!reqs.data && reqs.loading ? <Loading /> : null}
      {reqs.data?.length === 0 ? <Empty title="Henüz talep yok" body="Bir uzmandan teklif istediğinde talepler ve gelen teklifler burada toplanır." /> : null}
      {(reqs.data ?? []).map(r => (
        <Tap key={r.id} testID={`market-req-${r.id}`} onPress={() => router.push(`/service/${r.id}`)} style={{ borderWidth: 1, borderColor: r.status === 'open' && r.open_quotes > 0 ? tint.lime(0.3) : C.bd, borderRadius: 22, backgroundColor: C.card, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill label={REQ_STATUS[r.status]![0]} fg={REQ_STATUS[r.status]![1]} bg={REQ_STATUS[r.status]![2]} />
            <Text style={type(11, 500, { color: C.t3 })}>{r.category_name}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={[type(14, 600), { flex: 1 }]}>{r.title}</Text>
            <Chevron />
          </View>
          <Text style={type(11.5, 400, { color: r.status === 'open' && r.open_quotes > 0 ? C.lime : C.t3 })}>
            {fmtDateTime(r.created_at)} · {r.open_quotes} teklif{r.status === 'open' && r.open_quotes > 0 ? ' · karşılaştır' : ''}{r.job_status ? ` · iş: ${r.job_status}` : ''}
          </Text>
        </Tap>
      ))}
    </>
  );
}

function Feed() {
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>PROFESYONEL AKIŞ</Eyebrow>
      <Text style={type(12.5, 400, { color: C.t2, lh: 1.5 })}>Doğrulanmış mesleki profillerden paylaşımlar, vaka paylaşımları ve uzman arama. Kullanıcı içeriğidir; doğrulanmış mevzuat ya da onaylı tavsiye değildir.</Text>
      <PrimaryButton testID="market-feed-open" label="Akışı aç" height={44} size={13.5} onPress={() => router.push('/network')} />
      <GhostButton testID="market-feed-search" label="Uzman ara" height={44} size={13.5} onPress={() => router.push('/network/search')} />
    </Card>
  );
}
