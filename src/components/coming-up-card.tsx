import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateBlock } from '@/components/date-block';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatVenue } from '@/lib/format';
import { scheduleOneOffReminder } from '@/lib/reminders';
import type { NearbyEvent } from '@/lib/types';

/** A card in the horizontal "Coming Up" rail, with an inline Remind Me toggle. */
export function ComingUpCard({ event, onPress }: { event: NearbyEvent; onPress: () => void }) {
  const theme = useTheme();
  const [reminded, setReminded] = useState(false);

  async function remind() {
    const ok = await scheduleOneOffReminder(event);
    setReminded(ok);
  }

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <View style={styles.top}>
        <DateBlock startsAt={event.starts_at} />
        <View style={[styles.iconBtn, { backgroundColor: theme.backgroundHigh }]}>
          <Ionicons name="musical-notes" size={16} color={theme.primary} />
        </View>
      </View>
      <View style={styles.mid}>
        <ThemedText type="title" numberOfLines={1} style={{ fontSize: 18 }}>
          {event.artist_name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
        </ThemedText>
      </View>
      <PressableScale
        haptic
        onPress={remind}
        style={[
          styles.remind,
          reminded
            ? { backgroundColor: theme.cyan, borderColor: theme.cyan }
            : { borderColor: theme.primary },
        ]}>
        <Ionicons
          name={reminded ? 'notifications' : 'notifications-outline'}
          size={14}
          color={reminded ? '#00363a' : theme.primary}
        />
        <ThemedText type="label" style={{ color: reminded ? '#00363a' : theme.primary, fontSize: 12 }}>
          {reminded ? 'Reminder set' : 'Remind Me'}
        </ThemedText>
      </PressableScale>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 264,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { gap: 3 },
  remind: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
});
