import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors, Fonts } from '@/constants/theme';
import { FollowsProvider } from '@/lib/follows-store';
import { useNotificationObserver } from '@/lib/notifications';
import { PrefsProvider } from '@/lib/prefs-store';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60 * 1000 } },
});

const theme = Colors.dark;

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.background,
    card: theme.background,
    text: theme.text,
    border: theme.border,
    primary: theme.primary,
  },
};

export default function RootLayout() {
  useNotificationObserver();
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <QueryClientProvider client={queryClient}>
        <FollowsProvider>
          <PrefsProvider>
            <ThemeProvider value={navTheme}>
              <StatusBar style="light" />
              {fontsLoaded && (
                <Stack
                  screenOptions={{
                    headerShown: false,
                    // Opaque so screens don't bleed through each other on web.
                    contentStyle: { backgroundColor: theme.background },
                    animation: 'slide_from_right',
                  }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="search"
                    options={{
                      presentation: 'modal',
                      headerShown: true,
                      title: 'Find artists',
                      headerStyle: { backgroundColor: theme.background },
                      headerTintColor: theme.primary,
                      headerTitleStyle: { fontFamily: Fonts.headlineMd, color: theme.text },
                    }}
                  />
                  <Stack.Screen name="artist/[id]" />
                  <Stack.Screen name="event/[id]" />
                  <Stack.Screen name="browse" />
                </Stack>
              )}
              {!fontsLoaded && <View style={{ flex: 1, backgroundColor: theme.background }} />}
            </ThemeProvider>
          </PrefsProvider>
        </FollowsProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
