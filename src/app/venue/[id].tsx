import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { DateBlock } from '@/components/date-block';
import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { StatGrid, type Stat } from '@/components/stat-grid';
import { StaticMap } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { refreshVenueEvents } from '@/lib/discovery';
import { useFollowedVenues } from '@/lib/followed-venues-store';
import { formatPrice, formatRelativeDay, formatTime, monthLabel } from '@/lib/format';
import { useInfiniteVenueEvents, useVenue, useVenueInfo } from '@/lib/hooks';
import { openUrl } from '@/lib/open-url';
import { venueLinks } from '@/lib/venue-links';
import type { VenueEvent } from '@/lib/types';

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const venue = useVenue(id);
  const info = useVenueInfo(id);
  const shows = useInfiniteVenueEvents(id);
  const queryClient = useQueryClient();
  const { isFollowingVenue, toggleVenue } = useFollowedVenues();

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
  const stats = info.data?.stats ?? null;
  const description = info.data?.description ?? null;
  const photo = info.data?.photo ?? null;

  /**
   * The numbers worth enlarging, and only the ones this room actually has.
   *
   * Filtered rather than zero-filled: "0 UPCOMING" beside "0 ACTS" reads as a
   * broken page, whereas a room with one true number and nothing else reads as a
   * quiet room. The upcoming count is the accent because it is the reason to be
   * on this page.
   */
  const statCells: Stat[] = stats
    ? [
        stats.upcoming > 0 && { value: String(stats.upcoming), label: 'UPCOMING SHOWS', accent: true },
        stats.acts > 1 && { value: String(stats.acts), label: 'ARTISTS BOOKED' },
        stats.busiest_month && stats.busiest_month_shows > 1
          ? { value: monthLabel(stats.busiest_month), label: 'BUSIEST MONTH' }
          : null,
        stats.cheapest != null && { value: formatPrice(stats.cheapest), label: 'CHEAPEST ENTRY' },
      ].filter((s): s is Stat => !!s)
    : [];
  // A room the feed can place but not name: sources file the tour title in the
  // venue column, and the server refuses to publish those, so the town is the
  // heading. It is the truest thing we know about where this show is.
  const title = v.name ?? place ?? 'Venue';

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title={
          v.name
            ? `${v.name}${place ? ` — ${place}` : ''} tickets & upcoming shows`
            : `Upcoming concerts${place ? ` in ${place}` : ''}`
        }
        description={
          v.name
            ? `Upcoming concerts at ${v.name}${place ? ` in ${place}` : ''} — full lineup, dates, prices and tickets.`
            : `Upcoming concerts${place ? ` in ${place}` : ''} — full lineup, dates, prices and tickets.`
        }
      />
      <StageBackground />
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
            {/*
              A photograph of the room when Wikipedia has one, and the map when it
              doesn't. The map is the better fallback than a placeholder because it
              is also information — and on a room with no photo, where it is is the
              next thing anybody wants.
            */}
            {photo ? (
              <View style={[styles.hero, { borderColor: theme.border }]}>
                <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {/* The title sits on this, so the bottom has to be dark enough to
                    read against whatever the photograph happens to be. */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(19,19,21,0.95)']}
                  locations={[0, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            ) : (
              <View style={[styles.map, { borderColor: theme.border }]}>
                <StaticMap points={v.lat != null && v.lng != null ? [{ lat: v.lat, lng: v.lng }] : []} zoom={14} />
              </View>
            )}

            <View style={[styles.header, photo ? styles.headerOverHero : null]}>
              <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 2 }}>
                VENUE
              </ThemedText>
              <ThemedText type="display" numberOfLines={2} style={styles.name}>
                {title}
              </ThemedText>
              {/* Suppressed when the heading is already the town, or it says it twice. */}
              {place && v.name ? (
                <View style={styles.placeRow}>
                  <Ionicons name="location" size={15} color={theme.textSecondary} />
                  <ThemedText type="body" themeColor="textSecondary">
                    {place}
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.followRow}>
                <FollowButton
                  following={isFollowingVenue({ venueId: v.id })}
                  subject={title}
                  onToggle={() =>
                    toggleVenue({
                      venueId: v.id,
                      name: title,
                      city: v.city,
                      region: v.region,
                      lat: v.lat,
                      lng: v.lng,
                    })
                  }
                />
              </View>
              <View style={styles.linkRow}>
                {venueLinks(v).map((link) => (
                  <PressableScale
                    key={link.key}
                    accessibilityRole="link"
                    accessibilityLabel={`${link.label.toLowerCase()} for ${title}`}
                    onPress={() => Linking.openURL(link.url)}
                    style={[styles.linkChip, { borderColor: theme.cyan }]}>
                    <Ionicons name={link.icon as never} size={14} color={theme.cyan} />
                    <ThemedText type="label" style={{ color: theme.cyan, fontSize: 11 }}>
                      {link.label}
                    </ThemedText>
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* What kind of room it is, said by who actually plays here. */}
            {stats?.genres.length ? (
              <View style={styles.genreRow}>
                {stats.genres.map((g) => (
                  <View key={g} style={[styles.genreChip, { backgroundColor: theme.primaryFill, borderColor: theme.primaryEdge }]}>
                    <ThemedText type="labelSm" style={{ color: theme.primary }}>
                      {g}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            <StatGrid stats={statCells} />

            {description ? (
              <View style={styles.about}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentBar, { backgroundColor: theme.cyan }]} />
                  <ThemedText type="title">About This Room</ThemedText>
                </View>
                <ThemedText type="body" themeColor="textSecondary" style={styles.prose}>
                  {description}
                </ThemedText>
                {/*
                  Not decoration: the extract is CC BY-SA and the photograph is CC BY
                  or CC BY-SA, and both licences require attribution. The server
                  won't send a photo it can't credit, so if one rendered above, its
                  credit renders here.
                */}
                <View style={styles.creditRow}>
                  {info.data?.description_url ? (
                    <PressableScale
                      accessibilityRole="link"
                      accessibilityLabel="read this venue's Wikipedia article"
                      onPress={() => openUrl(info.data!.description_url!)}>
                      <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                        VIA WIKIPEDIA (CC BY-SA)
                      </ThemedText>
                    </PressableScale>
                  ) : null}
                  {photo ? (
                    <PressableScale
                      accessibilityRole="link"
                      accessibilityLabel="photo source and licence"
                      disabled={!photo.license_url}
                      // Links the file page on Commons, which carries the author,
                      // the licence and the source in full — the "source" half of
                      // the attribution the licence asks for, and what makes a
                      // one-line credit above defensible.
                      onPress={() => photo.license_url && openUrl(photo.license_url)}>
                      <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                        {`PHOTO${photo.credit ? ` ${photo.credit}` : ''} · ${photo.license}`}
                      </ThemedText>
                    </PressableScale>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* The photograph took the top of the page, so the map moves down here
                rather than being dropped — getting there is still the point. */}
            {photo && v.lat != null && v.lng != null ? (
              <View style={styles.about}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentBar, { backgroundColor: theme.cyan }]} />
                  <ThemedText type="title">Getting There</ThemedText>
                </View>
                <View style={[styles.map, styles.mapInline, { borderColor: theme.border }]}>
                  <StaticMap points={[{ lat: v.lat, lng: v.lng }]} zoom={14} />
                </View>
              </View>
            ) : null}

            {/* On a room with nothing booked this is the only part of the page with
                names in it, which is exactly when it earns its place. */}
            {stats?.recent.length ? (
              <View style={styles.about}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentBar, { backgroundColor: theme.cyan }]} />
                  <ThemedText type="title">Recently Played Here</ThemedText>
                </View>
                <View style={styles.recentWrap}>
                  {stats.recent.map((r) => (
                    <PressableScale
                      key={`${r.artist_id}-${r.starts_at}`}
                      onPress={() => router.push(`/artist/${r.artist_id}`)}
                      style={[styles.recentChip, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
                      <Image
                        source={r.artist_image_url ? { uri: r.artist_image_url } : undefined}
                        style={[styles.recentAvatar, { backgroundColor: theme.backgroundHigh }]}
                        contentFit="cover"
                      />
                      <View style={styles.recentText}>
                        <ThemedText type="labelSm" numberOfLines={1} style={{ textTransform: 'none' }}>
                          {r.artist_name}
                        </ThemedText>
                        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                          {formatRelativeDay(r.starts_at, v.timezone)}
                        </ThemedText>
                      </View>
                    </PressableScale>
                  ))}
                </View>
              </View>
            ) : null}

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
              <DateBlock startsAt={item.starts_at} timeZone={v?.timezone} />
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
                  {[item.artist_genres?.[0]?.toUpperCase(), formatTime(item.starts_at, v?.timezone).toUpperCase()]
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
  // Taller than the map it replaces: a photograph of a room is worth the space, and
  // the title sits on its lower third.
  hero: {
    height: 260,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  mapInline: { marginHorizontal: 0 },
  header: { padding: Spacing.three, gap: Spacing.one + 2 },
  // Pulled up over the hero's gradient, which was drawn dark for exactly this.
  headerOverHero: { marginTop: -72 },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  genreChip: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  about: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  prose: { lineHeight: 24 },
  creditRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.two + 2 },
  recentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.one + 2,
    paddingRight: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  recentAvatar: { width: 30, height: 30, borderRadius: Radius.pill },
  // Bounded, or a long band name pushes the date off the chip's edge.
  recentText: { maxWidth: 150 },
  name: { color: Colors.dark.onImage },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  followRow: { flexDirection: 'row', marginTop: Spacing.two },
  // Wraps, because four chips don't fit one line on a narrow phone and a
  // horizontally scrolling row hides whichever link falls off the edge.
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two - 2,
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
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  avatar: { width: 44, height: 44, borderRadius: Radius.sm },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
});
