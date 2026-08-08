import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useConnectSpotify } from '@/components/spotify-connect';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

const SPOTIFY_GREEN = '#1DB954';

/**
 * The account half of the Profile tab's top block: who you're signed in as,
 * which integrations are wired up, and the way out — one card, directly under
 * the public profile it belongs to. It used to be three separate sections with
 * "sign out" hidden behind a hop to `/sign-in`, which made the single most
 * common account action a scavenger hunt.
 *
 * Integrations is a list of one on purpose. Spotify is the only integration
 * today, but "CONNECTED" needs a place to live that isn't inside the
 * suggestions feature it powers — a listener asking "what does this app know
 * about?" should get the answer here, not by scrolling Explore and inferring.
 *
 * Signed-in branch only, same contract as `SpotifyConnect`: `useUser` needs
 * Clerk's provider. Account *deletion* stays on `/sign-in` behind MANAGE —
 * destructive and rare doesn't belong one tap from a settings scroll.
 */
export function AccountCard() {
  const theme = useTheme();
  const { displayName, signOut } = useAuth();
  const { user } = useUser();
  const { busy, failed, connect } = useConnectSpotify();

  // Clerk's client knows the linked accounts already — no server round-trip.
  // `verified` matters: a back-out at Spotify's authorize page leaves an
  // unverified account behind, and that must read as "not connected".
  const spotifyLinked = Boolean(
    user?.verifiedExternalAccounts.some((a) => a.provider === 'spotify'),
  );

  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
      <View style={styles.row}>
        <Ionicons name="person-circle" size={26} color={theme.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {displayName ?? 'Your account'}
          </ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            SIGNED IN
          </ThemedText>
        </View>
        <PressableScale
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Manage your account"
          onPress={() => router.push('/sign-in')}
          hitSlop={8}
          style={styles.manage}>
          <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
            MANAGE
          </ThemedText>
          <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
        </PressableScale>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <ThemedText type="labelSm" style={{ color: theme.textTertiary, letterSpacing: 1.5 }}>
        INTEGRATIONS
      </ThemedText>
      <View style={styles.row}>
        <Ionicons name="musical-notes" size={20} color={SPOTIFY_GREEN} />
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
            style={[styles.connectBtn, { borderColor: SPOTIFY_GREEN }]}>
            {busy ? (
              <ActivityIndicator size="small" color={SPOTIFY_GREEN} />
            ) : (
              <ThemedText type="labelSm" style={{ color: SPOTIFY_GREEN }}>
                {failed ? 'RETRY' : 'CONNECT'}
              </ThemedText>
            )}
          </PressableScale>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={[styles.signOut, { borderColor: theme.border }]}>
        <ThemedText type="labelSm" themeColor="textSecondary">
          SIGN OUT
        </ThemedText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  connected: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  connectBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    minWidth: 88,
    alignItems: 'center',
  },
  signOut: {
    alignSelf: 'center',
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
