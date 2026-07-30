import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered after the label, e.g. a follow count. */
  count?: number;
};

type Props<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the whole control switches, for screen readers ("view"). */
  label?: string;
};

/** Pill switch between two or three views of the same screen. */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.track, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            haptic={false}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: theme.primary }]}>
            <ThemedText
              type="label"
              style={{ color: active ? theme.onPrimary : theme.textSecondary, fontSize: 12 }}>
              {o.label.toUpperCase()}
              {o.count != null ? ` ${o.count}` : ''}
            </ThemedText>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
