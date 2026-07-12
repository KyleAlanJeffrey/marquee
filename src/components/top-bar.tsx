import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Glow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  onSearchPress?: () => void;
  /** Transparent variant for sitting over a full-bleed hero. */
  transparent?: boolean;
  onBack?: () => void;
};

/** The signature glass top bar with the neon MARQUEE wordmark. */
export function TopBar({ onSearchPress, transparent, onBack }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
        {onBack && (
          <Pressable onPress={onBack} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={theme.primary} />
          </Pressable>
        )}
      </View>
      <ThemedText style={[styles.wordmark, { color: theme.primary }]}>MARQUEE</ThemedText>
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
  right: { alignItems: 'flex-end' },
  wordmark: {
    fontFamily: Fonts.headline,
    fontSize: 24,
    letterSpacing: 1,
  },
});
