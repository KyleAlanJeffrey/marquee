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
import { Radius, Spacing, Spring } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  following: boolean;
  onToggle: () => void;
  /** Compact icon-only pill (used in dense rows). */
  compact?: boolean;
};

export function FollowButton({ following, onToggle, compact = false }: Props) {
  const theme = useTheme();
  const pop = useSharedValue(1);

  // A little celebratory pop whenever the state flips.
  useEffect(() => {
    pop.value = withSequence(
      withSpring(1.12, Spring.snappy),
      withSpring(1, Spring.snappy),
    );
  }, [following, pop]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View style={animatedStyle}>
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
            ? { backgroundColor: theme.backgroundSelected }
            : { backgroundColor: theme.tint },
        ]}>
        <Ionicons
          name={following ? 'checkmark' : 'add'}
          size={16}
          color={following ? theme.text : theme.onTint}
        />
        {!compact && (
          <ThemedText type="smallBold" style={{ color: following ? theme.text : theme.onTint }}>
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
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    minWidth: 108,
  },
  compact: {
    minWidth: 0,
    width: 38,
    height: 38,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
});
