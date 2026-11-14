import { router, usePathname } from 'expo-router';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goRoot } from '../state/app';
import { C } from '../theme';
import { GradientFill } from './Gradient';
import { useSession } from '../api/session';
import { BellIcon, DocsIcon, GridIcon, HomeIcon, ScanIcon, TasksIcon } from './Icons';
import { Tap } from './ui';

const MORE_PREFIXES = ['/more', '/obligation', '/ncr', '/service', '/pro', '/sync', '/account', '/equipment', '/profile', '/admin', '/team', '/report', '/risk', '/notifications', '/network', '/trainings', '/training', '/verif', '/board'];

type Tab = {
  key: string;
  label: string;
  Icon: ComponentType<{ size?: number; color?: string }>;
  big?: boolean;
  isActive: (path: string) => boolean;
  go: () => void;
};

const TABS: Tab[] = [
  { key: 'home', label: 'Ana Sayfa', Icon: HomeIcon, isActive: p => p === '/', go: () => goRoot('/') },
  { key: 'tasks', label: 'Görevler', Icon: TasksIcon, isActive: p => p === '/tasks' || p.startsWith('/task/'), go: () => goRoot('/tasks') },
  {
    // Centre action: open the next check that is due.
    key: 'next', label: 'Sıradaki kontrol', Icon: ScanIcon, big: true, isActive: p => p === '/next',
    go: () => { goRoot('/'); router.push('/next'); },
  },
  { key: 'docs', label: 'Belgeler', Icon: DocsIcon, isActive: p => p === '/documents' || p.startsWith('/documents/'), go: () => goRoot('/documents') },
  { key: 'more', label: 'Daha', Icon: GridIcon, isActive: p => MORE_PREFIXES.some(m => p === m || p.startsWith(m + '/') || p.startsWith(m + 's')), go: () => goRoot('/more') },
];

/** Staff see their own work only: the fourth tab is their trainings (the vault is for managers). */
const STAFF_TABS: Tab[] = TABS.map(t => t.key === 'docs'
  ? { key: 'training', label: 'Eğitim', Icon: DocsIcon, isActive: p => p.startsWith('/training'), go: () => goRoot('/trainings') } : t);

/** A specialist without a business: provider area, professional network, account. */
const PROVIDER_TABS: Tab[] = [
  { key: 'pro', label: 'Uzman alanı', Icon: HomeIcon, isActive: p => p === '/pro' || p.startsWith('/pro/') || p.startsWith('/service'), go: () => goRoot('/pro') },
  { key: 'network', label: 'Ağ', Icon: DocsIcon, isActive: p => p.startsWith('/network'), go: () => goRoot('/network') },
  { key: 'account', label: 'Hesap', Icon: GridIcon, isActive: p => p === '/account', go: () => goRoot('/account') },
];

/** Platform staff without a business: management and account. */
const PLATFORM_TABS: Tab[] = [
  { key: 'admin', label: 'Yönetim', Icon: HomeIcon, isActive: p => p.startsWith('/admin') || p.startsWith('/rule') || p.startsWith('/institution') || p.startsWith('/moderation'), go: () => goRoot('/admin') },
  { key: 'more', label: 'Daha', Icon: GridIcon, isActive: p => p === '/more' || p === '/account' || p.startsWith('/network'), go: () => goRoot('/more') },
];

/** An outside verifier (access grant, no role in the business) can use only these two screens; the rest would be dead ends. */
const VERIFIER_TABS: Tab[] = [
  { key: 'verify', label: 'Doğrulama', Icon: TasksIcon, isActive: p => p === '/verify-queue' || p.startsWith('/ncr/'), go: () => goRoot('/verify-queue') },
  { key: 'notes', label: 'Bildirimler', Icon: BellIcon, isActive: p => p === '/notifications', go: () => goRoot('/notifications') },
];

export function TabBar() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { company, role, me } = useSession();
  const tabs = company && !role && company.grants?.some(g => g.scopes.includes('ncr_verify')) ? VERIFIER_TABS
    : !company ? ((me?.platformRoles.length ?? 0) > 0 ? PLATFORM_TABS : PROVIDER_TABS)
    : role === 'staff' ? STAFF_TABS : TABS;
  const bottom = Math.max(26, insets.bottom);
  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 86 + bottom }}>
        <GradientFill angle={0} stops={[[0, C.bg], [0.42, C.bg], [0.72, 'rgba(5,5,5,0.8)'], [1, 'rgba(5,5,5,0)']]} />
      </View>
      <View accessibilityRole="tablist" style={[styles.bar, { bottom }]}>
        {tabs.map(({ key, label, Icon, big, isActive, go }) => {
          const active = isActive(path);
          const d = big ? 60 : 52;
          return (
            <Tap
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              onPress={go}
              style={{
                width: d, height: d, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                backgroundColor: active ? C.lime : 'transparent',
                boxShadow: active ? '0 4px 20px rgba(198,255,61,0.35)' : undefined,
              }}
            >
              <Icon size={big ? 24 : 21} color={active ? C.ink : 'rgba(245,245,242,0.5)'} />
            </Tap>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 16, right: 16, height: 68, paddingHorizontal: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(18,18,18,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', borderRadius: 999,
    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
  },
});
