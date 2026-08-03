import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtistArt } from '@/components/artist-art';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateParts, formatPrice } from '@/lib/format';
import type { NearbyEvent } from '@/lib/types';

/** Compact 2-up grid card for the Browse All screen. */
export function EventGridCard({
  event,
  following,
  onPress,
  onToggleFollow,
}: {
  event: NearbyEvent;
  following: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
}) {
  const theme = useTheme();
  const genre = event.artist_genres?.[0];
  const { day, month } = formatEventDateParts(event.starts_at, event.venue_timezone);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <View style={styles.imageWrap}>
        <ArtistArt uri={event.artist_image_url} style={StyleSheet.absoluteFill} iconSize={30} />
        <Pressable
          onPress={onToggleFollow}
          hitSlop={8}
          style={[styles.heart, { backgroundColor: following ? theme.cyan : 'rgba(0,0,0,0.45)', borderColor: theme.border }]}>
          <Ionicons name={following ? 'heart' : 'heart-outline'} size={15} color={following ? theme.onCyan : theme.onImage} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <ThemedText type="labelSm" style={{ color: theme.primary }} numberOfLines={1}>
          {[genre?.toUpperCase(), `${month} ${day}`].filter(Boolean).join(' • ')}
        </ThemedText>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {event.artist_name}
        </ThemedText>
        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatPrice(event.price_from)}
          </ThemedText>
          <Ionicons name="ticket-outline" size={16} color={theme.cyan} />
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  imageWrap: { height: 112, backgroundColor: 'rgba(255,255,255,0.04)' },
  heart: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: Spacing.two + 2, gap: 3 },
  name: { fontSize: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
});
