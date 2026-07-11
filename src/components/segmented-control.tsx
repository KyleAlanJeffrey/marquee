import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Spring } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Segment = { key: string; label: string; badge?: number };

type Props = {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
};

/**
 * A pill segmented control with a spring-animated selection indicator that
 * slides between segments.
 */
export function SegmentedControl({ segments, value, onChange }: Props) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useSharedValue(0);

  const segWidth = trackWidth > 0 ? (trackWidth - PADDING * 2) / segments.length : 0;
  const activeIndex = Math.max(0, segments.findIndex((s) => s.key === value));

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: segWidth,
  }));

  function onLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    const sw = (w - PADDING * 2) / segments.length;
    // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
    x.value = activeIndex * sw; // set immediately on first measure
  }

  function select(index: number, key: string) {
    // eslint-disable-next-line react-hooks/immutability -- reanimated shared value write
    x.value = withSpring(index * segWidth, Spring.snappy);
    onChange(key);
  }

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {segWidth > 0 && (
        <Animated.View
          style={[styles.indicator, { backgroundColor: theme.background }, indicatorStyle]}
        />
      )}
      {segments.map((seg, i) => {
        const active = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => select(i, seg.key)}
            style={styles.segment}>
            <ThemedText
              type="smallBold"
              style={{ color: active ? theme.text : theme.textSecondary }}>
              {seg.label}
            </ThemedText>
            {seg.badge != null && seg.badge > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                <ThemedText style={[styles.badgeText, { color: theme.onTint }]}>
                  {seg.badge}
                </ThemedText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const PADDING = 4;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    padding: PADDING,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: Radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two + 2,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
