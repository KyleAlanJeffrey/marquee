import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  /** Accent color family. */
  tone?: 'primary' | 'cyan' | 'neutral';
};

/**
 * Semi-transparent metadata chip for genres / tags — the spec's chip exactly:
 * pill-shaped, accent text over a 12% fill of the same accent.
 */
export function GenreChip({ label, tone = 'neutral' }: Props) {
  const theme = useTheme();
  const color =
    tone === 'primary' ? theme.primary : tone === 'cyan' ? theme.cyan : theme.textSecondary;
  const bg =
    tone === 'primary' ? theme.primaryFill : tone === 'cyan' ? theme.cyanFill : 'rgba(255,255,255,0.06)';
  const border =
    tone === 'primary' ? theme.primaryEdge : tone === 'cyan' ? theme.cyanEdge : theme.border;

  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: border }]}>
      <ThemedText type="labelSm" style={[styles.text, { color }]}>
        {label.toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: { letterSpacing: 1 },
});
