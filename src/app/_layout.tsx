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
import { UpdateNudge } from '@/components/update-nudge';
import { Colors, Fonts } from '@/constants/theme';
import { AuthProvider } from '@/lib/auth';
import { useNotificationObserver } from '@/lib/notifications';
import { ProfileSync } from '@/lib/people';
import { RsvpSettler } from '@/lib/rsvp-settler';
import { WriteGateProvider } from '@/lib/write-gate-provider';

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

/*
 * There used to be five nested store providers and a sync component here, because
 * everything the user owned lived on the device. Nothing does now — the lists and the
 * preferences are read straight off the account through React Query (see
 * `account-lists.tsx`), so the providers, the AsyncStorage hydration and the merge
 * policy are all gone. `WriteGateProvider` is the only one left: it still answers
 * "may this write happen", which is now simply "are you signed in".
 */

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
        <WriteGateProvider>
            <ThemeProvider value={navTheme}>
              <StatusBar style="light" />
              {/* Default document metadata; screens override it with their own. */}
              <PageMeta />
              {/* Refreshes the server's mirror of this account from Clerk on sign-in. */}
              <ProfileSync />
              {/* Turns yesterday's "I'm going" into a logged show. Mounted at the
                  root so it runs whichever tab the app opens on. */}
              <RsvpSettler />
              {/* Web only: tells a long-lived tab when a deploy has passed it
                  by. An SPA tab keeps its boot bundle until someone reloads,
                  and stale tabs kept reading as bug reports. */}
              <UpdateNudge />
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
                  {/* Logging a show is a quick interruption from anywhere — the
                      Log tab, an artist page — and lands you back where you were.
                      No stock header: the flow carries its own stepped one. */}
                  <Stack.Screen
                    name="log-show"
                    options={{
                      presentation: 'modal',
                      headerShown: false,
                    }}
                  />
                  {/* A modal, because it is always an interruption: you reached it
                      by trying to keep something, and you should land back where
                      you were rather than somewhere new. */}
                  <Stack.Screen
                    name="sign-in"
                    options={{
                      presentation: 'modal',
                      headerShown: true,
                      title: 'Your account',
                      headerStyle: { backgroundColor: theme.background },
                      headerTintColor: theme.primary,
                      headerTitleStyle: { fontFamily: Fonts.headlineMd, color: theme.text },
                    }}
                  />
                  <Stack.Screen
                    name="sign-up"
                    options={{
                      presentation: 'modal',
                      headerShown: true,
                      title: 'Create your account',
                      headerStyle: { backgroundColor: theme.background },
                      headerTintColor: theme.primary,
                      headerTitleStyle: { fontFamily: Fonts.headlineMd, color: theme.text },
                    }}
                  />
                  {/* The content pages (event, artist, venue, user, list,
                      browse, map) live inside (tabs) so the bottom bar stays
                      put — see the tab layout. Only the two modals remain
                      out here. */}
                </Stack>
              )}
              {!fontsLoaded && <View style={{ flex: 1, backgroundColor: theme.background }} />}
              <KyleBadge />
            </ThemeProvider>
        </WriteGateProvider>
      </QueryClientProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
