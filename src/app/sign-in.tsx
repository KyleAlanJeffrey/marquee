import Ionicons from '@expo/vector-icons/Ionicons';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { SignInReason, SignedInPanel } from '@/components/sign-in-shared';

/**
 * Sign in, on a phone.
 *
 * This hands off to Clerk's hosted Account Portal in a browser session rather than
 * building the forms here, and that is a considered choice, not a shortcut:
 *
 * - **It offers whatever the instance has enabled, with no code here.** Turning on
 *   Sign in with Apple (required by App Store rules once Google is offered) or
 *   Spotify is then a dashboard change and nothing else. A hand-built screen would
 *   need a new button, a new strategy string and a new release for each.
 * - **Bot protection works.** The instance has `captcha_enabled: true`, and Clerk's
 *   smart CAPTCHA needs a real web context. Custom native flows are where that
 *   fights you; the hosted page is where it already works.
 * - **Account deletion comes with it.** The instance allows `delete_self`, and
 *   Apple requires in-app deletion for any app with accounts. The portal has it.
 *
 * The Android redirect back into the app needs the `@clerk/expo` config plugin,
 * which is in `app.json` — but it only takes effect in a real native build, so this
 * path cannot be exercised in Expo Go or on web. The web build has its own file.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const { why } = useLocalSearchParams<{ why?: string }>();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      const { createdSessionId } = await startHostedAuth();
      // Null means they closed the browser without finishing, which is a normal
      // thing to do and not an error worth shouting about.
      if (createdSessionId) router.back();
    } catch (err) {
      console.warn('sign-in: hosted auth failed', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title="Your account" description="Sign in to keep the shows and artists you care about." />
      <StageBackground />
      <View style={styles.body}>
        <SignInReason why={why} />

        <PressableScale
          haptic
          accessibilityRole="button"
          accessibilityLabel="Continue to sign in"
          disabled={busy}
          onPress={open}
          style={[styles.cta, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
          {busy ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={18} color={theme.background} />
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                CONTINUE
              </ThemedText>
            </>
          )}
        </PressableScale>

        {failed ? (
          <ThemedText type="small" style={{ color: theme.error }}>
            That didn&apos;t work. Check your connection and try again.
          </ThemedText>
        ) : null}

        <SignedInPanel />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: Spacing.three, gap: Spacing.three, justifyContent: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
  },
});
