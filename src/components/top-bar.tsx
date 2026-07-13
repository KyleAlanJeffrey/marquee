import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
};

/** The signature glass top bar with the neon MARQUEE wordmark. */
export function TopBar({ onSearchPress, transparent, back, title }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top, height: 56 + insets.top },
        !transparent && {
          backgroundColor: theme.glass,
          borderBottomColor: theme.border,
          borderBottomWidth: 1,
          ...Glow.purple,
          shadowOpacity: 0.12,
        },
      ]}>
      <View style={styles.side}>
        {back && (
          <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={theme.primary} />
          </Pressable>
        )}
      </View>
      {title ? (
        <ThemedText numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {title}
        </ThemedText>
      ) : (
        <ThemedText style={[styles.wordmark, { color: theme.primary }]}>MARQUEE</ThemedText>
      )}
      <View style={[styles.side, styles.right]}>
        {onSearchPress && (
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  side: { width: 40, justifyContent: 'center' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  wordmark: {
    fontFamily: Fonts.headline,
    fontSize: 24,
    letterSpacing: 1,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.label,
    fontSize: 15,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
});
