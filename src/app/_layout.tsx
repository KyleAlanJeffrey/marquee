import {
  Anybody_400Regular,
  Anybody_500Medium,
  Anybody_600SemiBold,
  Anybody_700Bold,
  Anybody_800ExtraBold,
  Anybody_800ExtraBold_Italic,
} from '@expo-google-fonts/anybody';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { KyleBadge } from '@/components/kyle-badge';
import { PageMeta } from '@/components/page-meta';
import { Colors, Fonts } from '@/constants/theme';
import { AttendancesProvider } from '@/lib/attendances-store';
import { AuthProvider } from '@/lib/auth';
import { FollowedVenuesProvider } from '@/lib/followed-venues-store';
import { FollowsProvider } from '@/lib/follows-store';
import { useNotificationObserver } from '@/lib/notifications';
import { PrefsProvider } from '@/lib/prefs-store';
import { SavedShowsProvider } from '@/lib/saved-shows-store';

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

/**
 * Everything the user owns lives on the device, so there are five of these and
 * they nest. Composed here rather than inline to keep the tree below readable.
 */
function LocalStores({ children }: { children: React.ReactNode }) {
  return (
    <FollowsProvider>
      <FollowedVenuesProvider>
        <SavedShowsProvider>
          <AttendancesProvider>
            <PrefsProvider>{children}</PrefsProvider>
          </AttendancesProvider>
        </SavedShowsProvider>
      </FollowedVenuesProvider>
    </FollowsProvider>
  );
}

export default function RootLayout() {
  useNotificationObserver();
  const [fontsLoaded] = useFonts({
    Anybody_400Regular,
    Anybody_500Medium,
    Anybody_600SemiBold,
    Anybody_700Bold,
    Anybody_800ExtraBold,
    Anybody_800ExtraBold_Italic,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Outside the query client, so a token is available to the first fetch it
          makes. Renders its children untouched when there is no Clerk key. */}
      <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <LocalStores>
            <ThemeProvider value={navTheme}>
              <StatusBar style="light" />
              {/* Default document metadata; screens override it with their own. */}
              <PageMeta />
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
                  <Stack.Screen name="venue/[id]" />
                  <Stack.Screen name="browse" />
                </Stack>
              )}
              {!fontsLoaded && <View style={{ flex: 1, backgroundColor: theme.background }} />}
              <KyleBadge />
            </ThemeProvider>
        </LocalStores>
      </QueryClientProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
