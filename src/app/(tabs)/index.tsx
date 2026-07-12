import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { EventCard } from '@/components/event-card';
import { FeaturedCard } from '@/components/featured-card';
import { PressableScale } from '@/components/pressable-scale';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useNearbyEvents } from '@/lib/hooks';
import { getCurrentCoords, reverseGeocodeLabel } from '@/lib/location';
import { RADIUS_OPTIONS, usePrefs } from '@/lib/prefs-store';
import { syncConcertReminders } from '@/lib/reminders';
import type { Coords, NearbyEvent } from '@/lib/types';

type SegmentKey = 'nearby' | 'following';

export default function ExploreScreen() {
  const theme = useTheme();
  const { follows, isFollowing, toggle } = useFollows();
  const { radiusMiles, setRadiusMiles, remindersEnabled } = usePrefs();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>('nearby');

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
    () =>
      allEvents.filter((e) =>
        isFollowing({ artistId: e.artist_id, spotifyId: e.artist_spotify_id }),
      ),
    [allEvents, isFollowing],
  );

  useEffect(() => {
    syncConcertReminders(followingEvents, remindersEnabled);
  }, [followingEvents, remindersEnabled]);

  const shown = segment === 'following' ? followingEvents : allEvents;
  const featured = shown[0];
  const rest = shown.slice(1);

  function followRefFor(e: NearbyEvent) {
    return { artistId: e.artist_id, spotifyId: e.artist_spotify_id };
  }

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

      {/* Location + radius */}
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
                <ThemedText
                  type="labelSm"
                  style={{ color: active ? theme.onPrimary : theme.textSecondary }}>
                  {r} MI
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.controls}>
        <SegmentedControl
          value={segment}
          onChange={(k) => setSegment(k as SegmentKey)}
          segments={[
            { key: 'nearby', label: 'Nearby' },
            { key: 'following', label: 'Following', badge: followingEvents.length },
          ]}
        />
      </View>

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
        <FlatList
          data={rest}
          keyExtractor={(e) => e.event_id}
          refreshing={events.isRefetching}
          onRefresh={() => events.refetch()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, shown.length === 0 && styles.listEmpty]}
          ListHeaderComponent={
            <View>
              {segment === 'following' && follows.length > 0 && <FollowingRail />}
              {featured && (
                <Animated.View entering={FadeInDown.duration(420)} style={styles.featuredWrap}>
                  <ThemedText type="label" style={[styles.sectionLabel, { color: theme.primary }]}>
                    {segment === 'following' ? 'NEXT FOR YOU' : 'FEATURED TONIGHT'}
                  </ThemedText>
                  <FeaturedCard
                    event={featured}
                    following={isFollowing(followRefFor(featured))}
                    onPress={() => router.push(`/event/${featured.event_id}`)}
                    onToggleFollow={() => toggleFollow(featured)}
                  />
                </Animated.View>
              )}
              {rest.length > 0 && (
                <ThemedText type="title" style={styles.upcomingTitle}>
                  Upcoming
                </ThemedText>
              )}
            </View>
          }
          ListEmptyComponent={
            !featured ? (
              <FeedEmpty
                segment={segment}
                hasFollows={follows.length > 0}
                radiusMiles={radiusMiles}
              />
            ) : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 320)).duration(340)}>
              <EventCard
                artistName={item.artist_name}
                artistImageUrl={item.artist_image_url}
                startsAt={item.starts_at}
                venueName={item.venue_name}
                venueCity={item.venue_city}
                venueRegion={item.venue_region}
                distanceMiles={item.distance_miles}
                following={isFollowing(followRefFor(item))}
                onPress={() => router.push(`/event/${item.event_id}`)}
              />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
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
  if (segment === 'following') {
    return (
      <EmptyState
        icon="heart-outline"
        title="Nothing from your artists"
        message={`None of the artists you follow have a show within ${radiusMiles} mi. Try a wider radius.`}
      />
    );
  }
  return (
    <EmptyState
      icon="compass-outline"
      title="Nothing nearby yet"
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
  controls: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  listContent: { paddingTop: Spacing.one, paddingBottom: Spacing.six + Spacing.four },
  listEmpty: { flexGrow: 1 },
  featuredWrap: { marginBottom: Spacing.three },
  sectionLabel: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 1.5 },
  upcomingTitle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  rail: { paddingBottom: Spacing.three },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingVertical: Spacing.two },
  railItem: { alignItems: 'center', width: 68, gap: Spacing.one },
  railAvatar: { width: 60, height: 60, borderRadius: Radius.pill, borderWidth: 1 },
  railName: { maxWidth: 68, textAlign: 'center' },
});
