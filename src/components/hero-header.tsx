import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  /** Location line, e.g. "San Francisco, CA". Falls back to a locating hint. */
  locationLabel?: string | null;
  /** Optional top-right search affordance. */
  onSearchPress?: () => void;
  children?: ReactNode;
};

/**
 * The app's signature spotlight-gradient header. Rounds off at the bottom and
 * fades/slides its contents in on mount.
 */
export function HeroHeader({ title, locationLabel, onSearchPress, children }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={theme.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { paddingTop: insets.top + Spacing.two }]}>
      <Animated.View entering={FadeInDown.duration(500)} style={styles.titleRow}>
        <ThemedText style={[styles.title, { color: theme.onGradient }]}>{title}</ThemedText>
        {onSearchPress && (
          <Pressable
            onPress={onSearchPress}
            hitSlop={10}
            style={[styles.searchBtn, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Ionicons name="search" size={20} color={theme.onGradient} />
          </Pressable>
        )}
      </Animated.View>
      <Animated.View entering={FadeIn.delay(150).duration(500)} style={styles.locationRow}>
        <Ionicons name="location" size={15} color={theme.onGradientMuted} />
        <ThemedText style={[styles.location, { color: theme.onGradientMuted }]}>
          {locationLabel ?? 'Finding your area…'}
        </ThemedText>
      </Animated.View>
      {children ? (
        <Animated.View entering={FadeIn.delay(250).duration(500)} style={styles.children}>
          {children}
        </Animated.View>
      ) : (
        <View style={styles.spacer} />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  location: { fontSize: 15, fontWeight: '600' },
  spacer: { height: Spacing.two },
  children: { marginTop: Spacing.three },
});
