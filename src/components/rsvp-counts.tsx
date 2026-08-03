import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * "2 GOING · 5 INTERESTED" — the first number on a card that makes a show
 * feel like a place people will actually be (the same argument migration
 * 0015 made for counting from both ends).
 *
 * Renders nothing at zero, on purpose: a catalogue this young is mostly
 * zeroes, and a wall of "0 GOING" reads as a ghost town — absence of proof
 * beats proof of absence. Counts arrive on the event payloads themselves
 * (optional fields, so saved-show snapshots that never carried them stay
 * renderable).
 */
export function RsvpCounts({ going, interested }: { going?: number; interested?: number }) {
  const theme = useTheme();
  const parts = [
    going ? `${going} GOING` : null,
    interested ? `${interested} INTERESTED` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={parts.join(', ').toLowerCase()}>
      <Ionicons name="people" size={12} color={theme.cyan} />
      <ThemedText type="labelSm" style={{ color: theme.cyan }} numberOfLines={1}>
        {parts.join(' · ')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
