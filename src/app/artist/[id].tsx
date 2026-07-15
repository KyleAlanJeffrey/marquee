import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { DateBlock } from '@/components/date-block';
import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { GalleryStrip } from '@/components/gallery-strip';
import { GenreChip } from '@/components/genre-chip';
import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { refreshArtistEvents } from '@/lib/discovery';
import { useFollows } from '@/lib/follows-store';
import { useArtist, useArtistEvents, useArtistInfo } from '@/lib/hooks';
import { formatCount, formatTime, formatVenue } from '@/lib/format';
import type { ArtistEvent } from '@/lib/types';

/** A short, honestly-derived blurb (we don't store real bios). */
function aboutText(name: string, genres: string[]): string {
  const g = genres.slice(0, 2).join(' and ');
  const article = g && /^[aeiou]/i.test(g) ? 'an' : 'a';
  const lead = g ? `${name} is ${article} ${g} act` : `${name} is a live act`;
  return `${lead} on Marquee. Follow to get a reminder before their next show near you, and grab tickets from the dates above.`;
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const artist = useArtist(id);
  const events = useArtistEvents(id);
  const info = useArtistInfo(id);
  const { isFollowing, toggle } = useFollows();
  const queryClient = useQueryClient();

  const following = isFollowing({ artistId: id });

  // On open, pull this artist's full upcoming schedule from Ticketmaster into
  // the DB (not just what a nearby sweep happened to catch), then refetch.
  const refreshed = useRef(false);
  const a = artist.data;
  useEffect(() => {
    if (refreshed.current || !a) return;
    refreshed.current = true;
    refreshArtistEvents([
      { artistId: a.id, spotifyId: a.spotify_id, name: a.name, imageUrl: a.image_url, genres: a.genres },
    ]).then((n) => {
      if (n > 0) queryClient.invalidateQueries({ queryKey: ['artist-events', id] });
    });
  }, [a, id, queryClient]);

  if (artist.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (artist.isError) {
    return (
      <View style={styles.center}>
        <ErrorState onRetry={() => artist.refetch()} />
      </View>
    );
  }

  if (!a) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary">Artist not found.</ThemedText>
      </View>
    );
  }

  const fans = info.data?.followers ?? null;
  const heroStats: { value: string | number; label: string }[] = [
    { value: events.data?.length ?? '—', label: 'UPCOMING SHOWS' },
    ...(fans != null ? [{ value: formatCount(fans), label: 'FANS' }] : []),
    { value: a.genres.length || '—', label: 'GENRES' },
  ];
  const tracks = info.data?.top_tracks ?? [];
  const spotifyUrl = info.data?.spotify_url ?? null;
  const bio = info.data?.bio ?? null;
  const bioUrl = info.data?.bio_url ?? null;
  // Prefer Spotify's artist photo (usually higher-res) when we have one.
  const heroImage = info.data?.image_url ?? a.image_url;

  return (
    <View style={{ flex: 1 }}>
      <Animated.FlatList
        data={events.data ?? []}
        keyExtractor={(e: ArtistEvent) => e.event_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Spacing.six }}
        ListHeaderComponent={
          <View>
            {/* Hero */}
            <View style={styles.hero}>
              <Image
                source={heroImage ? { uri: heroImage } : undefined}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={250}
              />
              <LinearGradient
                colors={['rgba(0,0,0,0.3)', 'transparent', theme.background]}
                locations={[0, 0.35, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroBody}>
                <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 2 }}>
                  FEATURED ARTIST
                </ThemedText>
                <ThemedText type="display" numberOfLines={2} style={styles.heroName}>
                  {a.name}
                </ThemedText>
                <View style={styles.heroActions}>
                  <FollowButton
                    following={following}
                    onToggle={() =>
                      toggle({
                        artistId: a.id,
                        spotifyId: a.spotify_id,
                        name: a.name,
                        imageUrl: a.image_url,
                        genres: a.genres,
                      })
                    }
                  />
                  {a.genres.length > 0 && (
                    <View style={styles.heroGenres}>
                      {a.genres.slice(0, 2).map((g, i) => (
                        <GenreChip key={g} label={g} tone={i === 0 ? 'purple' : 'cyan'} />
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.heroStats}>
                  {heroStats.map((s, i) => (
                    <View key={s.label} style={styles.statItem}>
                      {i > 0 && <View style={[styles.statDivider, { backgroundColor: theme.border }]} />}
                      <View style={styles.stat}>
                        <ThemedText type="title" style={{ fontSize: 18 }}>
                          {s.value}
                        </ThemedText>
                        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                          {s.label}
                        </ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">Upcoming Tours</ThemedText>
            </View>
          </View>
        }
        ListEmptyComponent={
          events.isLoading ? (
            <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.four }} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No upcoming shows on record. New dates are pulled in nightly.
            </ThemedText>
          )
        }
        renderItem={({ item, index }: { item: ArtistEvent; index: number }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
            <View
              style={[
                styles.tourRow,
                { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
              ]}>
              <DateBlock startsAt={item.starts_at} />
              <PressableScale
                haptic={false}
                disabled={!item.venue_id}
                onPress={() => item.venue_id && router.push(`/venue/${item.venue_id}`)}
                style={{ flex: 1 }}>
                <View style={styles.venueRow}>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {formatVenue(item.venue_name, item.venue_city, item.venue_region)}
                  </ThemedText>
                  {item.venue_id && (
                    <Ionicons name="chevron-forward" size={12} color={theme.textTertiary} />
                  )}
                </View>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {formatTime(item.starts_at).toUpperCase()}
                </ThemedText>
              </PressableScale>
              {item.ticket_url ? (
                <PressableScale
                  onPress={() => Linking.openURL(item.ticket_url!)}
                  style={[styles.ticketBtn, { backgroundColor: theme.primary }, Glow.purple, { shadowOpacity: 0.25 }]}>
                  <ThemedText type="label" style={{ color: theme.onPrimary, fontSize: 12 }}>
                    Tickets
                  </ThemedText>
                </PressableScale>
              ) : (
                <View style={[styles.ticketBtn, { backgroundColor: theme.backgroundHigh }]}>
                  <ThemedText type="label" style={{ color: theme.textTertiary, fontSize: 12 }}>
                    Soon
                  </ThemedText>
                </View>
              )}
            </View>
          </Animated.View>
        )}
        ListFooterComponent={
          <View>
            {/* Top Tracks (from Deezer) */}
            {(tracks.length > 0 || info.isLoading) && (
              <>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
                  <ThemedText type="title">Top Tracks</ThemedText>
                </View>
                <GlassCard style={styles.tracksCard}>
                  {info.isLoading && tracks.length === 0 ? (
                    <ActivityIndicator color={theme.primary} style={{ padding: Spacing.four }} />
                  ) : (
                    tracks.map((t, i) => (
                      <PressableScale
                        key={t.id}
                        haptic={false}
                        disabled={!t.url}
                        onPress={() => t.url && Linking.openURL(t.url)}
                        style={[
                          styles.trackRow,
                          i < tracks.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                        ]}>
                        <ThemedText type="label" style={{ width: 18, color: theme.textTertiary }}>
                          {i + 1}
                        </ThemedText>
                        <Image
                          source={t.image_url ? { uri: t.image_url } : undefined}
                          style={[styles.trackArt, { backgroundColor: theme.backgroundHigh }]}
                          contentFit="cover"
                        />
                        <View style={{ flex: 1 }}>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {t.name}
                          </ThemedText>
                          {t.album && (
                            <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textTertiary }}>
                              {t.album}
                            </ThemedText>
                          )}
                        </View>
                        {t.url && <Ionicons name="play-circle" size={24} color={theme.cyan} />}
                      </PressableScale>
                    ))
                  )}
                </GlassCard>
              </>
            )}

            {/* About */}
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">About</ThemedText>
            </View>
            <View style={styles.section}>
              <GlassCard style={styles.aboutCard}>
                <ThemedText type="body" themeColor="textSecondary" style={{ lineHeight: 24 }}>
                  {bio ?? aboutText(a.name, a.genres)}
                </ThemedText>
                {bio && bioUrl && (
                  <PressableScale haptic={false} onPress={() => Linking.openURL(bioUrl)}>
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      via Wikipedia ›
                    </ThemedText>
                  </PressableScale>
                )}
                {a.genres.length > 0 && (
                  <View style={styles.aboutChips}>
                    {a.genres.slice(0, 4).map((g) => (
                      <GenreChip key={g} label={g} tone="neutral" />
                    ))}
                  </View>
                )}
                {spotifyUrl && (
                  <PressableScale
                    onPress={() => Linking.openURL(spotifyUrl)}
                    style={[styles.spotifyBtn, { borderColor: '#1DB954' }]}>
                    <Ionicons name="musical-notes" size={16} color="#1DB954" />
                    <ThemedText type="label" style={{ color: '#1DB954', fontSize: 13 }}>
                      Listen on Spotify
                    </ThemedText>
                  </PressableScale>
                )}
              </GlassCard>
            </View>

            {/* Artist Gallery */}
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">Artist Gallery</ThemedText>
            </View>
            <GalleryStrip imageUrl={a.image_url} />
          </View>
        }
      />

      <View style={styles.topBarAbs}>
        <TopBar transparent back title="Artist" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: 500, justifyContent: 'flex-end' },
  heroBody: { padding: Spacing.three, gap: Spacing.one + 2 },
  heroName: { color: '#fff' },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.two, flexWrap: 'wrap' },
  heroGenres: { flexDirection: 'row', gap: Spacing.two },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.three },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stat: { gap: 2 },
  statDivider: { width: 1, height: 32 },
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
  tourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ticketBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  section: { paddingHorizontal: Spacing.three },
  tracksCard: { marginHorizontal: Spacing.three, overflow: 'hidden' },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  trackArt: { width: 44, height: 44, borderRadius: Radius.sm },
  aboutCard: { padding: Spacing.three, gap: Spacing.three },
  aboutChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  spotifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
});
