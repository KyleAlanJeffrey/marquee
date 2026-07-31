import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
