import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The one tap that finishes a capped list (see `useCappedList`) — a ghost row
 * where the hidden rows would have started. Always says how much it's holding
 * ("SHOW 34 MORE"), because a bare "show more" makes the reader guess whether
 * the tap is worth it.
 */
export function ShowAllButton({
  hidden,
  /** What the rows are, for the label: "SHOWS" → "SHOW 34 MORE SHOWS". */
  noun,
  onPress,
}: {
  hidden: number;
  noun?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const label = `SHOW ${hidden} MORE${noun ? ` ${noun}` : ''}`;
  return (
    <PressableScale
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={`Show ${hidden} more${noun ? ` ${noun.toLowerCase()}` : ''}`}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}>
      <ThemedText type="labelSm" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Ionicons name="chevron-down" size={14} color={theme.textTertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginTop: Spacing.one,
  },
});
