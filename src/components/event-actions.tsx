import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { AddToListButton } from '@/components/add-to-list-button';
import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEventRsvps, useSetRsvp, type RsvpStatus } from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

/**
 * Everything that makes an upcoming show yours, in one card: going /
 * interested (with their public counts), save for later, and your shelves.
 *
 * These used to live in three corners of the page — two pills mid-scroll, a
 * bookmark in the top bar, a lone "add to list" further down — and read as
 * three unrelated features. They are one feature: your plans for the night.
 * The pills follow the change-your-mind rule everywhere else: tapping your
 * current answer clears it, and the counts name nobody.
 */
export function EventActions({
  eventId,
  subject,
  saved,
  onToggleSave,
}: {
  eventId: string;
  subject: string;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const theme = useTheme();
  const gate = useWriteGate();
  const rsvps = useEventRsvps(eventId);
  const set = useSetRsvp(eventId);

  const mine = rsvps.data?.mine ?? null;
  const counts = rsvps.data?.counts ?? { going: 0, interested: 0 };

  const guard = (why: string, act: () => void) => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny(why);
      return;
    }
    act();
  };

  const pill = (opts: {
    active: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    activeIcon?: keyof typeof Ionicons.glyphMap;
    label: string;
    count?: number;
    a11y: string;
    onPress: () => void;
  }) => (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityState={{ selected: opts.active }}
      accessibilityLabel={opts.a11y}
      onPress={opts.onPress}
      style={[
        styles.pill,
        opts.active
          ? { backgroundColor: theme.primaryFill, borderColor: theme.primaryEdge }
          : { borderColor: theme.border },
      ]}>
      <Ionicons
        name={opts.active ? (opts.activeIcon ?? opts.icon) : opts.icon}
        size={16}
        color={opts.active ? theme.primary : theme.textTertiary}
      />
      <ThemedText type="labelSm" style={{ color: opts.active ? theme.primary : theme.textSecondary }}>
        {`${opts.label.toUpperCase()}${opts.count ? ` · ${opts.count}` : ''}`}
      </ThemedText>
    </PressableScale>
  );

  const rsvpPill = (status: RsvpStatus, icon: keyof typeof Ionicons.glyphMap, label: string) =>
    pill({
      active: mine === status,
      icon,
      label,
      count: counts[status],
      a11y:
        mine === status
          ? `No longer ${label.toLowerCase()}${counts[status] ? `, ${counts[status]} so far` : ''}`
          : `${label}${counts[status] ? `, ${counts[status]} so far` : ''}`,
      onPress: () => guard('say you’re going to shows', () => set.mutate(mine === status ? null : status)),
    });

  return (
    <GlassCard style={styles.card}>
      <View style={styles.row}>
        {rsvpPill('going', 'checkmark-circle-outline', 'Going')}
        {rsvpPill('interested', 'sparkles-outline', 'Interested')}
        {pill({
          active: saved,
          icon: 'bookmark-outline',
          activeIcon: 'bookmark',
          label: 'Saved',
          a11y: saved ? `Remove ${subject} from saved` : `Save ${subject} for later`,
          onPress: () => guard('save shows for later', onToggleSave),
        })}
      </View>
      <AddToListButton refKind="event" refId={eventId} subject={subject} />
      <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
        IT ALL LANDS ON THE MY SHOWS TAB
      </ThemedText>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two + 2, padding: Spacing.three, marginHorizontal: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.two },
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
