import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  /** Accent color family. */
  tone?: 'purple' | 'cyan' | 'neutral';
};

/** Semi-transparent metadata chip for genres / tags. */
export function GenreChip({ label, tone = 'neutral' }: Props) {
  const theme = useTheme();
  const color =
    tone === 'purple' ? theme.primary : tone === 'cyan' ? theme.cyan : theme.textSecondary;
  const bg =
    tone === 'purple'
      ? 'rgba(236,178,255,0.12)'
      : tone === 'cyan'
        ? 'rgba(0,219,233,0.12)'
        : 'rgba(255,255,255,0.06)';
  const border =
    tone === 'purple'
      ? 'rgba(236,178,255,0.3)'
      : tone === 'cyan'
        ? 'rgba(0,219,233,0.3)'
        : theme.border;

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
