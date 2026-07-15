import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/error-state';
import { GalleryStrip } from '@/components/gallery-strip';
import { GlassCard } from '@/components/glass-card';
import { GradientButton } from '@/components/gradient-button';
import { PressableScale } from '@/components/pressable-scale';
import { StaticMap } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useEvent, useEventBuzz, useEventLineup } from '@/lib/hooks';
import { formatEventDate, formatTime, formatVenue } from '@/lib/format';
import { socialLinks } from '@/lib/social';
import { ticketSources } from '@/lib/tickets';
import Animated, { FadeInDown } from 'react-native-reanimated';

function InfoRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  valueColor?: string;
}) {
  const theme = useTheme();
  return (
    <GlassCard style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: theme.backgroundHigh }]}>
        <Ionicons name={icon} size={20} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
          {label.toUpperCase()}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: valueColor ?? theme.text }}>
          {value}
        </ThemedText>
      </View>
    </GlassCard>
  );
}

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const event = useEvent(id);
  const buzzPosts = useEventBuzz(id);
  const lineup = useEventLineup(id);
  const { isFollowing, toggle } = useFollows();

  if (event.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (event.isError) {
    return (
      <View style={styles.center}>
        <ErrorState onRetry={() => event.refetch()} />
      </View>
    );
  }

  const e = event.data;
  if (!e) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary">Event not found.</ThemedText>
      </View>
    );
  }

  const following = isFollowing({ artistId: e.artist.id, spotifyId: e.artist.spotify_id });
  const hasTickets = !!e.ticket_url;
  const sources = ticketSources(e);
  const primaryUrl = e.ticket_url ?? sources[sources.length - 1].url;
  const genre = e.artist.genres?.[0];
  // Only show the artist line when it adds info (event name is often the artist).
  const showArtist = !!e.artist.name && e.artist.name.toLowerCase() !== e.name.toLowerCase();
  const buzz = socialLinks(e.artist.name, e.venue?.name);
  const support = lineup.data?.support ?? [];

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        {/* Hero — framed as a specific show (date + venue), not an artist page */}
        <View style={styles.hero}>
          <Image
            source={e.artist.image_url ? { uri: e.artist.image_url } : undefined}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)', theme.background]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBody}>
            <View style={[styles.liveTag, { borderColor: theme.cyan }]}>
              <View style={[styles.liveDot, { backgroundColor: theme.cyan }]} />
              <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 1.5 }}>
                LIVE EVENT
              </ThemedText>
            </View>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary, letterSpacing: 1 }}>
              {[genre?.toUpperCase(), formatEventDate(e.starts_at), formatTime(e.starts_at)]
                .filter(Boolean)
                .join(' • ')}
            </ThemedText>
            <ThemedText type="display" numberOfLines={3} style={styles.heroTitle}>
              {e.name}
            </ThemedText>
            {showArtist && (
              <ThemedText type="bodyLg" style={{ color: theme.textSecondary }}>
                {e.artist.name}
              </ThemedText>
            )}
            <View style={styles.heroVenue}>
              <Ionicons name="location" size={15} color={theme.cyan} />
              <ThemedText type="small" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {formatVenue(e.venue?.name ?? null, e.venue?.city ?? null, e.venue?.region ?? null)}
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Info rows */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.section}>
          <InfoRow icon="calendar" label="Date & Gate" value={`${formatEventDate(e.starts_at)} · Doors ${formatTime(e.starts_at)}`} />
          <InfoRow
            icon="location"
            label="Venue"
            value={formatVenue(e.venue?.name ?? null, e.venue?.city ?? null, e.venue?.region ?? null)}
          />
          <InfoRow
            icon="pricetag"
            label="Availability"
            value={hasTickets ? 'Tickets available' : 'Resale on StubHub'}
            valueColor={hasTickets ? theme.cyan : theme.orange}
          />
        </Animated.View>

        {/* Get Tickets */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">Get Tickets</ThemedText>
        </View>
        <View style={styles.section}>
          {sources.map((s) => {
            const resale = s.kind === 'resale';
            const accent = resale ? theme.orange : theme.cyan;
            return (
              <PressableScale
                key={s.id}
                onPress={() => Linking.openURL(s.url)}
                style={[styles.ticketSource, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                <View style={[styles.ticketIcon, { backgroundColor: theme.backgroundHigh }]}>
                  <Ionicons name={resale ? 'swap-horizontal' : 'ticket'} size={20} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{s.label}</ThemedText>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                    {resale ? 'RESALE MARKETPLACE' : 'OFFICIAL TICKETS'}
                  </ThemedText>
                </View>
                <Ionicons name="open-outline" size={18} color={theme.textTertiary} />
              </PressableScale>
            );
          })}
        </View>

        {/* Headliner */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Lineup</ThemedText>
        </View>
        <View style={styles.section}>
          <PressableScale
            onPress={() => router.push(`/artist/${e.artist.id}`)}
            style={[styles.headliner, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
            <Image
              source={e.artist.image_url ? { uri: e.artist.image_url } : undefined}
              style={[styles.headlinerImg, { backgroundColor: theme.backgroundHigh }]}
              contentFit="cover"
            />
            <View style={{ flex: 1 }}>
              <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                HEADLINER
              </ThemedText>
              <ThemedText type="title" numberOfLines={1}>
                {e.artist.name}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
          </PressableScale>

          {support.length > 0 && (
            <View style={styles.supportRow}>
              {support.slice(0, 3).map((s) => (
                <View
                  key={s.name}
                  style={[styles.supportTile, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                  {s.image_url && (
                    <Image source={{ uri: s.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.85)']}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                  />
                  <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                    SUPPORT
                  </ThemedText>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: '#fff' }}>
                    {s.name}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* The Venue */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Venue</ThemedText>
        </View>
        <View style={styles.section}>
          <GlassCard style={styles.venueCard}>
            <View style={styles.venueMap}>
              <StaticMap
                points={e.venue?.lat != null && e.venue?.lng != null ? [{ lat: e.venue.lat, lng: e.venue.lng }] : []}
                zoom={14}
              />
            </View>
            <View style={styles.venueInfo}>
              <ThemedText type="title" numberOfLines={1}>
                {e.venue?.name ?? 'Venue TBA'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[e.venue?.city, e.venue?.region].filter(Boolean).join(', ') || 'Location to be announced'}
              </ThemedText>
              <View style={styles.venueBtns}>
                {e.venue?.id && (
                  <PressableScale
                    onPress={() => router.push(`/venue/${e.venue!.id}`)}
                    style={[styles.mapsBtn, { backgroundColor: theme.cyan, borderColor: theme.cyan }]}>
                    <ThemedText type="label" style={{ color: '#00363a', fontSize: 12 }}>
                      VIEW VENUE
                    </ThemedText>
                  </PressableScale>
                )}
                <PressableScale
                  onPress={() =>
                    Linking.openURL(
                      `https://maps.google.com/?q=${encodeURIComponent(
                        [e.venue?.name, e.venue?.city, e.venue?.region].filter(Boolean).join(' '),
                      )}`,
                    )
                  }
                  style={[styles.mapsBtn, { borderColor: theme.cyan }]}>
                  <ThemedText type="label" style={{ color: theme.cyan, fontSize: 12 }}>
                    OPEN IN MAPS
                  </ThemedText>
                </PressableScale>
              </View>
            </View>
          </GlassCard>
        </View>

        {/* The Buzz */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Buzz</ThemedText>
        </View>
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            See what fans are saying about this show.
          </ThemedText>
          <View style={styles.buzzGrid}>
            {buzz.map((s) => (
              <PressableScale
                key={s.id}
                haptic={false}
                onPress={() => Linking.openURL(s.url)}
                style={[styles.buzzChip, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                <Ionicons name={s.icon} size={20} color={s.color} />
                <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                  {s.label}
                </ThemedText>
                <Ionicons name="open-outline" size={15} color={theme.textTertiary} />
              </PressableScale>
            ))}
          </View>

          {/* Real posts (Bluesky) */}
          {(buzzPosts.data?.posts.length ?? 0) > 0 && (
            <View style={styles.postList}>
              {buzzPosts.data!.posts.map((p) => (
                <PressableScale
                  key={p.id}
                  haptic={false}
                  onPress={() => Linking.openURL(p.url)}
                  style={[styles.postCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                  <View style={styles.postHead}>
                    <Image
                      source={p.avatar ? { uri: p.avatar } : undefined}
                      style={[styles.postAvatar, { backgroundColor: theme.backgroundHigh }]}
                      contentFit="cover"
                    />
                    <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {p.author}
                    </ThemedText>
                    <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textTertiary, flexShrink: 1 }}>
                      @{p.handle}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" numberOfLines={4}>
                    {p.text}
                  </ThemedText>
                  {p.image && (
                    <Image
                      source={{ uri: p.image }}
                      style={[styles.postImage, { backgroundColor: theme.backgroundHigh }]}
                      contentFit="cover"
                    />
                  )}
                  <View style={styles.postStats}>
                    <Ionicons name="heart-outline" size={14} color={theme.textTertiary} />
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      {p.likes}
                    </ThemedText>
                    <Ionicons name="chatbubble-outline" size={14} color={theme.textTertiary} style={{ marginLeft: Spacing.two }} />
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      {p.replies}
                    </ThemedText>
                  </View>
                </PressableScale>
              ))}
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                via Bluesky
              </ThemedText>
            </View>
          )}
        </View>

        {/* Fan Gallery */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">Fan Gallery</ThemedText>
        </View>
        <GalleryStrip imageUrl={e.artist.image_url} />
      </Animated.ScrollView>

      {/* Floating top bar with back */}
      <View style={styles.topBarAbs}>
        <TopBar transparent back title="Event" />
      </View>

      {/* Sticky buy bar */}
      <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.two }]}>
        <LinearGradient
          colors={['transparent', theme.background]}
          style={styles.buyFade}
          pointerEvents="none"
        />
        <View style={styles.buyContent}>
          <View style={{ flex: 1 }}>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              {following ? 'FOLLOWING ARTIST' : 'FROM YOUR AREA'}
            </ThemedText>
            <ThemedText type="title" numberOfLines={1}>
              {e.artist.name}
            </ThemedText>
          </View>
          <PressableScale
            haptic
            onPress={() =>
              toggle({
                artistId: e.artist.id,
                spotifyId: e.artist.spotify_id,
                name: e.artist.name,
                imageUrl: e.artist.image_url,
                genres: e.artist.genres,
              })
            }
            style={[
              styles.followMini,
              following
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { borderColor: theme.primary },
              following && Glow.purple,
            ]}>
            <Ionicons
              name={following ? 'heart' : 'heart-outline'}
              size={22}
              color={following ? theme.onPrimary : theme.primary}
            />
          </PressableScale>
          <GradientButton
            label={hasTickets ? 'Buy Tickets' : 'Find on StubHub'}
            onPress={() => Linking.openURL(primaryUrl)}
          />
        </View>
      </View>
    </View>
  );
}

const HERO_H = 440;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: HERO_H, justifyContent: 'flex-end' },
  heroBody: { padding: Spacing.three, gap: Spacing.one + 2 },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginBottom: Spacing.one,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  heroTitle: { color: '#fff' },
  heroVenue: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.one },
  section: { paddingHorizontal: Spacing.three, gap: Spacing.two + 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.three,
  },
  accentBar: { width: 4, height: 22, borderRadius: 2 },
  ticketSource: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  ticketIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buzzGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two + 2, marginTop: Spacing.two + 2 },
  buzzChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  postList: { gap: Spacing.two + 2, marginTop: Spacing.three },
  postCard: { padding: Spacing.three, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.two },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  postAvatar: { width: 26, height: 26, borderRadius: Radius.pill },
  postImage: { width: '100%', height: 160, borderRadius: Radius.sm },
  postStats: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  headliner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  headlinerImg: { width: 56, height: 56, borderRadius: Radius.sm },
  supportRow: { flexDirection: 'row', gap: Spacing.two + 2, marginTop: Spacing.two },
  supportTile: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.three,
    height: 92,
    justifyContent: 'flex-end',
    gap: 2,
    overflow: 'hidden',
  },
  venueCard: { overflow: 'hidden' },
  venueMap: { height: 130 },
  venueInfo: { padding: Spacing.three, gap: Spacing.one + 2 },
  venueBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  mapsBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
  buyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    backgroundColor: '#131313',
  },
  buyFade: { position: 'absolute', top: -Spacing.five, left: 0, right: 0, height: Spacing.five },
  buyContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  followMini: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
