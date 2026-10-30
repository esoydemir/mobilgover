import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { VerifiedBadge } from '../components/Icons';
import { Screen } from '../components/Screen';
import { Card, Eyebrow, Tap, Tile } from '../components/ui';
import { PROS, PRO_QUERIES } from '../data';
import { C, tint, type } from '../theme';

/** Plain-language need → matching verified providers. */
export default function ExpertsRoute() {
  const [query, setQuery] = useState(PRO_QUERIES[0]);
  return (
    <Screen title="Uzman bul" titleEn="Find an expert">
      <Card border={C.bds} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
        <Eyebrow>NEYE İHTİYACIN VAR?</Eyebrow>
        <Text style={[type(16, 600, { ls: -0.015 }), { marginTop: 10 }]}>"{query}"</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
          {PRO_QUERIES.map(q => (
            <Tap key={q} onPress={() => setQuery(q)} style={{ height: 31, paddingHorizontal: 13, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: C.bd, backgroundColor: C.tile }}>
              <Text style={type(12, 500, { color: C.t2 })}>{q}</Text>
            </Tap>
          ))}
        </View>
      </Card>
      <View style={{ borderWidth: 1, borderColor: tint.lime(0.22), borderRadius: 18, backgroundColor: tint.lime(0.04), paddingVertical: 13, paddingHorizontal: 15 }}>
        <Text style={type(12.5, 400, { lh: 1.5, color: C.t2 })}>
          Meslek adı bilmene gerek yok. GoverHub sorunu <Text style={type(12.5, 600, { color: C.lime })}>soğutma teknik servisi</Text> ihtiyacına çevirdi ve işletmene uygun 3 sağlayıcı buldu.
        </Text>
      </View>
      {PROS.map(p => (
        <Tap key={p.id} onPress={() => router.push(`/pro/${p.id}`)} style={{ flexDirection: 'row', gap: 13, borderWidth: 1, borderColor: C.bd, borderRadius: 26, backgroundColor: C.card, padding: 16 }}>
          <Tile size={46} radius={14} initials>{p.initials}</Tile>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[type(14.5, 600, { ls: -0.01 }), { flexShrink: 1 }]}>{p.name}</Text>
              <VerifiedBadge color={p.verified ? C.lime : 'rgba(245,245,242,0.18)'} />
            </View>
            <Text style={[type(12, 400, { color: C.t2 }), { marginTop: 3 }]}>{p.role}</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <Text style={type(11.5, 600, { color: C.lime })}>★ {p.rating}</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>{p.jobs} iş</Text>
              <Text style={type(11.5, 400, { color: C.t3 })}>{p.dist}</Text>
            </View>
          </View>
          <View style={{ alignSelf: 'center', alignItems: 'flex-end' }}>
            <Text style={type(15, 600, { family: 'outfit' })}>{p.price}</Text>
            <Text style={[type(10.5, 400, { color: C.t3 }), { marginTop: 2 }]}>{p.eta}</Text>
          </View>
        </Tap>
      ))}
      <Text style={[type(11.5, 400, { lh: 1.5, color: C.t3 }), { paddingVertical: 2, paddingHorizontal: 4 }]}>
        Sıralama; sorun uyumu, doğrulanmış yetkinlik, mesafe, yanıt hızı ve tamamlanan iş sayısına göre. Sponsorlu içerik ayrıca etiketlenir.
      </Text>
    </Screen>
  );
}
