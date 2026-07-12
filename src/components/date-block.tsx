import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateParts } from '@/lib/format';

/** The "ticket stub" date block: month over day, Space Grotesk. */
export function DateBlock({ startsAt, size = 'md' }: { startsAt: string; size?: 'md' | 'lg' }) {
  const theme = useTheme();
  const { day, month } = formatEventDateParts(startsAt);
  const lg = size === 'lg';
  return (
    <View
      style={[
        styles.block,
        lg ? styles.lg : styles.md,
        { backgroundColor: theme.backgroundHigh, borderColor: theme.border },
      ]}>
      <ThemedText type="labelSm" style={[styles.month, { color: theme.primary }]}>
        {month}
      </ThemedText>
      <ThemedText type="title" style={[styles.day, { fontSize: lg ? 24 : 20 }]}>
        {day}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  md: { width: 48, height: 56 },
  lg: { width: 56, height: 64 },
  month: { letterSpacing: 1 },
  day: { lineHeight: 28 },
});
