import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateParts } from '@/lib/format';

/** The "ticket stub" date block: month over day. */
export function DateBlock({
  startsAt,
  size = 'md',
  timeZone,
}: {
  startsAt: string;
  size?: 'md' | 'lg';
  /** The venue's zone, so a late show shows the venue's date, not the reader's. */
  timeZone?: string | null;
}) {
  const theme = useTheme();
  const { day, month } = formatEventDateParts(startsAt, timeZone);
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
