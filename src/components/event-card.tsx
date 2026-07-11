import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Linking, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  formatDistance,
  formatEventDateParts,
  formatRelativeDay,
  formatVenue,
} from '@/lib/format';

type Props = {
  artistName: string;
  artistImageUrl: string | null;
  startsAt: string;
  venueName: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  distanceMiles: number | null;
  ticketUrl: string | null;
  following?: boolean;
  onPress?: () => void;
};

export function EventCard({
  artistName,
  artistImageUrl,
  startsAt,
  venueName,
  venueCity,
  venueRegion,
  distanceMiles,
  ticketUrl,
  following = false,
  onPress,
}: Props) {
  const theme = useTheme();
  const distance = formatDistance(distanceMiles);
  const { weekday, day } = formatEventDateParts(startsAt);

  return (
    <PressableScale
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.backgroundElement }, Shadow.card]}>
      {following && <View style={[styles.followStripe, { backgroundColor: theme.following }]} />}

      <View style={[styles.dateChip, { backgroundColor: theme.background }]}>
        <ThemedText style={[styles.dateWeekday, { color: theme.tint }]}>{weekday}</ThemedText>
        <ThemedText style={styles.dateDay}>{day}</ThemedText>
      </View>

      <Image
        source={artistImageUrl ? { uri: artistImageUrl } : undefined}
        style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.body}>
        <View style={styles.nameRow}>
          {following && (
            <Ionicons name="star" size={13} color={theme.following} style={styles.star} />
          )}
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {artistName}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(venueName, venueCity, venueRegion)}
        </ThemedText>
        <View style={styles.metaRow}>
          <ThemedText style={[styles.meta, { color: theme.tint }]}>
            {formatRelativeDay(startsAt)}
          </ThemedText>
          {distance && (
            <ThemedText style={[styles.meta, { color: theme.textTertiary }]}>
              {'  ·  '}
              {distance}
            </ThemedText>
          )}
        </View>
      </View>

      {ticketUrl ? (
        <PressableScale
          scaleTo={0.9}
          onPress={() => Linking.openURL(ticketUrl)}
          hitSlop={8}
          style={[styles.ticketBtn, { backgroundColor: theme.tint }]}>
          <Ionicons name="arrow-forward" size={16} color={theme.onTint} />
        </PressableScale>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
    overflow: 'hidden',
  },
  followStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  dateChip: {
    width: 46,
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.one,
  },
  dateWeekday: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, lineHeight: 15 },
  dateDay: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  avatar: { width: 52, height: 52, borderRadius: Radius.md },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  star: { marginTop: 1 },
  name: { flexShrink: 1, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  meta: { fontSize: 13, fontWeight: '600' },
  ticketBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
