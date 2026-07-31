import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-logo';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Glow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  onSearchPress?: () => void;
  /** Transparent variant for sitting over a full-bleed hero. */
  transparent?: boolean;
  /** Show a back chevron (falls back to Home when there's no history). */
  back?: boolean;
  /** Contextual page label shown in place of the MARQUEE wordmark. */
  title?: string;
  /** Page-level control for the right slot, in place of the search icon. */
  action?: ReactNode;
};

/**
 * The signature glass top bar.
 *
 * Both of its states are set hard left, with the controls on the right — a
 * centred label reads like a system-supplied navigation bar, and this is the one
 * piece of chrome on every screen, so it's worth having a voice.
 *
 * The wordmark is ExtraBold caps and the page title is the display face, which is
 * the only place that face appears outside a hero. It earns it: a title here is
 * one short word ("Artist", "Venue", "Map"), so the caps italic has nothing long
 * enough to shout at, and it stops every screen opening on the same small grey
 * tracked label.
 */
export function TopBar({ onSearchPress, transparent, back, title, action }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/explore'));

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top, height: 60 + insets.top },
        !transparent && {
          backgroundColor: theme.glass,
          borderBottomColor: theme.border,
          borderBottomWidth: 1,
          ...Glow.primary,
          shadowOpacity: 0.12,
        },
      ]}>
      {back && (
        <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.primary} />
        </Pressable>
      )}
      {title ? (
        <ThemedText type="display" numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {title}
        </ThemedText>
      ) : (
        <View style={styles.brand}>
          <BrandMark size={28} />
          <ThemedText style={[styles.wordmark, { color: theme.primary }]}>Marquee</ThemedText>
        </View>
      )}
      <View style={styles.right}>
        {/* `!== undefined` rather than `??`: a screen that passes `null` is asking
            for an empty slot, and `??` would hand it the search icon instead. */}
        {action !== undefined
          ? action
          : onSearchPress && (
              <Pressable onPress={onSearchPress} hitSlop={10}>
                <Ionicons name="search" size={22} color={theme.primary} />
              </Pressable>
            )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  // Pulled left so the chevron's optical edge lines up with the content below it
  // rather than the padding box.
  backBtn: { width: 34, height: 40, justifyContent: 'center', marginLeft: -Spacing.two },
  // Takes the slack, which is what keeps the actions pinned right without the bar
  // needing space-between and a phantom spacer on the left.
  right: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wordmark: {
    fontFamily: Fonts.labelBold,
    fontSize: 22,
    letterSpacing: -0.6,
    textTransform: 'uppercase',
  },
  title: {
    // Smaller than the 40px `display` default: this is chrome, and it sits beside
    // a back chevron rather than opening a page.
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -1,
    // Titles ride over a full-bleed hero on the detail screens.
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
});
