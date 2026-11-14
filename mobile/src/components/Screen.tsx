import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueue } from '../api/queue';
import { useSession } from '../api/session';
import { goBack } from '../state/app';
import { C, tint, type } from '../theme';
import { GradientFill } from './Gradient';
import { useApi } from '../api/useApi';
import { BackIcon, BellIcon } from './Icons';
import { Tap } from './ui';

/** Bottom padding that keeps content clear of the floating tab bar. */
export const TAB_CLEARANCE = 142;

type Props = {
  children: ReactNode;
  /** Sub-screen title (Turkish) and its English sublabel. Omit for the brand header. */
  title?: string;
  titleEn?: string;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function Screen({ children, title, titleEn, gap = 12, contentStyle, onRefresh, refreshing = false }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: insets.top + 8 }}>
        {title === undefined ? <BrandHeader /> : <SubHeader title={title} titleEn={titleEn} />}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingHorizontal: 22, paddingBottom: TAB_CLEARANCE + insets.bottom, gap }, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.lime} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Demo and pilot data must never look alike. */
export function EnvBadge() {
  const { env } = useSession();
  if (!env) return null;
  const demo = env.mode === 'demo';
  return (
    <View accessibilityLabel={demo ? 'Demo ortamı: örnek veri' : 'Pilot ortamı'} style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: demo ? tint.warn(0.45) : tint.info(0.45) }}>
      <Text style={type(8.5, 700, { ls: 0.08, color: demo ? C.warn : C.info })}>{demo ? 'DEMO · ÖRNEK VERİ' : 'PİLOT'}</Text>
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
  return (
    <Tap accessibilityLabel={`Eşitleme durumu: ${label}`} onPress={() => router.push('/sync')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: tint.white(0.09), backgroundColor: '#141414' }}>
      <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color }} />
      <Text style={type(11, 600, { color: C.t2 })}>{label}</Text>
    </Tap>
  );
}

function BrandHeader() {
  const { me, company } = useSession();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 4, paddingHorizontal: 22, paddingBottom: 14 }}>
      <View style={{ width: 44, height: 44, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 22px rgba(198,255,61,0.28)' }}>
        <GradientFill angle={150} stops={[[0, C.lime], [1, '#9BD718']]} />
        <Text style={type(20, 800, { family: 'outfit', color: C.ink })}>G</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={[type(11, 500, { color: C.t2 }), { flexShrink: 1 }]}>Merhaba, {me?.displayName ?? ''}</Text>
          <EnvBadge />
        </View>
        <Text numberOfLines={1} style={[type(16, 700, { ls: -0.015 }), { marginTop: 2 }]}>{company?.name ?? 'GoverHub'}</Text>
      </View>
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
      style={{ width: 36, height: 36, borderRadius: 999, borderWidth: 1, borderColor: tint.white(0.09), backgroundColor: '#141414', alignItems: 'center', justifyContent: 'center' }}>
      <BellIcon size={17} color={unread ? C.t1 : C.t2} />
      {unread ? (
        <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 999, paddingHorizontal: 4, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={type(9.5, 800, { color: C.ink })}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Tap>
  );
}

function SubHeader({ title, titleEn }: { title: string; titleEn?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4, paddingHorizontal: 22, paddingBottom: 14 }}>
      <Tap accessibilityLabel="Geri" onPress={goBack} style={{ width: 36, height: 36, borderRadius: 999, borderWidth: 1, borderColor: C.bd, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' }}>
        <BackIcon />
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(16, 700, { ls: -0.015 })}>{title}</Text>
        {titleEn ? <Text style={[type(10.5, 400, { color: C.t3 }), { marginTop: 1 }]}>{titleEn}</Text> : null}
      </View>
      <EnvBadge />
    </View>
  );
}
