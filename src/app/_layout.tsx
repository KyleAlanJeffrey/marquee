import {
  Anybody_400Regular,
  Anybody_500Medium,
  Anybody_600SemiBold,
  Anybody_700Bold,
  Anybody_800ExtraBold,
  Anybody_800ExtraBold_Italic,
} from '@expo-google-fonts/anybody';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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
import { CacheGuard } from '@/lib/cache-guard';
import { useNotificationObserver } from '@/lib/notifications';
import { ProfileSync } from '@/lib/people';
import { RsvpSettler } from '@/lib/rsvp-settler';
import { WriteGateProvider } from '@/lib/write-gate-provider';

import appJson from '../../app.json';

/**
 * The query cache persists — localStorage on web, AsyncStorage on a device.
 *
 * This is what makes a fresh page load *recognise* things instead of
 * re-deriving them: before it, every web visit booted from nothing, so the
 * Spotify block spent its first seconds claiming you weren't connected while
 * the suggestions round-trip (Clerk token → Spotify pagination → D1) ran from
 * scratch. Now the last known answer paints immediately and refetching happens
 * behind it, which is the iOS experience — a warm app — brought to a medium
 * whose process dies on every tab close.
 *
 * `gcTime` must outlive `maxAge`, or restored queries are garbage-collected
 * the moment they hydrate. The app version busts the cache on release, so a
 * shape change in any cached payload can never feed old JSON to new code.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60 * 1000, gcTime: 24 * 60 * 60 * 1000 } },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage, throttleTime: 1000 });

const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  // The app version, read from app.json itself rather than expo-constants:
  // the constants module inlines a serialized manifest that Metro's transform
  // cache can freeze at an old release (it shipped saying 1.1.0 during 1.3.0),
  // and a buster that doesn't change on release busts nothing. A direct JSON
  // import is keyed on the file's content, so it can't go stale.
  buster: appJson.expo.version,
};

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

/**
 * There is no `/` *screen* anymore, on any platform — that address belongs to
 * the server-rendered landing page, which is a website, not a screen of this
 * app. Removing the old `index.tsx` redirect is what finally separates them.
 *
 * A native cold start still arrives as the URL `marquee:///`, though, and an
 * unmatched initial URL renders "Unmatched Route" — `initialRouteName` does
 * not rescue it (verified in the simulator). The declared redirect in
 * app.json (`extra.router.redirects`: `/index` → `/explore` — `index` is
 * the route name the file convention gives `/`) is what resolves it:
 * a signpost in the route table rather than a page, which is exactly the
 * distinction this separation is about.
 *
 * `initialRouteName` still anchors the navigator itself: it names where the
 * root Stack considers "home" once a URL has resolved into it.
 */
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

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
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <WriteGateProvider>
            <ThemeProvider value={navTheme}>
              <StatusBar style="light" />
              {/* Default document metadata; screens override it with their own. */}
              <PageMeta />
              {/* Refreshes the server's mirror of this account from Clerk on sign-in. */}
              <ProfileSync />
              {/* Clears the (persisted) query cache when the account changes,
                  so nothing hydrates under the wrong user. */}
              <CacheGuard />
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
                  {/* No entry animation: the only navigations that reach this
                      screen are the cold-start anchor and modal dismissals,
                      which animate themselves. (The boot used to *slide* in,
                      back when a phantom `index` route redirected here.) */}
                  <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
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
      </PersistQueryClientProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
