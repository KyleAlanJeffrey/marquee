import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { EventCard } from '@/components/event-card';
import { HeroHeader } from '@/components/hero-header';
import { PressableScale } from '@/components/pressable-scale';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNearbyEvents } from '@/lib/hooks';
import { useFollows } from '@/lib/follows-store';
import { getCurrentCoords, reverseGeocodeLabel } from '@/lib/location';
import { RADIUS_OPTIONS, usePrefs } from '@/lib/prefs-store';
import { syncConcertReminders } from '@/lib/reminders';
import type { Coords } from '@/lib/types';

type SegmentKey = 'nearby' | 'following';

export default function NearMeScreen() {
  const theme = useTheme();
  const { follows, isFollowing } = useFollows();
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

  // Keep on-device reminders in sync with the followed shows we can see.
  useEffect(() => {
    syncConcertReminders(followingEvents, remindersEnabled);
  }, [followingEvents, remindersEnabled]);

  const shown = segment === 'following' ? followingEvents : allEvents;

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

  return (
    <ThemedView style={{ flex: 1 }}>
      <HeroHeader
        title="Near Me"
        locationLabel={coords ? label ?? 'Your area' : null}
        onSearchPress={() => router.push('/search')}>
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((r) => {
            const active = r === radiusMiles;
            return (
              <Pressable
                key={r}
                onPress={() => setRadiusMiles(r)}
                style={[
                  styles.radiusChip,
                  {
                    backgroundColor: active ? theme.onGradient : 'rgba(255,255,255,0.18)',
                  },
                ]}>
                <ThemedText
                  style={[
                    styles.radiusText,
                    { color: active ? theme.tint : theme.onGradient },
                  ]}>
                  {r} mi
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </HeroHeader>

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

      {!coords || events.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.tint} />
          <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            Finding shows around you…
          </ThemedText>
        </View>
      ) : events.isError ? (
        <View style={styles.center}>
          <ErrorState onRetry={() => events.refetch()} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(e) => e.event_id}
          refreshing={events.isRefetching}
          onRefresh={() => events.refetch()}
          contentContainerStyle={[
            styles.listContent,
            shown.length === 0 && styles.listEmpty,
          ]}
          ListHeaderComponent={
            segment === 'following' && follows.length > 0 ? (
              <FollowingRail />
            ) : null
          }
          ListEmptyComponent={
            <FeedEmpty
              segment={segment}
              hasFollows={follows.length > 0}
              radiusMiles={radiusMiles}
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 360)).duration(360)}>
              <EventCard
                artistName={item.artist_name}
                artistImageUrl={item.artist_image_url}
                startsAt={item.starts_at}
                venueName={item.venue_name}
                venueCity={item.venue_city}
                venueRegion={item.venue_region}
                distanceMiles={item.distance_miles}
                ticketUrl={item.ticket_url}
                following={isFollowing({
                  artistId: item.artist_id,
                  spotifyId: item.artist_spotify_id,
                })}
                onPress={() => router.push(`/artist/${item.artist_id}`)}
              />
            </Animated.View>
          )}
        />
      )}
    </ThemedView>
  );
}

/** Avatar rail of followed artists, shown atop the Following segment. */
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
              style={[styles.railAvatar, { backgroundColor: theme.backgroundElement }]}
              contentFit="cover"
            />
            <ThemedText type="small" numberOfLines={1} style={styles.railName}>
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
        icon="star-outline"
        title="No artists followed yet"
        message="Follow artists and their nearby shows will surface right here, front and center."
        actionLabel="Find artists"
        onAction={() => router.push('/search')}
      />
    );
  }
  if (segment === 'following') {
    return (
      <EmptyState
        icon="star-outline"
        title="Nothing from your artists"
        message={`None of the artists you follow have a show within ${radiusMiles} mi right now. Try a wider radius.`}
      />
    );
  }
  return (
    <EmptyState
      icon="compass-outline"
      title="Nothing nearby yet"
      message={`No upcoming shows within ${radiusMiles} mi. Events refresh nightly — try a wider radius.`}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  radiusRow: { flexDirection: 'row', gap: Spacing.two },
  radiusChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
  },
  radiusText: { fontSize: 13, fontWeight: '700' },
  controls: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  listContent: { paddingTop: Spacing.one, paddingBottom: Spacing.six },
  listEmpty: { flexGrow: 1 },
  rail: { paddingBottom: Spacing.two },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingVertical: Spacing.two },
  railItem: { alignItems: 'center', width: 68, gap: Spacing.one },
  railAvatar: { width: 60, height: 60, borderRadius: Radius.pill },
  railName: { maxWidth: 68, textAlign: 'center', fontSize: 12 },
});
