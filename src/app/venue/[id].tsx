import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { DateBlock } from '@/components/date-block';
import { ErrorState } from '@/components/error-state';
import { MeshBackground } from '@/components/mesh-background';
import { PressableScale } from '@/components/pressable-scale';
import { StaticMap } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { refreshVenueEvents } from '@/lib/discovery';
import { formatPrice, formatTime } from '@/lib/format';
import { useInfiniteVenueEvents, useVenue } from '@/lib/hooks';
import type { VenueEvent } from '@/lib/types';

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const venue = useVenue(id);
  const shows = useInfiniteVenueEvents(id);
  const queryClient = useQueryClient();

  const events = shows.data?.pages.flatMap((p) => p.items) ?? [];

  // On open, pull the venue's full upcoming lineup from Ticketmaster, then refetch.
  const refreshed = useRef(false);
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    refreshVenueEvents(id).then((n) => {
      if (n > 0) queryClient.invalidateQueries({ queryKey: ['venue-events', id] });
    });
  }, [id, queryClient]);

  if (venue.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  if (venue.isError) {
    return (
      <View style={styles.center}>
        <ErrorState onRetry={() => venue.refetch()} />
      </View>
    );
  }
  const v = venue.data;
  if (!v) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary">Venue not found.</ThemedText>
      </View>
    );
  }

  const place = [v.city, v.region].filter(Boolean).join(', ');

  return (
    <View style={{ flex: 1 }}>
      <MeshBackground />
      <FlatList
        data={events}
        keyExtractor={(e: VenueEvent) => e.event_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 56 + 24, paddingBottom: Spacing.six }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (shows.hasNextPage && !shows.isFetchingNextPage) shows.fetchNextPage();
        }}
        ListFooterComponent={
          shows.isFetchingNextPage ? (
            <ActivityIndicator color={theme.primary} style={{ marginVertical: Spacing.four }} />
          ) : null
        }
        ListHeaderComponent={
          <Animated.View entering={FadeInDown.duration(400)}>
            {/* Map centered on the venue */}
            <View style={[styles.map, { borderColor: theme.border }]}>
              <StaticMap points={v.lat != null && v.lng != null ? [{ lat: v.lat, lng: v.lng }] : []} zoom={14} />
            </View>

            <View style={styles.header}>
              <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 2 }}>
                VENUE
              </ThemedText>
              <ThemedText type="display" numberOfLines={2} style={styles.name}>
                {v.name}
              </ThemedText>
              {place ? (
                <View style={styles.placeRow}>
                  <Ionicons name="location" size={15} color={theme.textSecondary} />
                  <ThemedText type="body" themeColor="textSecondary">
                    {place}
                  </ThemedText>
                </View>
              ) : null}
              <PressableScale
                onPress={() =>
                  Linking.openURL(
                    `https://maps.google.com/?q=${encodeURIComponent([v.name, place].filter(Boolean).join(' '))}`,
                  )
                }
                style={[styles.mapsBtn, { borderColor: theme.cyan }]}>
                <Ionicons name="navigate" size={15} color={theme.cyan} />
                <ThemedText type="label" style={{ color: theme.cyan, fontSize: 12 }}>
                  OPEN IN MAPS
                </ThemedText>
              </PressableScale>
            </View>

            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">Upcoming Shows</ThemedText>
            </View>
          </Animated.View>
        }
        ListEmptyComponent={
          shows.isLoading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.four }} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No upcoming shows on record at this venue yet.
            </ThemedText>
          )
        }
        renderItem={({ item, index }: { item: VenueEvent; index: number }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
            <PressableScale
              onPress={() => router.push(`/event/${item.event_id}`)}
              style={[styles.row, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
              <DateBlock startsAt={item.starts_at} />
              <Image
                source={item.artist_image_url ? { uri: item.artist_image_url } : undefined}
                style={[styles.avatar, { backgroundColor: theme.backgroundHigh }]}
                contentFit="cover"
              />
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.artist_name}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {[item.artist_genres?.[0]?.toUpperCase(), formatTime(item.starts_at).toUpperCase()]
                    .filter(Boolean)
                    .join(' • ')}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.cyan }}>
                {formatPrice(item.price_from)}
              </ThemedText>
            </PressableScale>
          </Animated.View>
        )}
      />

      <View style={styles.topBarAbs}>
        <TopBar transparent back title="Venue" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: {
    height: 180,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: { padding: Spacing.three, gap: Spacing.one + 2 },
  name: { color: '#fff' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  accentBar: { width: 4, height: 22, borderRadius: 2 },
  empty: { textAlign: 'center', padding: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  avatar: { width: 44, height: 44, borderRadius: Radius.sm },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
});
