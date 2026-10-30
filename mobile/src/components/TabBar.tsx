import { router, usePathname } from 'expo-router';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goRoot } from '../state/app';
import { C } from '../theme';
import { GradientFill } from './Gradient';
import { DocsIcon, GridIcon, HomeIcon, ScanIcon, TasksIcon } from './Icons';
import { Tap } from './ui';

const MORE_ROUTES = ['/more', '/personnel', '/equipment', '/form', '/ncr', '/roadmap', '/training', '/quotes', '/visit', '/settings'];

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
    key: 'qr', label: 'Tara', Icon: ScanIcon, big: true, isActive: p => p === '/qr',
    // QR sits one level above the persona's home, so back returns there.
    go: () => { goRoot('/'); router.push('/qr'); },
  },
  { key: 'docs', label: 'Belgeler', Icon: DocsIcon, isActive: p => p === '/docs' || p === '/scan' || p === '/scan-confirm', go: () => goRoot('/docs') },
  { key: 'more', label: 'Daha', Icon: GridIcon, isActive: p => MORE_ROUTES.includes(p), go: () => goRoot('/more') },
];

export function TabBar() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(26, insets.bottom);
  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 86 + bottom }}>
        <GradientFill angle={0} stops={[[0, C.bg], [0.42, C.bg], [0.72, 'rgba(5,5,5,0.8)'], [1, 'rgba(5,5,5,0)']]} />
      </View>
      <View accessibilityRole="tablist" style={[styles.bar, { bottom }]}>
        {TABS.map(({ key, label, Icon, big, isActive, go }) => {
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
