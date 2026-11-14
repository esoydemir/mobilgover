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

const MORE_PREFIXES = ['/more', '/obligation', '/ncr', '/service', '/pro', '/sync', '/account', '/equipment', '/profile', '/admin', '/team'];

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
  { key: 'report', label: 'Rapor', Icon: DocsIcon, isActive: p => p === '/report', go: () => goRoot('/report') },
  { key: 'more', label: 'Daha', Icon: GridIcon, isActive: p => MORE_PREFIXES.some(m => p === m || p.startsWith(m + '/') || p.startsWith(m + 's')), go: () => goRoot('/more') },
];

/** An outside verifier (access grant, no role in the business) can use only these two screens; the rest would be dead ends. */
const VERIFIER_TABS: Tab[] = [
  { key: 'verify', label: 'Doğrulama', Icon: TasksIcon, isActive: p => p === '/verify-queue' || p.startsWith('/ncr/'), go: () => goRoot('/verify-queue') },
  { key: 'notes', label: 'Bildirimler', Icon: BellIcon, isActive: p => p === '/notifications', go: () => goRoot('/notifications') },
];

export function TabBar() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { company, role } = useSession();
  const tabs = company && !role && company.grants?.some(g => g.scopes.includes('ncr_verify')) ? VERIFIER_TABS : TABS;
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
