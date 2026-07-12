import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { GenreChip } from '@/components/genre-chip';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay, formatVenue } from '@/lib/format';
import type { NearbyEvent } from '@/lib/types';

type Props = {
  event: NearbyEvent;
  following: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
};

/** The hero "Concert Card": full-bleed image, gradient scrim, headline stack. */
export function FeaturedCard({ event, following, onPress, onToggleFollow }: Props) {
  const theme = useTheme();
  const genre = event.artist_genres?.[0];

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      style={[styles.card, { borderColor: theme.border }, Glow.card]}>
      <Image
        source={event.artist_image_url ? { uri: event.artist_image_url } : undefined}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={250}
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

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
        <Ionicons
          name={following ? 'heart' : 'heart-outline'}
          size={20}
          color={following ? '#00363a' : '#fff'}
        />
      </Pressable>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          {genre ? <GenreChip label={genre} tone="purple" /> : <View />}
          <ThemedText type="label" style={{ color: theme.textSecondary }}>
            {formatRelativeDay(event.starts_at).toUpperCase()}
          </ThemedText>
        </View>
        <ThemedText type="headline" numberOfLines={2} style={styles.name}>
          {event.artist_name}
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(event.venue_name, event.venue_city, event.venue_region)}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 4 / 5,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginHorizontal: Spacing.three,
  },
  heart: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    width: 44,
    height: 44,
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
    padding: Spacing.four,
    gap: Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  name: { color: '#fff' },
});
