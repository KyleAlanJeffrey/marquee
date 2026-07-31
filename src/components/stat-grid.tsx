import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Oversized numerals with a small caps label under them, from the reference's
 * "30 YEARS ACTIVE / 08 STUDIO ALBUMS" treatment.
 *
 * The numbers are the point, so they get the display face at a size nothing else
 * on the screen uses. Two per row: at 375pt three columns leave "SEP" and "128"
 * looking like a table, and the whole effect is that a number is worth reading.
 */
export type Stat = { value: string; label: string; accent?: boolean };

export function StatGrid({ stats }: { stats: Stat[] }) {
  const theme = useTheme();
  if (stats.length === 0) return null;
  return (
    <View style={styles.grid}>
      {stats.map((s) => (
        <View
          key={s.label}
          style={[styles.cell, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
          <ThemedText
            type="display"
            numberOfLines={1}
            // Shrinks rather than truncates: "1,240" must not become "1,2…".
            adjustsFontSizeToFit
            style={[styles.value, { color: s.accent ? theme.primary : theme.text }]}>
            {s.value}
          </ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {s.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  cell: {
    // Two per row, accounting for the gap between them.
    flexBasis: '48%',
    flexGrow: 1,
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  value: { fontSize: 34, lineHeight: 38, letterSpacing: -1.5 },
});
