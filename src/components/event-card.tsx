import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatEventDate, formatVenue } from '@/lib/format';

type Props = {
  artistName: string;
  artistImageUrl: string | null;
  startsAt: string;
  venueName: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  distanceMiles: number | null;
  ticketUrl: string | null;
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
  onPress,
}: Props) {
  const theme = useTheme();
  const distance = formatDistance(distanceMiles);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Image
        source={artistImageUrl ? { uri: artistImageUrl } : undefined}
        style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {artistName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(venueName, venueCity, venueRegion)}
        </ThemedText>
        <View style={styles.metaRow}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            {formatEventDate(startsAt)}
          </ThemedText>
          {distance && (
            <ThemedText type="small" themeColor="textSecondary">
              {' '}· {distance} away
            </ThemedText>
          )}
        </View>
      </View>
      {ticketUrl && (
        <Pressable
          onPress={() => Linking.openURL(ticketUrl)}
          hitSlop={8}
          style={[styles.ticketButton, { backgroundColor: theme.tint }]}>
          <ThemedText type="smallBold" style={{ color: theme.onTint }}>
            Tickets
          </ThemedText>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticketButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
