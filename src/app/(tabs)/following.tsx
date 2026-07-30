import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { MeshBackground } from '@/components/mesh-background';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { VenueRow, placeOf } from '@/components/venue-card';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { refreshArtistEvents } from '@/lib/discovery';
import { useFollowedVenues } from '@/lib/followed-venues-store';
import { useFollows } from '@/lib/follows-store';
import { useFollowingEvents } from '@/lib/hooks';
import { getCurrentCoords } from '@/lib/location';
import { usePrefs } from '@/lib/prefs-store';
import type { Coords } from '@/lib/types';

type Tab = 'artists' | 'venues';

export default function FollowingScreen() {
  const theme = useTheme();
  const { follows, ready: followsReady } = useFollows();
  const { venues, isFollowingVenue, toggleVenue, ready: venuesReady } = useFollowedVenues();
  const { radiusMiles } = usePrefs();

  const [tab, setTab] = useState<Tab>('artists');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Both identities: an artist followed from search has only a Spotify id, and
  // nothing backfills a catalog id later, so asking by one alone loses those.
  const ids = useMemo(
    () => ({
      artistIds: follows.map((f) => f.artistId).filter((id): id is string => !!id),
      spotifyIds: follows.map((f) => f.spotifyId).filter((id): id is string => !!id),
      venueIds: venues.map((v) => v.venueId),
    }),
    [follows, venues],
  );
  const askable = ids.artistIds.length + ids.spotifyIds.length + ids.venueIds.length > 0;
  const events = useFollowingEvents(ids, coords, radiusMiles);

  // With a location the list is gated to the radius from Profile; without one it
  // still loads, ungated and with no distances, rather than showing nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getCurrentCoords();
        if (c && !cancelled) setCoords(c);
      } catch (err) {
        console.warn('location lookup failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One request covers both tabs, and the server says which half each row answers.
  // Re-deriving it here would drop correct shows: rows carry the canonical venue id,
  // which isn't always the id on the device. A show by a followed artist at a
  // followed venue is tagged both ways and appears under both.
  const artistShows = useMemo(
    () => (events.data ?? []).filter((e) => e.matched_artist),
    [events.data],
  );
  const venueShows = useMemo(() => (events.data ?? []).filter((e) => e.matched_venue), [events.data]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (follows.length) await refreshArtistEvents(follows);
      await events.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  // Wait for the stored lists before saying someone follows nothing: on a cold start
  // the disk read hasn't landed yet, and the empty state would flash over real data.
  const storesReady = followsReady && venuesReady;
  const nothingFollowed = storesReady && follows.length === 0 && venues.length === 0;
  // `askable` guards the spinner: a disabled query stays `pending` forever, so
  // waiting on it alone would spin for good if there were no ids worth sending.
  const loading = !storesReady || (askable && events.isPending);
  const shows = tab === 'artists' ? artistShows : venueShows;
  const followedHere = tab === 'artists' ? follows.length : venues.length;

  const refresh = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
  );

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Artists and venues you follow"
        description="The artists and venues you follow on Marquee, with their next shows near you and a reminder before doors."
      />
      <MeshBackground />
      <TopBar onSearchPress={() => router.push('/search')} />

      {nothingFollowed ? (
        <EmptyState
          icon="heart-outline"
          title="Nothing followed yet"
          message="Follow artists and venues, and their shows near you will collect here."
          actionLabel="Find artists"
          onAction={() => router.push('/search')}
        />
      ) : (
        <>
          <View style={styles.head}>
            <ThemedText type="headline">Following</ThemedText>
            <Segmented
              label="following view"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'artists', label: 'Artists', count: follows.length },
                { value: 'venues', label: 'Venues', count: venues.length },
              ]}
            />
          </View>

          {followedHere === 0 ? (
            <EmptyState
              icon={tab === 'artists' ? 'heart-outline' : 'business-outline'}
              title={tab === 'artists' ? 'No artists followed' : 'No venues followed'}
              message={
                tab === 'artists'
                  ? 'Follow an artist and their next show will collect here.'
                  : 'Follow a venue from its page and everything on there will collect here.'
              }
              actionLabel="Search"
              onAction={() => router.push('/search')}
            />
          ) : loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : events.isError ? (
            <View style={styles.center}>
              <ErrorState onRetry={() => events.refetch()} />
            </View>
          ) : (
            <FlatList
              data={shows}
              keyExtractor={(e) => e.event_id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              refreshControl={refresh}
              ListHeaderComponent={
                <View>
                  {tab === 'artists' ? (
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
                            style={[
                              styles.railAvatar,
                              { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                            ]}
                            contentFit="cover"
                          />
                          <ThemedText type="labelSm" numberOfLines={1} style={styles.railName}>
                            {item.name}
                          </ThemedText>
                        </PressableScale>
                      )}
                    />
                  ) : (
                    <View style={styles.venueList}>
                      {venues.map((v) => (
                        <VenueRow
                          key={v.venueId}
                          name={v.name}
                          place={placeOf(v.city, v.region)}
                          onPress={() => router.push(`/venue/${v.venueId}`)}
                          trailing={
                            <FollowButton
                              compact
                              following={isFollowingVenue({ venueId: v.venueId })}
                              subject={v.name}
                              onToggle={() => toggleVenue(v)}
                            />
                          }
                        />
                      ))}
                    </View>
                  )}
                  <ThemedText type="label" style={[styles.sectionLabel, { color: theme.primary }]}>
                    {coords ? `WITHIN ${radiusMiles} MI` : 'COMING UP'}
                  </ThemedText>
                </View>
              }
              ListEmptyComponent={
                <EmptyState
                  icon="calendar-outline"
                  title={coords ? 'Nothing in range' : 'Nothing announced yet'}
                  message={
                    coords
                      ? tab === 'artists'
                        ? `None of the artists you follow have a date within ${radiusMiles} mi — at any point in the next year. Widen your radius in Profile, or pull to refresh.`
                        : `Nothing on at the venues you follow within ${radiusMiles} mi. Widen your radius in Profile, or open a venue for its full lineup.`
                      : tab === 'artists'
                        ? 'None of the artists you follow have a date on sale. Pull to refresh once they announce.'
                        : 'Nothing listed at the venues you follow. Pull to refresh, or open a venue for its own page.'
                  }
                />
              }
              renderItem={({ item, index }) => (
                <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
                  <SecondaryEventCard
                    event={item}
                    following
                    onPress={() => router.push(`/event/${item.event_id}`)}
                  />
                </Animated.View>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two + 2 },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingVertical: Spacing.three },
  railItem: { alignItems: 'center', width: 68, gap: Spacing.one },
  railAvatar: { width: 60, height: 60, borderRadius: Radius.pill, borderWidth: 1 },
  railName: { maxWidth: 68, textAlign: 'center' },
  venueList: { paddingTop: Spacing.three },
  sectionLabel: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 1.5 },
});
