import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatPrice, formatRelativeDay, formatTime, formatVenue } from '@/lib/format';
import type { NearbyEvent } from '@/lib/types';

/** Rich horizontal card for the "Trending Nearby" list. */
export function SecondaryEventCard({
  event,
  following,
  onPress,
}: {
  event: NearbyEvent;
  following: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const genre = event.artist_genres?.[0];
  const distance = formatDistance(event.distance_miles);

  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElevated, borderColor: following ? 'rgba(0,219,233,0.35)' : theme.border },
      ]}>
      <Image
        source={event.artist_image_url ? { uri: event.artist_image_url } : undefined}
        style={[styles.img, { backgroundColor: theme.backgroundHigh }]}
        contentFit="cover"
        transition={200}
      />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <ThemedText type="labelSm" style={{ color: theme.primary, flex: 1 }} numberOfLines={1}>
            {[genre?.toUpperCase(), `${formatRelativeDay(event.starts_at)}, ${formatTime(event.starts_at)}`]
              .filter(Boolean)
              .join(' • ')}
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: theme.text }}>
            {formatPrice(event.price_from)}
          </ThemedText>
        </View>
        <ThemedText type="title" numberOfLines={1} style={styles.name}>
          {event.artist_name}
        </ThemedText>
        <View style={styles.venueRow}>
          <Ionicons name="business" size={13} color={theme.textTertiary} />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
          </ThemedText>
        </View>
        {distance && (
          <View style={styles.bottomRow}>
            <View style={[styles.distChip, { backgroundColor: 'rgba(0,219,233,0.1)' }]}>
              <Ionicons name="navigate" size={12} color={theme.cyan} />
              <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                {distance.toUpperCase()}
              </ThemedText>
            </View>
            <View style={styles.details}>
              <ThemedText type="labelSm" style={{ color: theme.primary }}>
                DETAILS
              </ThemedText>
              <Ionicons name="chevron-forward" size={13} color={theme.primary} />
            </View>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  img: { width: 92, height: 92, borderRadius: Radius.sm },
  body: { flex: 1, justifyContent: 'center', gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { fontSize: 18 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  distChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 3,
    borderRadius: Radius.xs,
  },
  details: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
