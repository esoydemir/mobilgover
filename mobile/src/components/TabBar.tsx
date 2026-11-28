import { router, usePathname } from 'expo-router';
import { useEffect, useState, type ComponentType } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goRoot } from '../state/app';
import { C, glass, lift, type } from '../theme';
import { useSession } from '../api/session';
import { BellIcon, DocsIcon, GridIcon, HomeIcon, PeopleIcon, ScanIcon, TasksIcon, TrainingIcon, UserIcon } from './Icons';
import { Tap } from './ui';

const MORE_PREFIXES = ['/more', '/obligation', '/ncr', '/service', '/pro', '/sync', '/account', '/equipment', '/profile', '/admin', '/team', '/report', '/market', '/notifications', '/network', '/trainings', '/training', '/verif', '/board'];

type Tab = {
  key: string;
  label: string;
  /** Text under the icon when the full label does not fit. The accessibility label stays `label`. */
  short?: string;
  Icon: ComponentType<{ size?: number; color?: string }>;
  isActive: (path: string) => boolean;
  go: () => void;
};

const TABS: Tab[] = [
  { key: 'home', label: 'Ana Sayfa', short: 'Bugün', Icon: HomeIcon, isActive: p => p === '/' || p === '/risk', go: () => goRoot('/') },
  { key: 'tasks', label: 'Görevler', Icon: TasksIcon, isActive: p => p === '/tasks' || p.startsWith('/task/'), go: () => goRoot('/tasks') },
  {
    // Centre action: open the next check that is due.
    key: 'next', label: 'Sıradaki kontrol', short: 'Sıradaki', Icon: ScanIcon, isActive: p => p === '/next',
    go: () => { goRoot('/'); router.push('/next'); },
  },
  { key: 'docs', label: 'Belgeler', Icon: DocsIcon, isActive: p => p === '/documents' || p.startsWith('/documents/'), go: () => goRoot('/documents') },
  { key: 'more', label: 'Daha', Icon: GridIcon, isActive: p => MORE_PREFIXES.some(m => p === m || p.startsWith(m + '/') || p.startsWith(m + 's')), go: () => goRoot('/more') },
];

const isTraining = (p: string) => p.startsWith('/training');
/** Staff see their own work only: the fourth tab is their trainings (the vault is for managers). */
const STAFF_TABS: Tab[] = TABS.map(t => t.key === 'docs' ? { key: 'training', label: 'Eğitim', Icon: TrainingIcon, isActive: isTraining, go: () => goRoot('/trainings') }
  : t.key === 'more' ? { ...t, isActive: (p: string) => !isTraining(p) && t.isActive(p) } : t);

/** A specialist without a business: provider area, professional network, account. */
const PROVIDER_TABS: Tab[] = [
  { key: 'pro', label: 'Uzman alanı', short: 'İşlerim', Icon: HomeIcon, isActive: p => p === '/pro' || p.startsWith('/pro/') || p.startsWith('/service'), go: () => goRoot('/pro') },
  { key: 'network', label: 'Ağ', short: 'Mesleki ağ', Icon: PeopleIcon, isActive: p => p.startsWith('/network'), go: () => goRoot('/network') },
  { key: 'account', label: 'Hesap', Icon: UserIcon, isActive: p => p === '/account', go: () => goRoot('/account') },
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

const TYPED = ['text', 'email', 'number', 'search', 'tel', 'url', 'password', 'date', ''];
/** While a touch keyboard is open the bar would cover the form being filled in, so it steps aside. */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const a = Keyboard.addListener('keyboardDidShow', () => setTyping(true)), b = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
      return () => { a.remove(); b.remove(); };
    }
    if (!globalThis.matchMedia?.('(pointer: coarse)').matches) return;
    const field = (t: unknown) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TYPED.includes(t.getAttribute('type') ?? ''));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { clearTimeout(timer); timer = setTimeout(() => setTyping(field(document.activeElement)), 120); };
    document.addEventListener('focusin', check); document.addEventListener('focusout', check); check();
    return () => { clearTimeout(timer); document.removeEventListener('focusin', check); document.removeEventListener('focusout', check); };
  }, []);
  return typing;
}

export function TabBar() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { company, role, me } = useSession();
  const typing = useTyping();
  const tabs = company && !role && company.grants?.some(g => g.scopes.includes('ncr_verify')) ? VERIFIER_TABS
    : !company ? ((me?.platformRoles.length ?? 0) > 0 ? PLATFORM_TABS : PROVIDER_TABS)
    : role === 'staff' ? STAFF_TABS : TABS;
  if (typing) return null;
  return (
    <View accessibilityRole="tablist" testID="tab-bar" style={[styles.bar, { bottom: Math.max(10, insets.bottom) }, glass, lift]}>
      {tabs.map(({ key, label, short, Icon, isActive, go }) => {
        const active = isActive(path);
        return (
          <Tap key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={go}
            style={{ flex: 1, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: active ? C.accent : 'transparent' }}>
            <Icon size={21} color={active ? C.ink : C.t2} />
            <Text numberOfLines={1} style={type(11, active ? 700 : 600, { color: active ? C.ink : C.t2 })}>{short ?? label}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 10, right: 10, height: 64, paddingHorizontal: 6, gap: 2,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.bd, borderRadius: 16,
  },
});
