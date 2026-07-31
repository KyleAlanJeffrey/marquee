import { SignIn, SignUp } from '@clerk/expo/web';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
 * Sign in, in a browser.
 *
 * The native screen hands off to Clerk's hosted portal, which is the right shape on
 * a phone and the wrong one here — bouncing a web app out to another origin and back
 * to do something it could do in place is worse on every axis. So on web this mounts
 * Clerk's own `<SignIn>` / `<SignUp>`, which the Expo SDK re-exports for exactly this
 * platform, and which bring the CAPTCHA and every enabled strategy with them.
 *
 * They are themed rather than accepted as-is: Clerk's default look is a white card,
 * and dropping one into Electric Stage would read as a third-party iframe. The
 * `appearance` variables below are the palette from `constants/theme`, so this
 * screen stays wrong-looking only if the palette changes without it.
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

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const theme = useTheme();
  const { why } = useLocalSearchParams<{ why?: string }>();
  const { signedIn } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Your account"
        description="Sign in to keep the shows and artists you care about."
      />
      <StageBackground />
      <View style={styles.body}>
        <SignInReason why={why} />
        <SignedInPanel />

        {signedIn ? null : (
          <>
            {/* Two routeless components rather than Clerk's own routing: this screen
                is a modal over whatever you were doing, and handing path control to
                a library inside a modal is how you end up unable to close it. */}
            <View style={styles.switcher}>
              {(['sign-in', 'sign-up'] as const).map((m) => (
                <PressableScale
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={m === 'sign-in' ? 'Sign in to an existing account' : 'Create an account'}
                  accessibilityState={{ selected: mode === m }}
                  onPress={() => setMode(m)}
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
              {mode === 'sign-in' ? (
                <SignIn routing="hash" appearance={appearance} />
              ) : (
                <SignUp routing="hash" appearance={appearance} />
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
