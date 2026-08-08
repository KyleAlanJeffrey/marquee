import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How often to compare the running bundle against the deployed one. */
const CHECK_MS = 5 * 60 * 1000;

/** What the entry bundle's filename looks like, in the shell and in the DOM. */
const ENTRY = /entry-[0-9a-f]+\.js/;

/**
 * "A new version is live — refresh." Web only.
 *
 * The web app is an SPA: every navigation after the first is client-side, so
 * a tab keeps the bundle it booted with until someone reloads it — deploys
 * change what the *next* visitor gets, never what an open tab runs. In
 * practice tabs live for days, and three times now a "the site is broken /
 * nothing changed" report traced to a tab several deploys behind.
 *
 * The check is the cheapest true one: fetch the current route's HTML shell
 * (`no-store`, and the shells already ship `max-age=0, must-revalidate`) and
 * compare the `entry-*.js` filename it references against the one this tab is
 * actually running. Expo content-hashes the entry bundle, so a different name
 * IS a different build — no version endpoint to maintain, nothing extra
 * deployed. Checked every five minutes, and on tab focus, because "came back
 * to a day-old tab" is exactly the stale case.
 *
 * A banner with a button rather than a silent reload: reloading under
 * someone mid-scroll (or mid-review-draft) to fix a problem they don't know
 * they have is worse than the problem.
 */
export function UpdateNudge() {
  const theme = useTheme();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const running = [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
      .map((s) => s.src.match(ENTRY)?.[0])
      .find(Boolean);
    if (!running) return; // dev server or an unexpected shell — nothing to compare

    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(window.location.pathname, { cache: 'no-store' });
        if (!res.ok) return;
        const served = (await res.text()).match(ENTRY)?.[0];
        // Only a *different* name means stale. A missing match means the
        // shell didn't parse as expected; silence beats a false alarm.
        if (!cancelled && served && served !== running) setStale(true);
      } catch {
        // Offline or flaky — the nudge can wait for the next pass.
      }
    };

    const timer = setInterval(check, CHECK_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!stale) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.banner, { backgroundColor: theme.backgroundElevated, borderColor: theme.primaryEdge }]}>
        <ThemedText type="labelSm" style={{ color: theme.textSecondary, flex: 1 }}>
          A NEW VERSION OF MARQUEE IS LIVE
        </ThemedText>
        <PressableScale
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Reload to update Marquee"
          onPress={() => window.location.reload()}
          style={[styles.button, { borderColor: theme.primary }]}>
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            REFRESH
          </ThemedText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Floats above the tab bar; box-none so the page stays scrollable around it.
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 64 + Spacing.two,
    alignItems: 'center',
    zIndex: 100,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: 460,
    marginHorizontal: Spacing.three,
  },
  button: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
