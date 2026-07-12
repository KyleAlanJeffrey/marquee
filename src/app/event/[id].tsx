import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
            value={hasTickets ? 'Tickets available' : 'Check back for tickets'}
            valueColor={hasTickets ? theme.cyan : theme.orange}
          />
        </Animated.View>

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
        </View>
      </Animated.ScrollView>

      {/* Floating top bar with back */}
      <View style={styles.topBarAbs}>
        <TopBar transparent onBack={() => router.back()} />
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
          {hasTickets && (
            <GradientButton label="Buy Tickets" onPress={() => Linking.openURL(e.ticket_url!)} />
          )}
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
  headliner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  headlinerImg: { width: 56, height: 56, borderRadius: Radius.sm },
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
