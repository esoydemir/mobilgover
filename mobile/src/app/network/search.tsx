import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../../api/useApi';
import { Screen } from '../../components/Screen';
import { Empty, ErrorBox, Field, Loading } from '../../components/states';
import { FilterChip, Pill, Tap } from '../../components/ui';
import { Avatar } from '../../features/network';
import { C, tint, type } from '../../theme';

type Result = { userId: string; displayName: string; title: string; city: string; district: string | null; specialties: string[]; hasPhoto: boolean;
  approvedCategories: string[]; verifiedJobs: number; followers: number; reasons: string[] };
type Category = { code: string; name: string };

/** Search by specialty, category, region and approval. Ranking is explained; it is not driven by follower count. */
export default function NetworkSearchRoute() {
  const me = useApi<{ specialties: string[] }>('/network/me');
  const cats = useApi<Category[]>('/service-categories');
  const [text, setText] = useState('');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [approved, setApproved] = useState(false);
  const qs = new URLSearchParams();
  if (text.trim()) qs.set('text', text.trim());
  if (specialty) qs.set('specialty', specialty);
  if (category) qs.set('category', category);
  if (city.trim()) qs.set('city', city.trim());
  if (approved) qs.set('approvedOnly', '1');
  const res = useApi<{ rankingNote: string; results: Result[] }>(`/network/search?${qs.toString()}`);
  const catName = (c: string) => cats.data?.find(x => x.code === c)?.name ?? c;
  return (
    <Screen title="Uzman ara" titleEn="Find experts" gap={10}>
      <Field label="Ad, unvan ya da uzmanlık" testID="net-q" value={text} onChangeText={setText} />
      <Field label="Bölge (il)" testID="net-q-city" value={city} onChangeText={setCity} />
      <Text style={type(12, 600)}>Uzmanlık</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(me.data?.specialties ?? []).map(s => <FilterChip key={s} testID={`net-q-spec-${s}`} label={s} px={11} active={specialty === s} onPress={() => setSpecialty(specialty === s ? null : s)} />)}
      </View>
      <Text style={type(12, 600)}>Hizmet kategorisi</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(cats.data ?? []).map(c => <FilterChip key={c.code} testID={`net-q-cat-${c.code}`} label={c.name} px={11} active={category === c.code} onPress={() => setCategory(category === c.code ? null : c.code)} />)}
      </View>
      <FilterChip testID="net-q-approved" label={category ? 'Yalnız bu kategoride hizmet onayı olanlar' : 'Yalnız hizmet onayı olanlar'} active={approved} onPress={() => setApproved(a => !a)} />
      {res.data ? <Text testID="net-ranking-note" style={type(11, 400, { color: C.t3, lh: 1.45 })}>{res.data.rankingNote}</Text> : null}
      {res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : null}
      {!res.data && res.loading ? <Loading /> : null}
      {res.data?.results.length === 0 ? <Empty title="Eşleşen profil yok" body="Filtreleri gevşetmeyi dene." /> : null}
      {(res.data?.results ?? []).map(r => (
        <Tap key={r.userId} testID={`net-result-${r.userId}`} onPress={() => router.push(`/network/p/${r.userId}`)}
          style={{ borderWidth: 1, borderColor: C.bd, borderRadius: 20, backgroundColor: C.card, padding: 13, gap: 7 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Avatar userId={r.userId} has={r.hasPhoto} name={r.displayName} />
            <View style={{ flex: 1 }}>
              <Text style={type(14, 600)}>{r.displayName}</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>{r.title ? `${r.title} · ` : ''}{r.city}{r.district ? ` / ${r.district}` : ''}</Text>
            </View>
          </View>
          {r.specialties.length ? <Text style={type(12, 400, { color: C.t2 })}>Uzmanlık (beyan): {r.specialties.join(', ')}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {r.approvedCategories.length
              ? r.approvedCategories.map(c => <Pill key={c} label={`ONAYLI · ${catName(c)}`} fg={C.lime} bg={tint.lime(0.12)} />)
              : <Pill label="HİZMET ONAYI YOK" fg={C.t3} bg={tint.white(0.06)} />}
            {r.verifiedJobs ? <Pill label={`${r.verifiedJobs} DOĞRULANMIŞ HİZMET`} fg={C.info} bg={tint.info(0.12)} /> : null}
          </View>
          {r.reasons.length ? <Text style={type(11, 400, { color: C.t3 })}>Neden üstte: {r.reasons.join(' · ')}</Text> : null}
        </Tap>
      ))}
    </Screen>
  );
}
