import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FollowButton } from '@/components/follow-button';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useArtist, useArtistEvents } from '@/lib/hooks';
import { formatEventDateParts, formatTime, formatVenue } from '@/lib/format';

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const artist = useArtist(id);
  const events = useArtistEvents(id);
  const { isFollowing, toggle } = useFollows();

  const following = isFollowing({ artistId: id });

  if (artist.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.tint} />
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
        contentContainerStyle={{ paddingBottom: Spacing.six }}
        ListHeaderComponent={
          <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
            <Image
              source={a.image_url ? { uri: a.image_url } : undefined}
              style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}
              contentFit="cover"
            />
            <ThemedText style={styles.name}>{a.name}</ThemedText>
            {a.genres.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.genres}>
                {a.genres.slice(0, 3).join(' · ')}
              </ThemedText>
            )}
            <View style={styles.followWrap}>
              <FollowButton
                following={following}
                onToggle={() =>
                  toggle({
                    artistId: a.id,
                    spotifyId: a.spotify_id,
                    name: a.name,
                    imageUrl: a.image_url,
                    genres: a.genres,
                  })
                }
              />
            </View>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
              UPCOMING SHOWS
            </ThemedText>
          </Animated.View>
        }
        ListEmptyComponent={
          events.isLoading ? (
            <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.four }} />
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No upcoming shows on record. New dates are pulled in nightly.
            </ThemedText>
          )
        }
        renderItem={({ item, index }) => {
          const { weekday, day, month } = formatEventDateParts(item.starts_at);
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
              <PressableScale
                disabled={!item.ticket_url}
                onPress={() => item.ticket_url && Linking.openURL(item.ticket_url)}
                style={[styles.eventRow, { backgroundColor: theme.backgroundElement }, Shadow.card]}>
                <View style={[styles.dateChip, { backgroundColor: theme.background }]}>
                  <ThemedText style={[styles.chipWeekday, { color: theme.tint }]}>
                    {weekday}
                  </ThemedText>
                  <ThemedText style={styles.chipDay}>{day}</ThemedText>
                  <ThemedText style={[styles.chipMonth, { color: theme.textTertiary }]}>
                    {month}
                  </ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {formatVenue(item.venue_name, item.venue_city, item.venue_region)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatTime(item.starts_at)}
                  </ThemedText>
                </View>
                {item.ticket_url && (
                  <View style={[styles.ticketPill, { backgroundColor: theme.tint }]}>
                    <ThemedText type="smallBold" style={{ color: theme.onTint }}>
                      Tickets
                    </ThemedText>
                  </View>
                )}
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', padding: Spacing.four, gap: Spacing.two },
  avatar: { width: 132, height: 132, borderRadius: Radius.pill },
  name: { fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  genres: { textAlign: 'center' },
  followWrap: { marginTop: Spacing.two },
  sectionTitle: {
    alignSelf: 'flex-start',
    letterSpacing: 1.2,
    fontSize: 12,
    marginTop: Spacing.four,
  },
  empty: { textAlign: 'center', padding: Spacing.four },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  dateChip: {
    width: 52,
    height: 60,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWeekday: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, lineHeight: 14 },
  chipDay: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  chipMonth: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, lineHeight: 13 },
  ticketPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
