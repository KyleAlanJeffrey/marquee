import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatRelativeDay, formatVenue } from '@/lib/format';
import type { NearbyEvent } from '@/lib/types';

/** Bento secondary card used under the "This Weekend" hero. */
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
        {genre && (
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            {genre.toUpperCase()}
          </ThemedText>
        )}
        <ThemedText type="title" numberOfLines={1} style={styles.name}>
          {event.artist_name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
        </ThemedText>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={13} color={theme.cyan} />
          <ThemedText type="labelSm" style={{ color: theme.cyan }}>
            {formatRelativeDay(event.starts_at).toUpperCase()}
            {distance ? `  ·  ${distance.toUpperCase()}` : ''}
          </ThemedText>
        </View>
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
  img: { width: 88, height: 88, borderRadius: Radius.sm },
  body: { flex: 1, justifyContent: 'center', gap: 3 },
  name: { fontSize: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, marginTop: 2 },
});
