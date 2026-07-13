import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateParts, formatPrice, formatTime, formatVenue } from '@/lib/format';
import type { NearbyEvent } from '@/lib/types';

type Props = {
  event: NearbyEvent;
  following: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
};

/** The hero "Concert Card": wide image, date chip, price, headline stack. */
export function FeaturedCard({ event, following, onPress, onToggleFollow }: Props) {
  const theme = useTheme();
  const genre = event.artist_genres?.[0];
  const { weekday, day, month } = formatEventDateParts(event.starts_at);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      style={[styles.card, { borderColor: theme.border }, Glow.card]}>
      <Image
        source={event.artist_image_url ? { uri: event.artist_image_url } : undefined}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={250}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.1)', theme.background]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.dateChip, { backgroundColor: 'rgba(0,0,0,0.4)', borderColor: theme.border }]}>
        <ThemedText type="labelSm" style={{ color: theme.primary }}>
          {month}
        </ThemedText>
        <ThemedText type="title" style={styles.dateDay}>
          {day}
        </ThemedText>
      </View>

      <Pressable
        onPress={onToggleFollow}
        hitSlop={8}
        style={[
          styles.heart,
          {
            backgroundColor: following ? theme.cyan : 'rgba(0,0,0,0.4)',
            borderColor: following ? theme.cyan : theme.border,
          },
        ]}>
        <Ionicons name={following ? 'heart' : 'heart-outline'} size={20} color={following ? '#00363a' : '#fff'} />
      </Pressable>

      <View style={styles.body}>
        <View style={{ flex: 1 }}>
          <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 1.5 }}>
            {[genre?.toUpperCase(), `${weekday} ${formatTime(event.starts_at)}`].filter(Boolean).join(' • ')}
          </ThemedText>
          <ThemedText type="headline" numberOfLines={1} style={styles.name}>
            {event.artist_name}
          </ThemedText>
          <View style={styles.venueRow}>
            <Ionicons name="location" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
            </ThemedText>
          </View>
        </View>
        <View style={styles.priceCol}>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {event.price_from != null ? 'FROM' : ''}
          </ThemedText>
          <ThemedText type="title" style={{ color: theme.primary }}>
            {formatPrice(event.price_from)}
          </ThemedText>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 16 / 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginHorizontal: Spacing.three,
    // On web the app stretches to the full browser width, which makes a
    // full-bleed 16:10 hero enormous. Cap it and center it like a card
    // (auto margins collapse to 0 on narrow viewports — no overflow).
    ...(Platform.OS === 'web'
      ? { maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, marginHorizontal: 0 }
      : null),
  },
  dateChip: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    minWidth: 46,
    paddingVertical: Spacing.one,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  dateDay: { fontSize: 18, lineHeight: 22 },
  heart: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  name: { color: '#fff', marginTop: 2 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  priceCol: { alignItems: 'flex-end' },
});
