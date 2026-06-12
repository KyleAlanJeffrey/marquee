import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';

import { FollowButton } from '@/components/follow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  useArtist,
  useArtistEvents,
  useFollowExistingArtist,
  useFollows,
  useUnfollowArtist,
} from '@/lib/hooks';
import { formatEventDate, formatVenue } from '@/lib/format';

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const artist = useArtist(id);
  const events = useArtistEvents(id);
  const follows = useFollows();
  const follow = useFollowExistingArtist();
  const unfollow = useUnfollowArtist();

  const isFollowing = (follows.data ?? []).some((f) => f.artist_id === id);

  if (artist.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const a = artist.data;
  if (!a) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">Artist not found.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: a.name }} />
      <FlatList
        data={events.data ?? []}
        keyExtractor={(e) => e.event_id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Image
              source={a.image_url ? { uri: a.image_url } : undefined}
              style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}
              contentFit="cover"
            />
            <ThemedText type="subtitle" style={styles.name}>
              {a.name}
            </ThemedText>
            {a.genres.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {a.genres.slice(0, 3).join(' · ')}
              </ThemedText>
            )}
            <FollowButton
              following={isFollowing}
              pending={follow.isPending || unfollow.isPending}
              onToggle={() => (isFollowing ? unfollow.mutate(a.id) : follow.mutate(a.id))}
            />
            <ThemedText
              type="smallBold"
              themeColor="textSecondary"
              style={styles.sectionTitle}>
              UPCOMING SHOWS
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          events.isLoading ? (
            <ActivityIndicator style={{ marginTop: Spacing.four }} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No upcoming shows on record. New dates are pulled in nightly.
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => item.ticket_url && Linking.openURL(item.ticket_url)}
            style={({ pressed }) => [
              styles.eventRow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                {formatEventDate(item.starts_at)}
              </ThemedText>
              <ThemedText type="small" numberOfLines={1}>
                {formatVenue(item.venue_name, item.venue_city, item.venue_region)}
              </ThemedText>
            </View>
            {item.ticket_url && (
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Tickets →
              </ThemedText>
            )}
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  name: { textAlign: 'center', fontSize: 28, lineHeight: 34 },
  sectionTitle: {
    alignSelf: 'flex-start',
    letterSpacing: 1,
    fontSize: 12,
    marginTop: Spacing.three,
  },
  empty: { textAlign: 'center', padding: Spacing.four },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
});
