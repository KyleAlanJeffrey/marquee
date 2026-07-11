import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { EventCard } from '@/components/event-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNearbyEvents } from '@/lib/hooks';
import { getCurrentCoords } from '@/lib/location';
import type { Coords } from '@/lib/types';

const RADII = [25, 50, 100] as const;

export default function NearMeScreen() {
  const theme = useTheme();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);
  const [radius, setRadius] = useState<number>(50);
  const events = useNearbyEvents(coords, radius);

  useEffect(() => {
    (async () => {
      const c = await getCurrentCoords();
      if (c) setCoords(c);
      else setDenied(true);
    })();
  }, []);

  if (denied) {
    return (
      <ThemedView style={styles.center}>
        <EmptyState
          icon="location-outline"
          title="Location needed"
          message="Allow location access in system settings so Marquee can find concerts around you."
        />
      </ThemedView>
    );
  }

  if (!coords || events.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
          Finding shows around you…
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={styles.radiusRow}>
        {RADII.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRadius(r)}
            style={[
              styles.radiusPill,
              {
                backgroundColor: r === radius ? theme.tint : theme.backgroundElement,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: r === radius ? theme.onTint : theme.text }}>
              {r} mi
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={events.data ?? []}
        keyExtractor={(e) => e.event_id}
        refreshing={events.isRefetching}
        onRefresh={() => events.refetch()}
        ListEmptyComponent={
          events.isError ? (
            <ErrorState onRetry={() => events.refetch()} />
          ) : (
            <EmptyState
              icon="compass-outline"
              title="Nothing nearby yet"
              message="No upcoming shows from artists you don't follow within this radius. Events refresh nightly — try a wider radius."
            />
          )
        }
        contentContainerStyle={(events.data ?? []).length === 0 && { flex: 1 }}
        renderItem={({ item }) => (
          <EventCard
            artistName={item.artist_name}
            artistImageUrl={item.artist_image_url}
            startsAt={item.starts_at}
            venueName={item.venue_name}
            venueCity={item.venue_city}
            venueRegion={item.venue_region}
            distanceMiles={item.distance_miles}
            ticketUrl={item.ticket_url}
            onPress={() => router.push(`/artist/${item.artist_id}`)}
          />
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  radiusRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  radiusPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
