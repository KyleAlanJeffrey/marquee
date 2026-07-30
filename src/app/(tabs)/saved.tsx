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
import { EVENTS_BY_IDS_MAX, useSavedShowDetails } from '@/lib/hooks';
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
  const { saved, unsave, isSaved, ready } = useSavedShows();
  const [refreshing, setRefreshing] = useState(false);

  // Soonest first before the cap, so the shows that get live prices and door times
  // are the ones about to happen rather than whichever ids sort first.
  const ids = useMemo(
    () =>
      [...saved]
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((s) => s.eventId)
        .slice(0, EVENTS_BY_IDS_MAX),
    [saved],
  );
  const details = useSavedShowDetails(ids);

  // Snapshots carry the list until the server answers, then the server's rows
  // replace them wholesale: it returns exactly the saved shows that are still to
  // come, in date order, so nothing here has to guess what time it is.
  const { upcoming, gone } = useMemo(() => {
    const snapshots = [...saved]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(snapshotAsEvent);
    if (!details.isSuccess) return { upcoming: snapshots, gone: [] as NearbyEvent[] };
    // The response is kept across an unsave (so the list doesn't blink), which means
    // it can still hold a show that is no longer saved.
    const live = details.data.filter((e) => isSaved({ eventId: e.event_id }));
    const found = new Set(live.map((e) => e.event_id));
    return { upcoming: live, gone: snapshots.filter((e) => !found.has(e.event_id)) };
  }, [saved, details.data, details.isSuccess, isSaved]);

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

      {!ready ? (
        // The disk read hasn't landed; "nothing saved" here would be a lie that
        // flashes over a full list every cold start.
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : saved.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title="Nothing saved"
          message="Tap the bookmark on a show to put it aside and it will wait for you here."
          actionLabel="Find shows"
          onAction={() => router.push('/explore')}
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
                  {/* Say it rather than quietly showing stale times for the rest. */}
                  {saved.length > ids.length ? ` · live times for the first ${ids.length}` : ''}
                </ThemedText>
                {details.isFetching && !refreshing ? (
                  <ActivityIndicator size="small" color={theme.textTertiary} />
                ) : null}
              </View>
              {/* A failed refresh doesn't hide the list — the snapshots below are
                  still the user's shows. It just says so, and offers another go. */}
              {details.isError && !details.isFetching ? (
                <View style={styles.errorRow}>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary, flex: 1 }}>
                    COULDN&rsquo;T CHECK FOR CHANGES &mdash; SHOWING WHAT YOU SAVED
                  </ThemedText>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Try refreshing saved shows again"
                    onPress={() => details.refetch()}>
                    <ThemedText type="labelSm" style={{ color: theme.primary }}>
                      TRY AGAIN
                    </ThemedText>
                  </PressableScale>
                </View>
              ) : null}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
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
