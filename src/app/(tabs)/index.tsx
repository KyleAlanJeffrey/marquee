import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ComingUpCard } from '@/components/coming-up-card';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { FeaturedCard } from '@/components/featured-card';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { SectionTitle } from '@/components/section-title';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { VenueMap, type MapPin } from '@/components/venue-map';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useNearbyEvents } from '@/lib/hooks';
import { getCurrentCoords, reverseGeocodeLabel } from '@/lib/location';
import { RADIUS_OPTIONS, usePrefs } from '@/lib/prefs-store';
import { syncConcertReminders } from '@/lib/reminders';
import type { Coords, NearbyEvent } from '@/lib/types';

type SegmentKey = 'nearby' | 'following';
const ALL = 'All';

const eventRef = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });

export default function ExploreScreen() {
  const theme = useTheme();
  const { follows, isFollowing, toggle } = useFollows();
  const { radiusMiles, setRadiusMiles, remindersEnabled } = usePrefs();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>('nearby');
  const [genre, setGenre] = useState<string>(ALL);

  const events = useNearbyEvents(coords, radiusMiles);

  useEffect(() => {
    (async () => {
      const c = await getCurrentCoords();
      if (!c) {
        setDenied(true);
        return;
      }
      setCoords(c);
      setLabel(await reverseGeocodeLabel(c));
    })();
  }, []);

  const allEvents = useMemo(() => events.data ?? [], [events.data]);

  const followingEvents = useMemo(
    () => allEvents.filter((e) => isFollowing(eventRef(e))),
    [allEvents, isFollowing],
  );

  useEffect(() => {
    syncConcertReminders(followingEvents, remindersEnabled);
  }, [followingEvents, remindersEnabled]);

  // Genre facets derived from the current segment's events.
  const segmentEvents = segment === 'following' ? followingEvents : allEvents;
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of segmentEvents) for (const g of e.artist_genres ?? []) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [ALL, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 8)];
  }, [segmentEvents]);

  const shown = useMemo(
    () => (genre === ALL ? segmentEvents : segmentEvents.filter((e) => (e.artist_genres ?? []).includes(genre))),
    [segmentEvents, genre],
  );

  const featured = shown[0];
  const secondary = shown.slice(1, 3);
  const comingUp = shown.slice(3);

  // De-duplicated venue pins for the map.
  const pins = useMemo<MapPin[]>(() => {
    const seen = new Map<string, MapPin>();
    for (const e of shown) {
      if (e.venue_lat == null || e.venue_lng == null) continue;
      const key = `${e.venue_lat.toFixed(3)},${e.venue_lng.toFixed(3)}`;
      const existing = seen.get(key);
      const following = isFollowing(eventRef(e));
      if (!existing) seen.set(key, { lat: e.venue_lat, lng: e.venue_lng, following });
      else if (following) existing.following = true;
    }
    return [...seen.values()];
  }, [shown, isFollowing]);

  const cityLabel = label?.split(',')[0] ?? shown[0]?.venue_city ?? null;

  function toggleFollow(e: NearbyEvent) {
    toggle({
      artistId: e.artist_id,
      spotifyId: e.artist_spotify_id,
      name: e.artist_name,
      imageUrl: e.artist_image_url,
      genres: e.artist_genres ?? [],
    });
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar onSearchPress={() => router.push('/search')} />

      {denied ? (
        <EmptyState
          icon="location-outline"
          title="Location needed"
          message="Allow location access in system settings so Marquee can light up the shows around you."
        />
      ) : !coords || events.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText type="label" style={{ color: theme.textTertiary, marginTop: Spacing.two }}>
            FINDING SHOWS AROUND YOU…
          </ThemedText>
        </View>
      ) : events.isError ? (
        <View style={styles.center}>
          <ErrorState onRetry={() => events.refetch()} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Spacing.six + Spacing.four }}
          refreshControl={undefined}>
          {/* Head */}
          <View style={styles.head}>
            <ThemedText type="headline">Near Me</ThemedText>
            <View style={styles.locRow}>
              <Ionicons name="location" size={15} color={theme.cyan} />
              <ThemedText type="label" style={{ color: theme.textSecondary }}>
                {coords ? (label ?? 'Your area').toUpperCase() : 'FINDING YOUR AREA…'}
              </ThemedText>
            </View>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((r) => {
                const active = r === radiusMiles;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRadiusMiles(r)}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                    ]}>
                    <ThemedText type="labelSm" style={{ color: active ? theme.onPrimary : theme.textSecondary }}>
                      {r} MI
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Genre filter chips */}
          {genres.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.genreRow}>
              {genres.map((g) => {
                const active = g === genre;
                return (
                  <Pressable
                    key={g}
                    onPress={() => setGenre(g)}
                    style={[
                      styles.genreChip,
                      active
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                    ]}>
                    <ThemedText type="labelSm" style={{ color: active ? theme.onPrimary : theme.textSecondary }}>
                      {g === ALL ? 'ALL EVENTS' : g.toUpperCase()}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Segment */}
          <View style={styles.controls}>
            <SegmentedControl
              value={segment}
              onChange={(k) => {
                setSegment(k as SegmentKey);
                setGenre(ALL);
              }}
              segments={[
                { key: 'nearby', label: 'Nearby' },
                { key: 'following', label: 'Following', badge: followingEvents.length },
              ]}
            />
          </View>

          {segment === 'following' && follows.length > 0 && <FollowingRail />}

          {shown.length === 0 ? (
            <FeedEmpty segment={segment} hasFollows={follows.length > 0} radiusMiles={radiusMiles} />
          ) : (
            <>
              {/* Nearby Venues map */}
              {pins.length > 0 && (
                <>
                  <SectionTitle title="Nearby Venues" accent actionLabel="Expand Map" onAction={openMaps} />
                  <VenueMap pins={pins} city={cityLabel} count={pins.length} onExpand={openMaps} />
                </>
              )}

              {/* This Weekend */}
              <SectionTitle title="This Weekend" badge="Hot" accent />
              {featured && (
                <Animated.View entering={FadeInDown.duration(420)} style={{ marginBottom: Spacing.three }}>
                  <FeaturedCard
                    event={featured}
                    following={isFollowing(eventRef(featured))}
                    onPress={() => router.push(`/event/${featured.event_id}`)}
                    onToggleFollow={() => toggleFollow(featured)}
                  />
                </Animated.View>
              )}
              {secondary.map((e, i) => (
                <Animated.View key={e.event_id} entering={FadeInDown.delay(80 + i * 60).duration(360)}>
                  <SecondaryEventCard
                    event={e}
                    following={isFollowing(eventRef(e))}
                    onPress={() => router.push(`/event/${e.event_id}`)}
                  />
                </Animated.View>
              ))}

              {/* Coming Up */}
              {comingUp.length > 0 && (
                <>
                  <SectionTitle title="Coming Up" accent />
                  <FlatList
                    horizontal
                    data={comingUp}
                    keyExtractor={(e) => e.event_id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.comingUpRow}
                    renderItem={({ item }) => (
                      <ComingUpCard event={item} onPress={() => router.push(`/event/${item.event_id}`)} />
                    )}
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );

  function openMaps() {
    if (!coords) return;
    const url = `https://maps.google.com/?q=concerts@${coords.lat},${coords.lng}`;
    Linking.openURL(url).catch(() => {});
  }
}

function FollowingRail() {
  const theme = useTheme();
  const { follows } = useFollows();
  return (
    <View style={styles.rail}>
      <FlatList
        horizontal
        data={follows}
        keyExtractor={(f) => f.artistId ?? f.spotifyId ?? f.name}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
        renderItem={({ item }) => (
          <PressableScale
            haptic={false}
            disabled={!item.artistId}
            onPress={() => item.artistId && router.push(`/artist/${item.artistId}`)}
            style={styles.railItem}>
            <Image
              source={item.imageUrl ? { uri: item.imageUrl } : undefined}
              style={[styles.railAvatar, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}
              contentFit="cover"
            />
            <ThemedText type="labelSm" numberOfLines={1} style={styles.railName}>
              {item.name}
            </ThemedText>
          </PressableScale>
        )}
      />
    </View>
  );
}

function FeedEmpty({
  segment,
  hasFollows,
  radiusMiles,
}: {
  segment: SegmentKey;
  hasFollows: boolean;
  radiusMiles: number;
}) {
  if (segment === 'following' && !hasFollows) {
    return (
      <EmptyState
        icon="heart-outline"
        title="No artists followed"
        message="Follow artists and their nearby shows take the spotlight right here."
        actionLabel="Find artists"
        onAction={() => router.push('/search')}
      />
    );
  }
  return (
    <EmptyState
      icon="compass-outline"
      title={segment === 'following' ? 'Nothing from your artists' : 'Nothing nearby yet'}
      message={`No upcoming shows within ${radiusMiles} mi. Try a wider radius.`}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  radiusRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  genreRow: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingTop: Spacing.three },
  genreChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  controls: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  comingUpRow: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.three },
  rail: { paddingTop: Spacing.three },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingVertical: Spacing.two },
  railItem: { alignItems: 'center', width: 68, gap: Spacing.one },
  railAvatar: { width: 60, height: 60, borderRadius: Radius.pill, borderWidth: 1 },
  railName: { maxWidth: 68, textAlign: 'center' },
});
