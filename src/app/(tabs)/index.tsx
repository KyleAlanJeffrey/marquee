import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { EventCard } from '@/components/event-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollowedEvents, useFollows } from '@/lib/hooks';

export default function FollowingScreen() {
  const theme = useTheme();
  const follows = useFollows();
  const events = useFollowedEvents();

  if (follows.isLoading || events.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (follows.isError) {
    return (
      <ThemedView style={styles.center}>
        <ErrorState
          onRetry={() => {
            follows.refetch();
            events.refetch();
          }}
        />
      </ThemedView>
    );
  }

  if ((follows.data ?? []).length === 0) {
    return (
      <ThemedView style={styles.center}>
        <EmptyState
          icon="star-outline"
          title="No artists yet"
          message="Follow the artists you love and Marquee will tell you when they book a show near you."
          actionLabel="Find artists"
          onAction={() => router.push('/search')}
        />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={events.data ?? []}
        keyExtractor={(e) => e.event_id}
        refreshing={events.isRefetching}
        onRefresh={() => events.refetch()}
        ListHeaderComponent={
          <View>
            <FlatList
              horizontal
              data={follows.data}
              keyExtractor={(f) => f.artist_id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.artistRow}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => router.push(`/artist/${item.artist_id}`)}
                  style={styles.artistChip}>
                  <Image
                    source={item.artist.image_url ? { uri: item.artist.image_url } : undefined}
                    style={[styles.artistAvatar, { backgroundColor: theme.backgroundElement }]}
                    contentFit="cover"
                  />
                  <ThemedText type="small" numberOfLines={1} style={styles.artistName}>
                    {item.artist.name}
                  </ThemedText>
                </Pressable>
              )}
            />
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
              UPCOMING SHOWS
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.noEvents}>
            {events.isError ? (
              <ErrorState onRetry={() => events.refetch()} />
            ) : (
              <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
                No upcoming shows from your artists yet. We check for new dates every night.
              </ThemedText>
            )}
          </View>
        }
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
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artistRow: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  artistChip: {
    alignItems: 'center',
    width: 72,
    gap: Spacing.one,
  },
  artistAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  artistName: {
    maxWidth: 72,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    letterSpacing: 1,
    fontSize: 12,
  },
  noEvents: {
    padding: Spacing.five,
  },
});
