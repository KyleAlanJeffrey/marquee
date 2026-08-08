import Ionicons from '@expo/vector-icons/Ionicons';
import { useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * "Connect Spotify" for an account that already exists.
 *
 * Sign-in offers Spotify as one of the ways *in*, but signing up with Spotify and
 * connecting Spotify are different things, and only offering it at the door means
 * everybody who already has an account can never get the feature. Clerk's
 * `createExternalAccount` is the same OAuth flow, attached to a live session
 * instead of creating one.
 *
 * **Only ever rendered inside a signed-in branch.** `useUser` comes from Clerk's
 * provider, and this app mounts that provider only when it has a publishable key
 * (see `lib/auth.tsx`) — so a component that calls it unconditionally would throw
 * in a keyless build. Keeping the call in a child that the parent renders
 * conditionally is what makes the hook rule and the keyless case agree.
 */
/**
 * The linking flow behind the card, on its own so the Profile tab's
 * integrations row can offer the same button without carrying the pitch copy.
 * Callers hold the same contract as the card: signed-in branch only.
 */
export function useConnectSpotify() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const connect = async () => {
    if (!user || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // Where Spotify sends the browser when it's done. `createURL` gives
      // `marquee://` on a device and the site's own origin on web, so one call
      // site covers both without branching on the URL.
      const redirectUrl = Linking.createURL('/');

      // A back-out leaves an unverified Spotify account attached to the user, and
      // asking Clerk to create a second one for the same provider is an error
      // rather than a retry. `reauthorize` is the retry: it hands back a fresh
      // authorize URL for the account that's already there.
      const pending = user.unverifiedExternalAccounts.find((a) => a.provider === 'spotify');
      const account = pending
        ? await pending.reauthorize({ redirectUrl })
        : await user.createExternalAccount({ strategy: 'oauth_spotify', redirectUrl });
      const target = account.verification?.externalVerificationRedirectURL?.toString();
      if (!target) throw new Error('Clerk returned no verification URL');

      if (Platform.OS === 'web') {
        // A full-page navigation, not a popup: blockers eat the popup and the
        // return trip is a normal page load either way.
        window.location.href = target;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(target, redirectUrl);
      // The session's connected accounts may have changed underneath us; without
      // the reload the next render still believes Spotify isn't linked. Reload
      // even when the sheet reports a dismissal, because somebody who authorised
      // and *then* closed it by hand is linked, and asking is the only way to
      // know — the sheet's own verdict isn't evidence either way.
      const fresh = await user.reload();
      const linked = fresh.verifiedExternalAccounts.some((a) => a.provider === 'spotify');
      if (!linked) {
        // Closing the sheet is a decision, not a fault: no error copy for it.
        // Anything else means the flow broke somewhere worth retrying.
        setFailed(result.type !== 'cancel' && result.type !== 'dismiss');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['spotify-suggestions'] });
    } catch (err) {
      // Most likely cause while the Spotify app is in development mode: this
      // account isn't on its 25-name allowlist, so Spotify refuses at the
      // authorize step. Nothing here can fix that, and explaining somebody
      // else's quota to a listener helps nobody — so it's a plain retry.
      console.warn('connecting spotify failed:', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return { busy, failed, connect };
}

export function SpotifyConnect({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const { busy, failed, connect } = useConnectSpotify();

  return (
    <View style={[styles.card, compact && styles.cardCompact, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
      <View style={styles.head}>
        <Ionicons name="musical-note" size={18} color={theme.primary} />
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          Bring your Spotify
        </ThemedText>
      </View>
      <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
        {failed
          ? "Spotify didn't complete that. Try again."
          : 'See which of the artists you follow and listen to are playing near you.'}
      </ThemedText>
      <PressableScale
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel="Connect your Spotify account"
        disabled={busy}
        onPress={connect}
        style={[styles.button, { borderColor: theme.primary }]}>
        {busy ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            {failed ? 'TRY AGAIN' : 'CONNECT SPOTIFY'}
          </ThemedText>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    margin: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  cardCompact: { marginHorizontal: Spacing.three, marginVertical: Spacing.two, padding: Spacing.two + 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    minWidth: 150,
    alignItems: 'center',
  },
});
