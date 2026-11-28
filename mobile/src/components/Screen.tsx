import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueue } from '../api/queue';
import { useSession } from '../api/session';
import { goBack } from '../state/app';
import { C, glass, tint, type } from '../theme';
import { useApi } from '../api/useApi';
import { BackIcon, BellIcon } from './Icons';
import { Tap } from './ui';

/** Bottom padding that keeps content clear of the floating tab bar. */
export const TAB_CLEARANCE = 108;

type Props = {
  children: ReactNode;
  /** Sub-screen title (Turkish) and its English sublabel. Omit for the brand header. */
  title?: string;
  titleEn?: string;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Site of the record shown (task, case). Sub-screens always say which business, and this site, the person is looking at. */
  siteId?: string | null;
};

export function Screen({ children, title, titleEn, gap = 12, contentStyle, onRefresh, refreshing = false, siteId }: Props) {
  const insets = useSafeAreaInsets();
  // The glass header floats over the content, so the content starts below its measured height and scrolls under it.
  const [head, setHead] = useState(insets.top + 68);
  // A focused field or a scrolled-to control must never end up behind the header or the tab bar.
  const scrollPad = Platform.OS === 'web' ? ({ scrollPaddingTop: head + 8, scrollPaddingBottom: TAB_CLEARANCE } as unknown as ViewStyle) : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={[{ flex: 1 }, scrollPad]}
        contentContainerStyle={[{ paddingTop: head + 10, paddingHorizontal: 16, paddingBottom: TAB_CLEARANCE + insets.bottom, gap }, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.lime} progressViewOffset={head} /> : undefined}
      >
        {children}
      </ScrollView>
      <View onLayout={e => setHead(Math.round(e.nativeEvent.layout.height))}
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8, borderBottomWidth: 1, borderBottomColor: C.bd, zIndex: 5 }, glass]}>
        {title === undefined ? <BrandHeader /> : <SubHeader title={title} titleEn={titleEn} siteId={siteId} />}
      </View>
    </View>
  );
}

/** Demo and pilot data must never look alike. */
export function EnvBadge() {
  const { env } = useSession();
  if (!env) return null;
  const demo = env.mode === 'demo';
  return (
    <View accessibilityLabel={demo ? 'Demo ortamı: örnek veri' : 'Pilot ortamı'} style={{ alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: demo ? tint.warn(0.45) : tint.info(0.45) }}>
      <Text numberOfLines={1} style={type(11, 700, { color: demo ? C.warn : C.info })}>{demo ? 'DEMO · ÖRNEK VERİ' : 'PİLOT'}</Text>
    </View>
  );
}

/** Shows how many records are still only on this device. */
export function SyncChip() {
  const { ops, online, syncing } = useQueue();
  const waiting = ops.length;
  const problem = ops.some(o => o.status === 'failed' || o.status === 'conflict');
  const label = problem ? `${waiting} kayıt sorunlu` : waiting ? `${waiting} kayıt cihazda` : online === false ? 'Çevrimdışı' : syncing ? 'Eşitleniyor' : 'Eşitlendi';
  const color = problem ? C.crit : waiting || online === false ? C.warn : C.lime;
  // Words only when there is something to know; when everything is saved a dot is enough (the label stays for screen readers).
  const quiet = !problem && !waiting && online !== false && !syncing;
  const narrow = useWindowDimensions().width < 360;
  return (
    <Tap accessibilityLabel={`Eşitleme durumu: ${label}`} onPress={() => router.push('/sync')}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, minWidth: quiet ? 28 : 44, paddingHorizontal: quiet ? 0 : 10 }}>
      <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: color }} />
      {quiet || (narrow && !problem && !waiting) ? null : <Text style={type(12, 700, { color: problem ? C.crit : C.warn })}>{narrow && waiting ? String(waiting) : label}</Text>}
    </Tap>
  );
}

function BrandHeader() {
  const { company, siteId, sites } = useSession();
  const siteName = sites.find(s => s.id === siteId)?.name;
  const full = company ? `${company.name}${siteName ? ` · ${siteName}` : ''}` : 'GoverHub';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, paddingHorizontal: 16, paddingBottom: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent }}>
        <Text style={type(18, 800, { color: C.ink })}>G</Text>
      </View>
      {/* The whole business and site name stays reachable on a narrow phone: two lines, then the site line; tap = switch site / account. */}
      <Tap testID="header-context" accessibilityLabel={full} onPress={() => router.push('/more')} style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
        <Text numberOfLines={2} style={type(16, 700, { ls: -0.015, lh: 1.2 })}>{company?.name ?? 'GoverHub'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1, flexWrap: 'wrap' }}>
          {siteName ? <Text testID="header-site" numberOfLines={1} style={[type(13, 600, { color: C.t2 }), { flexShrink: 1 }]}>{siteName}{sites.length > 1 ? ' ▾' : ''}</Text> : null}
          <EnvBadge />
        </View>
      </Tap>
      <SyncChip />
      {company ? <NotificationBell companyId={company.id} /> : null}
    </View>
  );
}

/** Bell with the unread count (in-app notifications). */
function NotificationBell({ companyId }: { companyId: string }) {
  const q = useApi<{ unread: number }>(`/companies/${companyId}/notifications`);
  useFocusEffect(useCallback(() => { void q.reload(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  // A new quote, report or assignment must reach the person who keeps this screen open: refresh on a timer and
  // whenever the app/tab comes back to the foreground.
  useEffect(() => {
    const again = () => { void q.reload(); };
    const timer = setInterval(again, 20_000);
    const doc = (globalThis as { document?: Document }).document;
    const win = globalThis as { addEventListener?: (n: string, f: () => void) => void; removeEventListener?: (n: string, f: () => void) => void };
    const onVisible = () => { if (!doc || doc.visibilityState === 'visible') again(); };
    doc?.addEventListener('visibilitychange', onVisible);
    win.addEventListener?.('focus', again);
    return () => { clearInterval(timer); doc?.removeEventListener('visibilitychange', onVisible); win.removeEventListener?.('focus', again); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const unread = q.data?.unread ?? 0;
  return (
    <Tap testID="home-bell" accessibilityLabel={unread ? `${unread} okunmamış bildirim` : 'Bildirimler'} onPress={() => router.push('/notifications')}
      style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.bd, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
      <BellIcon size={19} color={unread ? C.t1 : C.t2} />
      {unread ? (
        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 19, height: 19, borderRadius: 999, paddingHorizontal: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(11, 800, { color: C.ink })}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Tap>
  );
}

function SubHeader({ title, titleEn, siteId }: { title: string; titleEn?: string; siteId?: string | null }) {
  const { company } = useSession();
  const siteName = siteId ? company?.sites.find(s => s.id === siteId)?.name : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, paddingHorizontal: 16, paddingBottom: 10 }}>
      <Tap accessibilityLabel="Geri" onPress={goBack} style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: C.bd, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
        <BackIcon />
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(17, 700, { ls: -0.015 })}>{title}</Text>
        {/* B-16: Türkçe ekranda İngilizce alt başlık gösterilmez (titleEn yalnızca geriye uyumluluk için kabul edilir). */}
        {/* İşletme ve şube ayrı satırlarda: uzun işletme adı şube adını kesmesin. */}
        {company ? (
          <View testID="subheader-context" style={{ marginTop: 1 }}>
            <Text numberOfLines={1} style={type(12, 600, { color: C.t2, lh: 1.3 })}>{company.name}</Text>
            {siteName ? <Text testID="subheader-site" numberOfLines={1} style={type(12, 700, { color: C.t1, lh: 1.3 })}>{siteName}</Text> : null}
          </View>
        ) : null}
      </View>
      <EnvBadge />
    </View>
  );
}
