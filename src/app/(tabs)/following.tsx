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
import { useNearbyEvents } from '@/lib/hooks';
import { getCurrentCoords } from '@/lib/location';
import { usePrefs } from '@/lib/prefs-store';
import type { Coords, NearbyEvent } from '@/lib/types';

type Tab = 'artists' | 'venues';

const eventRef = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });

export default function FollowingScreen() {
  const theme = useTheme();
  const { follows, isFollowing } = useFollows();
  const { venues, isFollowingVenue, toggleVenue } = useFollowedVenues();
  const { radiusMiles } = usePrefs();

  const [tab, setTab] = useState<Tab>('artists');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const events = useNearbyEvents(coords, radiusMiles);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getCurrentCoords();
        if (cancelled) return;
        if (c) setCoords(c);
        else setDenied(true);
      } catch (err) {
        console.warn('location lookup failed:', err);
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const followingEvents = useMemo(
    () => (events.data ?? []).filter((e) => isFollowing(eventRef(e))),
    [events.data, isFollowing],
  );

  const venueEvents = useMemo(
    () => (events.data ?? []).filter((e) => isFollowingVenue({ venueId: e.venue_id })),
    [events.data, isFollowingVenue],
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (follows.length) await refreshArtistEvents(follows);
      await events.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const nothingFollowed = follows.length === 0 && venues.length === 0;
  const loading = !denied && (!coords || events.isLoading);
  const shows = tab === 'artists' ? followingEvents : venueEvents;
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
                  ? 'Follow an artist and their shows near you will collect here.'
                  : 'Follow a venue from its page and its shows near you will collect here.'
              }
              actionLabel="Search"
              onAction={() => router.push('/search')}
            />
          ) : denied ? (
            <EmptyState
              icon="location-outline"
              title="Location needed"
              message="Allow location access in system settings so we can find shows near you."
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
                    NEAR YOU
                  </ThemedText>
                </View>
              }
              ListEmptyComponent={
                <EmptyState
                  icon="calendar-outline"
                  title="Nothing nearby yet"
                  message={
                    tab === 'artists'
                      ? `None of the artists you follow have a show within ${radiusMiles} mi. Pull to refresh or widen your radius in Profile.`
                      : `Nothing on at the venues you follow within ${radiusMiles} mi. Open a venue to see its full lineup.`
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
