import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatRelativeDay } from '@/lib/format';
import type { NearbyVenue } from '@/lib/types';

export const placeOf = (city: string | null, region: string | null) =>
  [city, region].filter(Boolean).join(', ');

/**
 * Fixed-width tile for a horizontal venue rail. Venues have no artwork of their
 * own, so the identity is the name plus how much is on there.
 */
export function VenueTile({ venue, onPress }: { venue: NearbyVenue; onPress: () => void }) {
  const theme = useTheme();
  const distance = formatDistance(venue.distance_miles);
  const place = placeOf(venue.city, venue.region);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}${place ? `, ${place}` : ''}, ${venue.upcoming} upcoming shows`}
      style={[styles.tile, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <View style={[styles.tileIcon, { backgroundColor: 'rgba(0,219,233,0.1)' }]}>
        <Ionicons name="business" size={20} color={theme.cyan} />
      </View>
      <ThemedText type="smallBold" numberOfLines={2} style={styles.tileName}>
        {venue.name}
      </ThemedText>
      {place ? (
        <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textTertiary }}>
          {place.toUpperCase()}
        </ThemedText>
      ) : null}
      <View style={styles.tileFoot}>
        <ThemedText type="labelSm" style={{ color: theme.primary }}>
          {venue.upcoming} {venue.upcoming === 1 ? 'SHOW' : 'SHOWS'}
        </ThemedText>
        {distance ? (
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {distance.toUpperCase()}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textSecondary }}>
        NEXT {formatRelativeDay(venue.next_at, venue.timezone).toUpperCase()}
      </ThemedText>
    </PressableScale>
  );
}

/** Full-width list row for a venue, with room for a trailing control. */
export function VenueRow({
  name,
  place,
  meta,
  onPress,
  trailing,
}: {
  name: string;
  place: string;
  meta?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const theme = useTheme();

  return (
    // The row and its trailing control are siblings, not nested pressables: a
    // button inside a button is invalid DOM on web and swallows one of the taps.
    <View style={[styles.row, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <PressableScale
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `${name}${place ? `, ${place}` : ''}` : undefined}
        style={styles.rowMain}>
        <View style={[styles.rowIcon, { backgroundColor: 'rgba(0,219,233,0.1)' }]}>
          <Ionicons name="business" size={18} color={theme.cyan} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textTertiary }}>
            {[place, meta].filter(Boolean).join(' • ').toUpperCase()}
          </ThemedText>
        </View>
      </PressableScale>
      {trailing ?? <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 170,
    gap: Spacing.one,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  // Two lines of a venue name at a fixed tile width, so tiles stay aligned
  // whether the room is "Fox" or "Bill Graham Civic Auditorium".
  tileName: { minHeight: 34 },
  tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
