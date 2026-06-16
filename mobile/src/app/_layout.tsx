import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import { useAppStore } from '../lib/store';
import { getServerUrl, getToken } from '../lib/storage';
import { connect, disconnect, startAppStateListener, stopAppStateListener } from '../lib/ws';
import { registerPushToken, configurePushHandlers } from '../lib/notifications';
import { patchTextFont } from '../lib/fonts';
import '../../global.css';

patchTextFont();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AuthGate() {
  const { token, serverUrl } = useAppStore();
  const router = useRouter();
  const segments = useSegments();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    async function hydrate() {
      const [url, tok] = await Promise.all([getServerUrl(), getToken()]);
      useAppStore.getState().hydrate(url, tok);
      setHydrated(true);
    }
    hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const inDrawer = segments[0] === '(drawer)';

    if (!serverUrl) {
      router.replace('/connect');
    } else if (!token && inDrawer) {
      router.replace('/login');
    } else if (token && !inDrawer && segments[0] !== 'login' && segments[0] !== 'connect') {
      router.replace('/(drawer)');
    }
  }, [hydrated, token, serverUrl, segments]);

  useEffect(() => {
    if (token && serverUrl) {
      connect();
      startAppStateListener();
    } else {
      disconnect();
      stopAppStateListener();
    }
    return () => { disconnect(); stopAppStateListener(); };
  }, [token, serverUrl]);

  useEffect(() => {
    if (!token || !serverUrl) return;
    registerPushToken().catch(console.error);

    const unsub = configurePushHandlers(({ sessionId }) => {
      if (sessionId) {
        router.push(`/(drawer)/c/${sessionId}`);
      } else {
        router.push('/(drawer)/activity');
      }
    });

    return unsub;
  }, [token, serverUrl]);

  if (!hydrated) return null;
  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
