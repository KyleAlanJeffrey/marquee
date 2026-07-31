import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiDelete } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Why you are looking at a sign-in screen.
 *
 * The gate passes the action that was refused, so this says "Sign in to save shows"
 * rather than a bare "Sign in" — somebody who tapped a bookmark and got a login
 * form deserves to be told which of those two things was the cause.
 */
export function SignInReason({ why }: { why?: string }) {
  const { signedIn } = useAuth();
  if (signedIn) return null;
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="headline">{why ? `Sign in to ${why}` : 'Sign in'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Browsing needs no account. Keeping things does — your artists, venues, saved shows and the
        gigs you&apos;ve been to all live with your account.
      </ThemedText>
    </View>
  );
}

/** How long an armed delete button stays armed before standing down. */
const DISARM_MS = 6000;

/**
 * Delete the account: lists, follows, log, profile and the Clerk identity, in
 * one call to `DELETE /api/me`. The workflow both stores require, live on the
 * screen the privacy page points at (Profile → Your account).
 *
 * The confirmation is a second tap on the same button rather than a dialog:
 * `Alert.alert` with buttons is a no-op on react-native-web, and a control this
 * destructive must not work on one platform and silently not confirm on
 * another. Armed state stands down on its own so an accidental tap doesn't
 * leave a live grenade on screen.
 */
function DeleteAccountButton() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'armed' | 'working' | 'failed'>('idle');
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(disarm.current ?? undefined), []);

  const onPress = async () => {
    if (state === 'working') return;
    if (state !== 'armed') {
      setState('armed');
      clearTimeout(disarm.current ?? undefined);
      disarm.current = setTimeout(() => setState('idle'), DISARM_MS);
      return;
    }
    clearTimeout(disarm.current ?? undefined);
    setState('working');
    try {
      await apiDelete('/me');
    } catch (err) {
      // Retry-friendly on purpose: the server deletes our data before the Clerk
      // identity, so a failure partway leaves a login that still works and a
      // button that can be pressed again.
      console.warn('account deletion failed:', err);
      setState('failed');
      return;
    }
    // Past this point the account is gone server-side. A sign-out hiccup is a
    // local cleanup problem — it must not present as "deletion failed" and
    // invite a retry against an account that no longer exists.
    try {
      await signOut();
    } catch (err) {
      console.warn('sign-out after account deletion failed:', err);
    }
    // Everything cached belonged to an account that no longer exists.
    queryClient.clear();
    setState('idle');
  };

  const label =
    state === 'working'
      ? 'DELETING…'
      : state === 'armed'
        ? 'TAP AGAIN TO DELETE EVERYTHING'
        : state === 'failed'
          ? 'DELETION FAILED — TRY AGAIN'
          : 'DELETE ACCOUNT';

  // The spoken label tracks the visible one, state by state — a screen-reader
  // user mid-deletion deserves the same "working" and "failed" answers.
  const accessibilityLabel =
    state === 'working'
      ? 'Deleting your account'
      : state === 'armed'
        ? 'Confirm: permanently delete your account'
        : state === 'failed'
          ? 'Account deletion failed, tap to try again'
          : 'Delete your account';

  return (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: state === 'working', busy: state === 'working' }}
      onPress={() => void onPress()}
      style={[styles.ghost, { borderColor: state === 'armed' ? theme.error : theme.border }]}>
      <ThemedText type="labelSm" style={{ color: state === 'idle' ? theme.textTertiary : theme.error }}>
        {label}
      </ThemedText>
    </PressableScale>
  );
}

/** Who you are, once you are somebody. Shown on the sign-in route after it works. */
export function SignedInPanel() {
  const theme = useTheme();
  const { signedIn, displayName, signOut } = useAuth();
  if (!signedIn) return null;
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
      <Ionicons name="checkmark-circle" size={28} color={theme.primary} />
      <ThemedText type="smallBold">{displayName ? `Signed in as ${displayName}` : 'Signed in'}</ThemedText>
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={[styles.ghost, { borderColor: theme.border }]}>
        <ThemedText type="labelSm" themeColor="textSecondary">
          SIGN OUT
        </ThemedText>
      </PressableScale>
      <DeleteAccountButton />
      <ThemedText type="labelSm" style={{ color: theme.textTertiary, textAlign: 'center' }}>
        DELETING REMOVES YOUR LISTS, LOG AND SIGN-IN. THERE IS NO UNDO.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  ghost: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
