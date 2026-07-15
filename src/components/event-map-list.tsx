import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { SecondaryEventCard } from '@/components/secondary-event-card';
import { StaticMap, type MapPoint } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useNearbyEvents } from '@/lib/hooks';
import type { Coords, NearbyEvent } from '@/lib/types';

/** A large static map of all nearby events + the list beneath — used on native
 *  (and on web when no Mapbox token is set), where an interactive GL map isn't
 *  available. */
export function EventMapList({ coords, radius }: { coords: Coords; radius: number }) {
  const theme = useTheme();
  const events = useNearbyEvents(coords, radius);
  const { isFollowing } = useFollows();

  const all = events.data ?? [];
  const ref = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });
  const points: MapPoint[] = all
    .filter((e) => e.venue_lat != null && e.venue_lng != null)
    .map((e) => ({ lat: e.venue_lat as number, lng: e.venue_lng as number, following: isFollowing(ref(e)) }));

  return (
    <FlatList
      data={all}
      keyExtractor={(e) => e.event_id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: 56 + Spacing.three, paddingBottom: Spacing.six }}
      ListHeaderComponent={
        <View style={[styles.map, { borderColor: theme.border }]}>
          <StaticMap points={points} />
        </View>
      }
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.empty}>
          No events to map in this area.
        </ThemedText>
      }
      renderItem={({ item }) => (
        <SecondaryEventCard
          event={item}
          following={isFollowing(ref(item))}
          onPress={() => router.push(`/event/${item.event_id}`)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    height: 300,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  empty: { textAlign: 'center', padding: Spacing.five },
});
