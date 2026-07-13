import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/error-state';
import { GalleryStrip } from '@/components/gallery-strip';
import { GenreChip } from '@/components/genre-chip';
import { GlassCard } from '@/components/glass-card';
import { GradientButton } from '@/components/gradient-button';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useEvent } from '@/lib/hooks';
import { formatEventDate, formatTime, formatVenue } from '@/lib/format';
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

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image
            source={e.artist.image_url ? { uri: e.artist.image_url } : undefined}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.35)', 'transparent', theme.background]}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBody}>
            <View style={styles.chips}>
              {(e.artist.genres ?? []).slice(0, 2).map((g, i) => (
                <GenreChip key={g} label={g} tone={i === 0 ? 'purple' : 'cyan'} />
              ))}
            </View>
            <ThemedText type="display" numberOfLines={3} style={styles.heroTitle}>
              {e.name}
            </ThemedText>
            <ThemedText type="bodyLg" style={{ color: theme.textSecondary }}>
              {e.artist.name}
            </ThemedText>
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

          <View style={styles.supportRow}>
            {['Support', 'Support'].map((s, i) => (
              <View
                key={i}
                style={[styles.supportTile, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                <LinearGradient
                  colors={i === 0 ? ['rgba(189,0,255,0.25)', 'transparent'] : ['rgba(0,219,233,0.22)', 'transparent']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 1, y: 0 }}
                />
                <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
                  {s.toUpperCase()}
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: theme.text }}>
                  To be announced
                </ThemedText>
              </View>
            ))}
          </View>
        </View>

        {/* The Venue */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Venue</ThemedText>
        </View>
        <View style={styles.section}>
          <GlassCard style={styles.venueCard}>
            <View style={styles.venueMap}>
              <LinearGradient colors={['#161422', '#0e0e0e']} style={StyleSheet.absoluteFill} />
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={`h${i}`} style={[styles.vGrid, { top: `${((i + 1) / 5) * 100}%`, left: 0, right: 0, height: 1 }]} />
              ))}
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={`v${i}`} style={[styles.vGrid, { left: `${((i + 1) / 5) * 100}%`, top: 0, bottom: 0, width: 1 }]} />
              ))}
              <View style={styles.venuePinWrap}>
                <Ionicons name="location" size={26} color={theme.cyan} />
              </View>
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
  heroBody: { padding: Spacing.three, gap: Spacing.two },
  chips: { flexDirection: 'row', gap: Spacing.two },
  heroTitle: { color: '#fff' },
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
  vGrid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
  venuePinWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
