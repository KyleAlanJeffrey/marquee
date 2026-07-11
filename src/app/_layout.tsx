import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme } from 'react-native';

import { FollowsProvider } from '@/lib/follows-store';
import { useNotificationObserver } from '@/lib/notifications';
import { PrefsProvider } from '@/lib/prefs-store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60 * 1000 },
  },
});

/**
 * Local-first: no account. Follows and preferences live on-device, so there's
 * no auth gate — the app opens straight to the feed.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  useNotificationObserver();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <FollowsProvider>
          <PrefsProvider>
            <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="search"
                  options={{ presentation: 'modal', title: 'Find artists' }}
                />
                <Stack.Screen name="artist/[id]" options={{ title: '' }} />
              </Stack>
            </ThemeProvider>
          </PrefsProvider>
        </FollowsProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
