import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateParts, formatPrice, formatVenue } from '@/lib/format';
import { scheduleOneOffReminder } from '@/lib/reminders';
import type { NearbyEvent } from '@/lib/types';

/** A card in the horizontal "Coming Up Next" rail, with an inline reminder bell. */
export function ComingUpCard({ event, onPress }: { event: NearbyEvent; onPress: () => void }) {
  const theme = useTheme();
  const [reminded, setReminded] = useState(false);
  const { day, month } = formatEventDateParts(event.starts_at);

  async function remind() {
    const ok = await scheduleOneOffReminder(event);
    setReminded(ok);
  }

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <View style={styles.imageWrap}>
        <Image
          source={event.artist_image_url ? { uri: event.artist_image_url } : undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
        />
        <View style={styles.imageScrim} />
        <View style={[styles.dateChip, { backgroundColor: 'rgba(0,0,0,0.45)', borderColor: theme.border }]}>
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            {month}
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: '#fff' }}>
            {day}
          </ThemedText>
        </View>
      </View>
      <View style={styles.body}>
        <ThemedText type="title" numberOfLines={1} style={{ fontSize: 17 }}>
          {event.artist_name}
        </ThemedText>
        <View style={styles.venueRow}>
          <Ionicons name="location" size={13} color={theme.textTertiary} />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
          </ThemedText>
        </View>
        <View style={styles.footer}>
          <ThemedText type="smallBold" style={{ color: theme.cyan }}>
            {formatPrice(event.price_from)}
          </ThemedText>
          <Pressable
            onPress={remind}
            hitSlop={8}
            style={[
              styles.bell,
              reminded
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { borderColor: theme.border },
            ]}>
            <Ionicons
              name={reminded ? 'notifications' : 'notifications-outline'}
              size={16}
              color={reminded ? theme.onPrimary : '#fff'}
            />
          </Pressable>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageWrap: { height: 128 },
  imageScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  dateChip: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    minWidth: 42,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  body: { padding: Spacing.three, gap: Spacing.one },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  bell: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
