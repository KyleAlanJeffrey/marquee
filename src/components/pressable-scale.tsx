import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Colors, Spring } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  children: ReactNode;
  /** How far to scale down on press. */
  scaleTo?: number;
  /** Fire a light haptic on press-in (native only). */
  haptic?: boolean;
  /**
   * Light a 4px primary bar down the left edge while held.
   *
   * This is the design language's rule for lists — rows divided by a hairline,
   * picked out on interaction by a full-strength left edge. It's for rows in a
   * divided list, not for cards, which say the same thing with their border.
   */
  edgeAccent?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A Pressable that springs down slightly while held — the tactile feedback
 * that makes the whole app feel alive. Optional light haptic on press.
 */
export function PressableScale({
  children,
  scaleTo = 0.96,
  haptic = true,
  edgeAccent = false,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const held = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: held.value }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        scale.value = withSpring(scaleTo, Spring.snappy);
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        held.value = withSpring(1, Spring.snappy);
        if (haptic && Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        scale.value = withSpring(1, Spring.snappy);
        // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
        held.value = withSpring(0, Spring.snappy);
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}>
      {children}
      {edgeAccent ? <Animated.View pointerEvents="none" style={[styles.edge, edgeStyle]} /> : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // Absolute so lighting up costs no reflow, and the row doesn't shift under the
  // thumb that's pressing it.
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.dark.primary,
  },
});
