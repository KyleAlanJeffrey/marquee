import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Spring } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  children: ReactNode;
  /** How far to scale down on press. */
  scaleTo?: number;
  /** Fire a light haptic on press-in (native only). */
  haptic?: boolean;
  style?: ViewStyle | ViewStyle[];
};

/**
 * A Pressable that springs down slightly while held — the tactile feedback
 * that makes the whole app feel alive. Optional light haptic on press.
 */
export function PressableScale({
  children,
  scaleTo = 0.96,
  haptic = true,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        scale.value = withSpring(scaleTo, Spring.snappy);
        if (haptic && Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        scale.value = withSpring(1, Spring.snappy);
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}>
      {children}
    </AnimatedPressable>
  );
}
