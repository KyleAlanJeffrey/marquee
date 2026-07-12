import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
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
import { useFollows } from '@/lib/follows-store';
import { useArtist, useArtistEvents } from '@/lib/hooks';
import { formatTime, formatVenue } from '@/lib/format';
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
  const { isFollowing, toggle } = useFollows();

  const following = isFollowing({ artistId: id });

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

  const a = artist.data;
  if (!a) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary">Artist not found.</ThemedText>
      </View>
    );
  }

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
                source={a.image_url ? { uri: a.image_url } : undefined}
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
                  <View style={styles.stat}>
                    <ThemedText type="title" style={{ fontSize: 18 }}>
                      {events.data?.length ?? '—'}
                    </ThemedText>
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      UPCOMING SHOWS
                    </ThemedText>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                  <View style={styles.stat}>
                    <ThemedText type="title" style={{ fontSize: 18 }}>
                      {a.genres.length || '—'}
                    </ThemedText>
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      GENRES
                    </ThemedText>
                  </View>
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
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {formatVenue(item.venue_name, item.venue_city, item.venue_region)}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {formatTime(item.starts_at).toUpperCase()}
                </ThemedText>
              </View>
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
            {/* Top Tracks */}
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">Top Tracks</ThemedText>
            </View>
            <GlassCard style={styles.tracksCard}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.trackRow,
                    i < 2 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                  ]}>
                  <LinearGradient
                    colors={i % 2 ? ['#00dbe9', '#0e0e0e'] : ['#bd00ff', '#0e0e0e']}
                    style={styles.trackArt}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={[styles.skeleton, { width: `${70 - i * 12}%`, backgroundColor: theme.backgroundHigh }]} />
                    <View style={[styles.skeleton, { width: '30%', height: 8, backgroundColor: theme.backgroundHigh }]} />
                  </View>
                  <Ionicons name="play" size={18} color={theme.textTertiary} />
                </View>
              ))}
              <ThemedText type="labelSm" style={{ color: theme.textTertiary, padding: Spacing.three, paddingTop: Spacing.two }}>
                STREAMING PREVIEWS COMING SOON
              </ThemedText>
            </GlassCard>

            {/* About */}
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">About</ThemedText>
            </View>
            <View style={styles.section}>
              <GlassCard style={styles.aboutCard}>
                <ThemedText type="body" themeColor="textSecondary" style={{ lineHeight: 24 }}>
                  {aboutText(a.name, a.genres)}
                </ThemedText>
                {a.genres.length > 0 && (
                  <View style={styles.aboutChips}>
                    {a.genres.slice(0, 4).map((g) => (
                      <GenreChip key={g} label={g} tone="neutral" />
                    ))}
                  </View>
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
        <TopBar transparent onBack={() => router.back()} />
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
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.three },
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
  ticketBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  section: { paddingHorizontal: Spacing.three },
  tracksCard: { marginHorizontal: Spacing.three, overflow: 'hidden' },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  trackArt: { width: 44, height: 44, borderRadius: Radius.sm },
  skeleton: { height: 12, borderRadius: 4 },
  aboutCard: { padding: Spacing.three, gap: Spacing.three },
  aboutChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
});
