import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useConnectSpotify } from '@/components/spotify-connect';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useSpotifySuggestions } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

/**
 * The account section of the profile header: which integrations are wired up,
 * and the ways out — MANAGE (the /sign-in screen, where deletion lives) and
 * SIGN OUT. No "signed in as" row: this renders directly under your own name
 * and avatar, inside the header card, so saying who you are again would just
 * repeat the pixels above it.
 *
 * It slots into `PersonProfile` via `accountSlot` rather than living there,
 * because that component is also every *visitor's* view of a profile and must
 * never grow account controls of its own — the Profile tab passes this in,
 * `/user/[key]` passes nothing. It used to be a separate card below the
 * profile, which read as an afterthought and pushed sign-out below the fold.
 *
 * Integrations is a list of one on purpose. Spotify is the only integration
 * today, but "CONNECTED" needs a place to live that isn't inside the
 * suggestions feature it powers — a listener asking "what does this app know
 * about?" should get the answer here, not by scrolling Explore and inferring.
 *
 * Signed-in branch only, same contract as `SpotifyConnect`: `useUser` needs
 * Clerk's provider.
 */
export function AccountCard() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { busy, failed, connect } = useConnectSpotify();

  // "Connected" is the server's word, not the client's. This row used to read
  // Clerk's client-side `verifiedExternalAccounts`, and production showed the
  // two disagreeing: the suggestions endpoint was fetching a live Spotify
  // token — the listener's library rendered on the Following tab — while this
  // card still offered CONNECT, and tapping it 403'd because the account
  // already existed. The suggestions query's `linked` flag *is* a successful
  // token fetch, so it can't be wrong about this; Clerk's view fills in only
  // until that answer arrives (and after a native connect, the flow
  // invalidates the query, so this refreshes itself).
  const suggestions = useSpotifySuggestions(true);
  const spotifyLinked =
    suggestions.data?.linked ??
    Boolean(user?.verifiedExternalAccounts.some((a) => a.provider === 'spotify'));
  // A failed attempt comes home as a full page load on web, so the hook's own
  // `failed` state is gone by the time anyone can read it. Clerk keeps the
  // reason on the unverified account it left behind — show that, verbatim:
  // "access denied" vs "invalid client" is the difference between the listener
  // changing their mind and the dashboard being misconfigured, and whoever is
  // looking at this row is the one who needs to know which.
  const pendingError = spotifyLinked
    ? null
    : (user?.unverifiedExternalAccounts.find((a) => a.provider === 'spotify')?.verification?.error ?? null);

  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <ThemedText type="labelSm" style={{ color: theme.textTertiary, letterSpacing: 1.5 }}>
        INTEGRATIONS
      </ThemedText>
      <View style={styles.row}>
        <Ionicons name="musical-notes" size={20} color={Brand.spotify} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Spotify</ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {spotifyLinked
              ? 'SUGGESTS ARTISTS FROM YOUR LIBRARY'
              : failed
                ? "DIDN'T COMPLETE — TRY AGAIN"
                : 'SUGGEST ARTISTS FROM YOUR LIBRARY'}
          </ThemedText>
        </View>
        {spotifyLinked ? (
          <View style={styles.connected}>
            <Ionicons name="checkmark-circle" size={16} color={theme.cyan} />
            <ThemedText type="labelSm" style={{ color: theme.cyan }}>
              CONNECTED
            </ThemedText>
          </View>
        ) : (
          <PressableScale
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Connect your Spotify account"
            disabled={busy}
            onPress={connect}
            style={[styles.connectBtn, { borderColor: Brand.spotify }]}>
            {busy ? (
              <ActivityIndicator size="small" color={Brand.spotify} />
            ) : (
              <ThemedText type="labelSm" style={{ color: Brand.spotify }}>
                {failed ? 'RETRY' : 'CONNECT'}
              </ThemedText>
            )}
          </PressableScale>
        )}
      </View>
      {pendingError && (
        <ThemedText type="labelSm" style={{ color: theme.error }}>
          {(pendingError.longMessage ?? pendingError.message ?? 'The last attempt failed.').toUpperCase()}
        </ThemedText>
      )}

      <View style={styles.buttons}>
        <PressableScale
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Manage your account"
          onPress={() => router.push('/sign-in')}
          style={[styles.button, { borderColor: theme.border }]}>
          <ThemedText type="labelSm" themeColor="textSecondary">
            MANAGE ACCOUNT
          </ThemedText>
        </PressableScale>
        <PressableScale
          haptic
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={() => void signOut()}
          style={[styles.button, { borderColor: theme.border }]}>
          <ThemedText type="labelSm" themeColor="textSecondary">
            SIGN OUT
          </ThemedText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Stretched and left-aligned inside a centre-aligned header card: rows read
  // as a section of the card, not another centred badge under the name.
  section: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  connected: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  connectBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    minWidth: 88,
    alignItems: 'center',
  },
  buttons: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
