import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EventGridCard } from '@/components/event-grid-card';
import { FeaturedCard } from '@/components/featured-card';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useNearbyEvents } from '@/lib/hooks';
import type { Coords, NearbyEvent } from '@/lib/types';

const ALL = 'All';
const PAGE = 6;
const ref = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });

export default function BrowseScreen() {
  const theme = useTheme();
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const { isFollowing, toggle } = useFollows();

  const coords: Coords | null = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  const events = useNearbyEvents(coords, Number(radius) || 50);

  const [genre, setGenre] = useState(ALL);
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [limit, setLimit] = useState(PAGE);

  const all = useMemo(() => events.data ?? [], [events.data]);
  const genres = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of all) for (const g of e.artist_genres ?? []) c.set(g, (c.get(g) ?? 0) + 1);
    return [ALL, ...[...c.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 8)];
  }, [all]);

  const filtered = useMemo(
    () => (genre === ALL ? all : all.filter((e) => (e.artist_genres ?? []).includes(genre))),
    [all, genre],
  );
  const feature = filtered[0];
  const rest = filtered.slice(1);
  const shown = rest.slice(0, limit);

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
      <TopBar onBack={() => router.back()} onSearchPress={() => router.push('/search')} />

      <FlatList
        key={mode}
        data={shown}
        numColumns={mode === 'grid' ? 2 : 1}
        keyExtractor={(e) => e.event_id}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={mode === 'grid' ? styles.col : undefined}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            {/* Genre chips */}
            <FlatList
              horizontal
              data={genres}
              keyExtractor={(g) => g}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              renderItem={({ item: g }) => {
                const active = g === genre;
                return (
                  <Pressable
                    onPress={() => {
                      setGenre(g);
                      setLimit(PAGE);
                    }}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                    ]}>
                    <ThemedText type="labelSm" style={{ color: active ? theme.onPrimary : theme.textSecondary }}>
                      {g === ALL ? 'ALL EVENTS' : g.toUpperCase()}
                    </ThemedText>
                  </Pressable>
                );
              }}
            />

            {/* Title + view toggle */}
            <View style={styles.titleRow}>
              <View style={styles.titleLeft}>
                <ThemedText type="title">Browse All</ThemedText>
                <ThemedText type="label" style={{ color: theme.textTertiary }}>
                  ({filtered.length})
                </ThemedText>
              </View>
              <View style={styles.toggle}>
                {(['grid', 'list'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={[styles.toggleBtn, mode === m && { backgroundColor: theme.backgroundHigh }]}>
                    <Ionicons
                      name={m === 'grid' ? 'grid' : 'list'}
                      size={18}
                      color={mode === m ? theme.primary : theme.textTertiary}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {events.isLoading ? (
              <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.five }} />
            ) : feature ? (
              <View style={styles.feature}>
                <FeaturedCard
                  event={feature}
                  following={isFollowing(ref(feature))}
                  onPress={() => router.push(`/event/${feature.event_id}`)}
                  onToggleFollow={() => toggleFollow(feature)}
                />
              </View>
            ) : (
              <ThemedText themeColor="textSecondary" style={styles.empty}>
                No events within this radius.
              </ThemedText>
            )}
          </View>
        }
        renderItem={({ item, index }) =>
          mode === 'grid' ? (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index * 40, 300)).duration(320)}
              style={{ flex: 1 }}>
              <EventGridCard
                event={item}
                following={isFollowing(ref(item))}
                onPress={() => router.push(`/event/${item.event_id}`)}
                onToggleFollow={() => toggleFollow(item)}
              />
            </Animated.View>
          ) : (
            <SecondaryEventCard
              event={item}
              following={isFollowing(ref(item))}
              onPress={() => router.push(`/event/${item.event_id}`)}
            />
          )
        }
        ListFooterComponent={
          rest.length > limit ? (
            <PressableScale
              onPress={() => setLimit((l) => l + PAGE)}
              style={[styles.loadMore, { borderColor: theme.primary }]}>
              <ThemedText type="label" style={{ color: theme.primary, fontSize: 13 }}>
                Load More Events
              </ThemedText>
            </PressableScale>
          ) : null
        }
      />

      {/* Floating Map View */}
      <PressableScale
        onPress={() => router.back()}
        style={[styles.mapBtn, { backgroundColor: theme.cyan }, Glow.cyan]}>
        <Ionicons name="map" size={20} color="#00363a" />
        <ThemedText type="label" style={{ color: '#00363a', fontSize: 13 }}>
          Map View
        </ThemedText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.six + Spacing.four },
  chips: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 3, borderRadius: Radius.pill, borderWidth: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  titleLeft: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  toggle: { flexDirection: 'row', gap: Spacing.one },
  toggleBtn: { padding: Spacing.one + 2, borderRadius: Radius.sm },
  feature: { marginBottom: Spacing.three },
  col: { gap: Spacing.two + 2, paddingHorizontal: Spacing.three, marginBottom: Spacing.two + 2 },
  empty: { textAlign: 'center', padding: Spacing.five },
  loadMore: {
    alignSelf: 'center',
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  mapBtn: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 52,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
  },
});
