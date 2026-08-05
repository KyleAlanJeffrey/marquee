import { SignIn, SignUp } from '@clerk/expo/web';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { SignInReason, SignedInPanel } from '@/components/sign-in-shared';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

// Clerk's `appearance` is plain CSS values outside React, so it can't use
// `useTheme()`. The app is dark-only today, which is what makes that safe.
const palette = Colors.dark;

/**
 * Sign in and sign up, in a browser — one screen, mounted by two routes.
 *
 * The native screens hand off to Clerk's hosted portal, which is the right shape
 * on a phone and the wrong one here — bouncing a web app out to another origin and
 * back to do something it could do in place is worse on every axis. So on web this
 * mounts Clerk's own `<SignIn>` / `<SignUp>`, which the Expo SDK re-exports for
 * exactly this platform, and which bring the CAPTCHA and every enabled strategy
 * with them.
 *
 * **The mode is the route** — `/sign-in` or `/sign-up` — never a query param.
 * It used to be `?mode=sign-up`, and that was a live bug, not just an ugly URL:
 * Clerk's hash router navigates to `#/verify-email-address` mid-sign-up, the
 * query param didn't survive the trip, and the screen obligingly swapped the
 * card back to SignIn — stranding a half-finished sign-up, which then bounced
 * out to the hosted Account Portal. A path can't fall off its own URL.
 *
 * They are themed rather than accepted as-is: Clerk's default look is a white
 * card, and dropping one into Electric Stage would read as a third-party iframe.
 * The `appearance` variables below are the palette from `constants/theme`, so
 * this screen stays wrong-looking only if the palette changes without it.
 */
const appearance = {
  variables: {
    colorBackground: palette.backgroundElevated,
    colorInputBackground: palette.backgroundLowest,
    colorPrimary: palette.primary,
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorInputText: palette.text,
    colorDanger: palette.error,
    colorSuccess: palette.primary,
    colorNeutral: palette.text,
    borderRadius: '4px',
    fontFamily: Fonts.body,
  },
  elements: {
    // The card supplies its own surface; ours is already behind it.
    cardBox: { boxShadow: 'none', border: `1px solid ${palette.border}` },
    footer: { background: 'transparent' },
  },
} as const;

export type AuthMode = 'sign-in' | 'sign-up';

/**
 * Where a completed sign-in or sign-up lands: the Profile tab, which now opens
 * on your own profile — the first concrete thing an account buys.
 *
 * Every redirect and cross-link below is stated explicitly because the defaults
 * are the bug: without them, Clerk's card links its own "sign up" footer to the
 * hosted Account Portal, and a finished sign-up follows the portal's defaults
 * off-site too. The session then lives on Clerk's origin, the app never sees it,
 * and the server never hears about the new account at all — which is exactly
 * the "signed up but nothing in the db" report that found this.
 */
const AFTER_AUTH = '/settings';

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const theme = useTheme();
  const { why } = useLocalSearchParams<{ why?: string }>();
  const { signedIn } = useAuth();

  // Clerk renders cross-links as plain hrefs, so `why` — the reason copy above
  // the card — has to be carried by hand or the navigation drops it.
  const link = (m: AuthMode) => `/${m}${why ? `?${new URLSearchParams({ why })}` : ''}`;

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title={mode === 'sign-up' ? 'Create your account' : 'Your account'}
        description="Sign in to keep the shows and artists you care about."
      />
      <StageBackground />
      <View style={styles.body}>
        <SignInReason why={why} />
        <SignedInPanel />

        {signedIn ? null : (
          <>
            {/* The switcher navigates between the two routes rather than
                flipping local state: the URL is the mode, everywhere, always. */}
            <View style={styles.switcher}>
              {(['sign-in', 'sign-up'] as const).map((m) => (
                <PressableScale
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={m === 'sign-in' ? 'Sign in to an existing account' : 'Create an account'}
                  accessibilityState={{ selected: mode === m }}
                  onPress={() => {
                    if (m !== mode) router.replace(link(m) as never);
                  }}
                  style={[
                    styles.tab,
                    mode === m
                      ? { backgroundColor: theme.primaryFill, borderColor: theme.primaryEdge }
                      : { borderColor: theme.border },
                  ]}>
                  <ThemedText type="labelSm" style={{ color: mode === m ? theme.primary : theme.textSecondary }}>
                    {m === 'sign-in' ? 'I HAVE AN ACCOUNT' : 'CREATE ONE'}
                  </ThemedText>
                </PressableScale>
              ))}
            </View>
            <View style={styles.clerk}>
              {/* Hash routing for the steps *within* a card: the path names the
                  card, the hash names the step, and neither can clobber the
                  other. Path routing here would need a catch-all route. */}
              {mode === 'sign-in' ? (
                <SignIn
                  routing="hash"
                  appearance={appearance}
                  signUpUrl={link('sign-up')}
                  fallbackRedirectUrl={AFTER_AUTH}
                />
              ) : (
                <SignUp
                  routing="hash"
                  appearance={appearance}
                  signInUrl={link('sign-in')}
                  fallbackRedirectUrl={AFTER_AUTH}
                />
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  switcher: { flexDirection: 'row', gap: Spacing.two },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  clerk: { alignItems: 'center' },
});
