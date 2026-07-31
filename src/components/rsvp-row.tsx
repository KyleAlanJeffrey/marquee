import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEventRsvps, useSetRsvp, type RsvpStatus } from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

/**
 * Going / Interested, on a show that hasn't happened yet.
 *
 * Two pills, each carrying its public count — "12 going" is the first number
 * on the site that makes a show feel like somewhere people will actually be.
 * Tapping your current answer clears it (the same change-your-mind rule as the
 * star ratings), and the counts name nobody: the server publishes totals and
 * tells only you which one is yours.
 */
export function RsvpRow({ eventId }: { eventId: string }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const rsvps = useEventRsvps(eventId);
  const set = useSetRsvp(eventId);

  const mine = rsvps.data?.mine ?? null;
  const counts = rsvps.data?.counts ?? { going: 0, interested: 0 };

  const choose = (status: RsvpStatus) => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('say you’re going to shows');
      return;
    }
    set.mutate(mine === status ? null : status);
  };

  const pill = (status: RsvpStatus, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const active = mine === status;
    const n = counts[status];
    return (
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={
          active
            ? `No longer ${label.toLowerCase()}${n ? `, ${n} so far` : ''}`
            : `${label}${n ? `, ${n} so far` : ''}`
        }
        onPress={() => choose(status)}
        style={[
          styles.pill,
          active
            ? { backgroundColor: theme.primaryFill, borderColor: theme.primaryEdge }
            : { borderColor: theme.border },
        ]}>
        <Ionicons name={icon} size={16} color={active ? theme.primary : theme.textTertiary} />
        <ThemedText type="labelSm" style={{ color: active ? theme.primary : theme.textSecondary }}>
          {`${label.toUpperCase()}${n > 0 ? ` · ${n}` : ''}`}
        </ThemedText>
      </PressableScale>
    );
  };

  return (
    <View style={styles.row}>
      {pill('going', 'checkmark-circle-outline', 'Going')}
      {pill('interested', 'sparkles-outline', 'Interested')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
