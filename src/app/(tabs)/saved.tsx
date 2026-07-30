import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { MeshBackground } from '@/components/mesh-background';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSavedShowDetails } from '@/lib/hooks';
import { useSavedShows, type SavedShow } from '@/lib/saved-shows-store';
import type { NearbyEvent } from '@/lib/types';

/**
 * Render a stored snapshot as a feed row, so a saved show looks the same whether
 * it came off the disk or off the server. The fields a snapshot never had (genre,
 * coordinates, distance) are absent rather than guessed.
 */
function snapshotAsEvent(s: SavedShow): NearbyEvent {
  return {
    event_id: s.eventId,
    event_name: s.name,
    starts_at: s.startsAt,
    ticket_url: null,
    price_from: s.priceFrom,
    artist_id: s.artistId ?? '',
    artist_name: s.artistName ?? s.name,
    artist_image_url: s.artistImageUrl,
    artist_spotify_id: null,
    artist_genres: [],
    venue_id: s.venueId,
    venue_name: s.venueName,
    venue_city: s.venueCity,
    venue_region: null,
    venue_timezone: s.venueTimezone,
    venue_lat: null,
    venue_lng: null,
    distance_miles: null,
  };
}

export default function SavedScreen() {
  const theme = useTheme();
  const { saved, unsave } = useSavedShows();
  const [refreshing, setRefreshing] = useState(false);

  const ids = useMemo(() => saved.map((s) => s.eventId), [saved]);
  const details = useSavedShowDetails(ids);

  // Snapshots carry the list until the server answers, then the server's rows
  // replace them wholesale: it returns exactly the saved shows that are still to
  // come, in date order, so nothing here has to guess what time it is.
  const { upcoming, gone } = useMemo(() => {
    const snapshots = [...saved]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(snapshotAsEvent);
    if (!details.isSuccess) return { upcoming: snapshots, gone: [] as NearbyEvent[] };
    const live = details.data;
    const found = new Set(live.map((e) => e.event_id));
    return { upcoming: live, gone: snapshots.filter((e) => !found.has(e.event_id)) };
  }, [saved, details.data, details.isSuccess]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await details.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const removeButton = (eventId: string, name: string) => (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={`Remove ${name} from saved`}
      onPress={() => unsave({ eventId })}
      style={[styles.remove, { borderColor: theme.border }]}>
      <Ionicons name="bookmark" size={16} color={theme.cyan} />
    </PressableScale>
  );

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Saved shows"
        description="The concerts you put aside on Marquee, soonest first, with live prices and door times."
      />
      <MeshBackground />
      <TopBar onSearchPress={() => router.push('/search')} />

      {saved.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title="Nothing saved"
          message="Tap the bookmark on a show to put it aside and it will wait for you here."
          actionLabel="Find shows"
          onAction={() => router.push('/')}
        />
      ) : (
        <FlatList
          data={upcoming}
          keyExtractor={(e) => e.event_id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListHeaderComponent={
            <View style={styles.head}>
              <ThemedText type="headline">Saved</ThemedText>
              <View style={styles.subRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {saved.length} {saved.length === 1 ? 'show' : 'shows'} put aside
                </ThemedText>
                {details.isFetching && !refreshing ? (
                  <ActivityIndicator size="small" color={theme.textTertiary} />
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Nothing coming up"
              message="Nothing you saved is still to come. The list below remembers them anyway."
            />
          }
          ListFooterComponent={
            gone.length > 0 ? (
              <View>
                <ThemedText type="label" style={[styles.sectionLabel, { color: theme.textTertiary }]}>
                  PAST OR NO LONGER LISTED
                </ThemedText>
                {gone.map((e) => (
                  <View key={e.event_id} style={styles.dim}>
                    <SecondaryEventCard
                      event={e}
                      following={false}
                      onPress={() => router.push(`/event/${e.event_id}`)}
                      action={removeButton(e.event_id, e.artist_name)}
                    />
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
              <SecondaryEventCard
                event={item}
                following={false}
                onPress={() => router.push(`/event/${item.event_id}`)}
                action={removeButton(item.event_id, item.artist_name)}
              />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionLabel: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 1.5 },
  // A show that has passed or been pulled is still yours to look at, just not news.
  dim: { opacity: 0.55 },
  remove: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
