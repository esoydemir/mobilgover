import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, Tap, Tile } from '../components/ui';
import { POSTS } from '../data';
import { useApp } from '../state/app';
import { C, tint, type } from '../theme';

/** Expert content: verified regulation content is visually separate from opinion. */
export default function FeedRoute() {
  const { showToast } = useApp();
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  return (
    <Screen title="İçerik" titleEn="Professional feed">
      {POSTS.map(p => {
        const isFollowing = !!following[p.name];
        const isLiked = !!liked[p.name];
        return (
          <Card key={p.name} style={{ paddingVertical: 16, paddingHorizontal: 17 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <Tile size={36} fontSize={13} initials>{p.initials}</Tile>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type(13.5, 600, { ls: -0.01 })}>{p.name}</Text>
                <Text style={[type(11, 400, { color: C.t3 }), { marginTop: 2 }]}>{p.role}</Text>
              </View>
              <Tap
                onPress={() => { setFollowing(f => ({ ...f, [p.name]: !isFollowing })); if (!isFollowing) showToast('Takip ediliyor', p.name); }}
                style={{ height: 32, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', borderWidth: 1, borderColor: isFollowing ? tint.lime(0.4) : C.bds, backgroundColor: isFollowing ? tint.lime(0.1) : 'transparent' }}
              >
                <Text style={type(12, 600, { color: isFollowing ? C.lime : C.t1 })}>{isFollowing ? 'Takiptesin' : 'Takip et'}</Text>
              </Tap>
            </View>
            {p.verified && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, alignSelf: 'flex-start', borderWidth: 1, borderColor: tint.lime(0.28), backgroundColor: tint.lime(0.05), borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 }}>
                <View style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={type(9, 800, { color: C.ink })}>✓</Text>
                </View>
                <Text style={type(10, 700, { ls: 0.08, color: C.lime })}>GOVERHUB ONAYLI İÇERİK</Text>
              </View>
            )}
            <Text style={[type(14, 400, { lh: 1.5 }), { marginTop: 13 }]}>{p.text}</Text>
            {p.unverified && (
              <Text style={[type(11.5, 400, { lh: 1.45, color: C.t3 }), { marginTop: 10, borderLeftWidth: 1, borderLeftColor: C.bds, paddingLeft: 11 }]}>
                Bu yorum uzman görüşüdür, GoverHub tarafından doğrulanmış mevzuat bilgisi değildir.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 15, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.bd }}>
              <Tap onPress={() => setLiked(l => ({ ...l, [p.name]: !isLiked }))}>
                <Text style={type(12, 600, { color: isLiked ? C.lime : C.t3 })}>♥ {p.likes + (isLiked ? 1 : 0)}</Text>
              </Tap>
              <Text style={type(12, 500, { color: C.t3 })}>Yorum {p.comments}</Text>
              <Tap onPress={() => showToast('Kaydedildi', 'Kayıtlı içeriklerde')} style={{ marginLeft: 'auto' }}>
                <Text style={type(12, 500, { color: C.t3 })}>Kaydet</Text>
              </Tap>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
