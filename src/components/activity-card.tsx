import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate } from '@/lib/format';
import type { FeedItem } from '@/lib/reviews';

/**
 * One row of the activity stream: who, did what, to which show.
 *
 * Two tap targets, deliberately siblings rather than one card: the avatar and
 * name open the person, everything else opens the show. The old feed rows
 * only ever went to the event, which made the humans in the feed unreachable
 * — and reaching the humans is the entire point of an Activity tab.
 */
export function ActivityCard({ item, showDivider }: { item: FeedItem; showDivider: boolean }) {
  const theme = useTheme();
  const who = item.authorName ?? (item.authorHandle ? `@${item.authorHandle}` : 'Someone');
  const profileKey = item.authorHandle ?? item.authorId;
  const verb =
    item.type === 'rsvp' ? (item.status === 'going' ? 'is going to' : 'is interested in') : 'reviewed';

  return (
    <View style={[styles.row, showDivider && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
      <PressableScale
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={`Open ${who}'s profile`}
        onPress={() => router.push(`/user/${encodeURIComponent(profileKey)}`)}
        style={styles.avatarBtn}>
        {item.authorAvatarUrl ? (
          <Image source={{ uri: item.authorAvatarUrl }} style={[styles.avatar, { backgroundColor: theme.backgroundHigh }]} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty, { backgroundColor: theme.backgroundHigh }]}>
            <Ionicons name="person" size={16} color={theme.textTertiary} />
          </View>
        )}
      </PressableScale>

      <PressableScale
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={`${who} ${verb} ${item.eventName}`}
        onPress={() => router.push(`/event/${encodeURIComponent(item.eventId)}`)}
        style={{ flex: 1, gap: 3 }}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          <ThemedText type="smallBold">{who}</ThemedText>
          {` ${verb} `}
          <ThemedText type="smallBold">{item.eventName}</ThemedText>
        </ThemedText>
        <View style={styles.metaRow}>
          {item.type === 'rsvp' ? (
            <Ionicons
              name={item.status === 'going' ? 'checkmark-circle' : 'sparkles'}
              size={13}
              color={item.status === 'going' ? theme.primary : theme.cyan}
            />
          ) : (
            item.rating != null && <StarRating value={item.rating} size={12} subject="the performance" />
          )}
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {formatEventDate(item.startsAt, null).toUpperCase()}
          </ThemedText>
        </View>
        {item.type === 'review' && !!item.body && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
            {item.body}
          </ThemedText>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  avatarBtn: { paddingTop: 1 },
  avatar: { width: 34, height: 34, borderRadius: Radius.pill },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
});
