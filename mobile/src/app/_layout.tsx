import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Text, View, useWindowDimensions } from 'react-native';
import { QueueProvider } from '../api/queue';
import { PrimaryButton } from '../components/ui';
import { SessionProvider, useSession } from '../api/session';
import { TabBar } from '../components/TabBar';
import { ToastView } from '../components/ToastView';
import { DESKTOP_MIN, isDeskPath } from '../features/desktop';
import { UiProvider } from '../state/app';
import { C } from '../theme';

/** On a wide browser window the app is shown inside a phone-sized frame. */
const PHONE = { width: 390, height: 844 };
const OPEN_ROUTES = ['/login'];
const NO_TABS = ['/login', '/setup'];

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black,
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  });
  const win = useWindowDimensions();
  const path = usePathname();
  // Platform yönetim ekranları (mevzuat masası, yönetim) geniş pencerede telefon çerçevesi olmadan, tam genişlikte açılır.
  const desk = Platform.OS === 'web' && win.width >= DESKTOP_MIN && isDeskPath(path);
  const framed = Platform.OS === 'web' && win.width > 520 && !desk;
  const frame = { width: PHONE.width, height: Math.min(PHONE.height, win.height - 40) };

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const app = (
    <View style={framed ? { ...frame, borderRadius: 46, overflow: 'hidden', backgroundColor: C.bg, boxShadow: '0 0 0 11px #0a0a0a, 0 0 0 13px #1c1c1c, 0 60px 120px rgba(0,0,0,0.7)' } : { flex: 1, backgroundColor: C.bg }}>
      <Gate>
        <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: C.bg } }}>
          <Stack.Screen name="task/[id]" options={{ animation: 'fade_from_bottom' }} />
        </Stack>
        {desk ? null : <Tabs />}
        <ToastView />
      </Gate>
    </View>
  );

  return (
    <UiProvider>
      <SessionProvider>
        <QueueProvider>
          <StatusBar style="light" />
          {framed ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.page }}>{app}</View> : app}
        </QueueProvider>
      </SessionProvider>
    </UiProvider>
  );
}

/** Sends signed-out users to sign-in and users without a business to setup. */
function Gate({ children }: { children: ReactNode }) {
  const { ready, token, companies, company, role, me, provider } = useSession();
  const path = usePathname();
  // B-07: an outside verifier (grant, no role) reaches only the verification list, the cases and notifications; a direct address to anything else sends them back.
  const outsideVerifier = !!company && !role && !!company.grants?.some(g => g.scopes.includes('ncr_verify'));
  const verifierAllowed = path === '/' || path === '/verify-queue' || path.startsWith('/ncr/') || path === '/notifications' || path === '/account' || path === '/login';
  // Without a business: the provider area, the professional network and moderation stay reachable.
  const platform = (me?.platformRoles.length ?? 0) > 0;
  // People without a business: specialists, network users and platform staff (rules, review, institution demo).
  const providerOnly = !!me && companies.length === 0 && (path.startsWith('/pro') || path.startsWith('/network') || path.startsWith('/moderation')
    || (platform && (path.startsWith('/admin') || path.startsWith('/rule') || path.startsWith('/legislation') || path.startsWith('/institution') || path === '/more')));
  // No business and not yet known whether they are a specialist (the profile could not be read, e.g. offline): wait, do not guess.
  const waitingProfile = !!token && !!me && companies.length === 0 && provider === null && !providerOnly && path !== '/setup' && path !== '/account';
  useEffect(() => {
    if (!ready) return;
    if (!token && !OPEN_ROUTES.includes(path)) router.replace('/login');
    // No business: a person with a professional profile goes to the provider area; everyone else to business setup.
    else if (token && me && companies.length === 0 && !providerOnly && !waitingProfile && path !== '/setup' && path !== '/account') router.replace(provider ? '/pro' : platform ? '/admin' : '/setup');
    else if (token && path === '/login') router.replace('/');
  }, [ready, token, companies.length, me, path, providerOnly, provider, waitingProfile, platform]);
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.lime} /></View>;
  if (waitingProfile) return (
    <View testID="gate-waiting-profile" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <ActivityIndicator color={C.lime} />
      <Text style={{ color: C.t1, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>Hesabın kontrol ediliyor</Text>
      <Text style={{ color: C.t2, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>Uzman profilin sunucudan okunamadı (bağlantı yok olabilir). Bağlantı gelince doğru ekran kendiliğinden açılır; işletme kurulumuna gönderilmedin.</Text>
    </View>
  );
  // B-05: an outside verifier asking for a page outside the permission gets the reason and the way back, not an empty "Bugün 0".
  if (ready && token && outsideVerifier && !verifierAllowed) return (
    <View testID="out-of-scope" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <Text style={{ color: C.t1, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>Bu sayfa iznin dışında</Text>
      <Text style={{ color: C.t2, fontSize: 13.5, lineHeight: 20, textAlign: 'center' }}>Dış doğrulayıcı olarak yalnız sana atanan uygunsuzluk kayıtlarını ve bunların doğrulamasını görürsün. Görevler, belgeler, ekip ve şube bilgileri bu iznin kapsamında değildir.</Text>
      <PrimaryButton testID="out-of-scope-back" label="Doğrulama kuyruğuma dön" onPress={() => router.replace('/verify-queue')} />
    </View>
  );
  return <>{children}</>;
}

function Tabs() {
  const path = usePathname();
  const { token } = useSession();
  if (!token || NO_TABS.includes(path)) return null;
  return <TabBar />;
}
