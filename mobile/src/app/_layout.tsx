import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { AssistantFab } from '../components/AssistantFab';
import { Sheet } from '../components/Sheet';
import { TabBar } from '../components/TabBar';
import { ToastView } from '../components/ToastView';
import { AppProvider } from '../state/app';
import { C } from '../theme';

/** On a wide browser window the app is shown inside a phone-sized frame. */
const PHONE = { width: 390, height: 844 };

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black,
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  });
  const win = useWindowDimensions();
  const framed = Platform.OS === 'web' && win.width > 520 && win.height > PHONE.height;
  const [size, setSize] = useState(framed ? PHONE : { width: win.width, height: win.height });

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const app = (
    <View
      style={framed ? { ...PHONE, borderRadius: 46, overflow: 'hidden', backgroundColor: C.bg, boxShadow: '0 0 0 11px #0a0a0a, 0 0 0 13px #1c1c1c, 0 60px 120px rgba(0,0,0,0.7)' } : { flex: 1, backgroundColor: C.bg }}
      onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <Stack
        screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: C.bg } }}
      >
        <Stack.Screen name="task/[id]" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="pro/[id]" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="scan-confirm" options={{ animation: 'fade_from_bottom' }} />
      </Stack>
      <AssistantFab width={size.width} height={size.height} />
      <TabBar />
      <Sheet />
      <ToastView />
    </View>
  );

  return (
    <AppProvider>
      <StatusBar style="light" />
      {framed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.page }}>{app}</View>
      ) : app}
    </AppProvider>
  );
}
