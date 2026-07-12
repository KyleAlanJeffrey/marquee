import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { DateBlock } from '@/components/date-block';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatRelativeDay, formatVenue } from '@/lib/format';

type Props = {
  artistName: string;
  artistImageUrl: string | null;
  startsAt: string;
  venueName: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  distanceMiles: number | null;
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
  following = false,
  onPress,
}: Props) {
  const theme = useTheme();
  const distance = formatDistance(distanceMiles);

  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElevated,
          borderColor: following ? 'rgba(0,219,233,0.35)' : theme.border,
        },
      ]}>
      <DateBlock startsAt={startsAt} />

      <Image
        source={artistImageUrl ? { uri: artistImageUrl } : undefined}
        style={[styles.avatar, { backgroundColor: theme.backgroundHigh }]}
        contentFit="cover"
        transition={200}
      />

      <View style={styles.body}>
        <View style={styles.nameRow}>
          {following && <Ionicons name="heart" size={13} color={theme.cyan} />}
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {artistName}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatVenue(venueName, venueCity, venueRegion)}
        </ThemedText>
        <View style={styles.metaRow}>
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            {formatRelativeDay(startsAt).toUpperCase()}
          </ThemedText>
          {distance && (
            <ThemedText type="labelSm" style={{ color: theme.cyan }}>
              {'   '}
              {distance.toUpperCase()}
            </ThemedText>
          )}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  avatar: { width: 52, height: 52, borderRadius: Radius.sm },
  body: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
});
