import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { MeshBackground } from '@/components/mesh-background';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { refreshArtistEvents } from '@/lib/discovery';
import { useFollows } from '@/lib/follows-store';
import { useNearbyEvents } from '@/lib/hooks';
import { getCurrentCoords } from '@/lib/location';
import { usePrefs } from '@/lib/prefs-store';
import type { Coords, NearbyEvent } from '@/lib/types';

const eventRef = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });

export default function FollowingScreen() {
  const theme = useTheme();
  const { follows, isFollowing } = useFollows();
  const { radiusMiles } = usePrefs();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const events = useNearbyEvents(coords, radiusMiles);

  useEffect(() => {
    (async () => {
      const c = await getCurrentCoords();
      if (c) setCoords(c);
      else setDenied(true);
    })();
  }, []);

  const followingEvents = useMemo(
    () => (events.data ?? []).filter((e) => isFollowing(eventRef(e))),
    [events.data, isFollowing],
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

  const loading = !denied && (!coords || events.isLoading);

  return (
    <View style={{ flex: 1 }}>
      <MeshBackground />
      <TopBar onSearchPress={() => router.push('/search')} />

      {follows.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title="No artists followed"
          message="Follow artists and their shows near you will collect here."
          actionLabel="Find artists"
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
          data={followingEvents}
          keyExtractor={(e) => e.event_id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.head}>
                <ThemedText type="headline">Following</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {follows.length} {follows.length === 1 ? 'artist' : 'artists'}
                </ThemedText>
              </View>
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
              <ThemedText type="label" style={[styles.sectionLabel, { color: theme.primary }]}>
                NEAR YOU
              </ThemedText>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Nothing nearby yet"
              message={`None of the artists you follow have a show within ${radiusMiles} mi. Pull to refresh or widen your radius in Profile.`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: 2 },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingVertical: Spacing.three },
  railItem: { alignItems: 'center', width: 68, gap: Spacing.one },
  railAvatar: { width: 60, height: 60, borderRadius: Radius.pill, borderWidth: 1 },
  railName: { maxWidth: 68, textAlign: 'center' },
  sectionLabel: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 1.5 },
});
