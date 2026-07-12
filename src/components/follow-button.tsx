import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing, Spring } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  following: boolean;
  onToggle: () => void;
  compact?: boolean;
};

/** Ghost border when unfollowed → solid electric purple + neon glow when following. */
export function FollowButton({ following, onToggle, compact = false }: Props) {
  const theme = useTheme();
  const pop = useSharedValue(1);

  useEffect(() => {
    pop.value = withSequence(withSpring(1.12, Spring.snappy), withSpring(1, Spring.snappy));
  }, [following, pop]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View style={[animatedStyle, following && Glow.purple]}>
      <PressableScale
        haptic={false}
        onPress={() => {
          if (Platform.OS !== 'web') {
            Haptics.impactAsync(
              following ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
            ).catch(() => {});
          }
          onToggle();
        }}
        style={[
          styles.button,
          compact && styles.compact,
          following
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { backgroundColor: 'transparent', borderColor: theme.primary },
        ]}>
        <Ionicons
          name={following ? 'heart' : 'heart-outline'}
          size={16}
          color={following ? theme.onPrimary : theme.primary}
        />
        {!compact && (
          <ThemedText
            type="label"
            style={[styles.label, { color: following ? theme.onPrimary : theme.primary }]}>
            {following ? 'Following' : 'Follow'}
          </ThemedText>
        )}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.three + 4,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    minWidth: 132,
  },
  compact: {
    minWidth: 0,
    width: 40,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  label: { fontSize: 13, letterSpacing: 0.5 },
});
