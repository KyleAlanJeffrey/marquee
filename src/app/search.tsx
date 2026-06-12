import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';

import { FollowButton } from '@/components/follow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useArtistSearch, useFollowArtist, useFollows, useUnfollowArtist } from '@/lib/hooks';

export default function SearchScreen() {
  const theme = useTheme();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const search = useArtistSearch(query);
  const follows = useFollows();
  const followArtist = useFollowArtist();
  const unfollowArtist = useUnfollowArtist();

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  // spotify_id -> our artist id, for artists we already follow
  const followedBySpotifyId = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of follows.data ?? []) {
      if (f.artist.spotify_id) map.set(f.artist.spotify_id, f.artist_id);
    }
    return map;
  }, [follows.data]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="Search artists…"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        autoCorrect={false}
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text },
        ]}
      />
      {search.isLoading && query.length >= 2 ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={search.data ?? []}
          keyExtractor={(a) => a.spotify_id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query.length >= 2 && search.isFetched ? (
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                No artists found for “{query}”.
              </ThemedText>
            ) : (
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                Search Spotify’s catalog and follow artists to get concert alerts.
              </ThemedText>
            )
          }
          renderItem={({ item }) => {
            const followedArtistId = followedBySpotifyId.get(item.spotify_id);
            return (
              <View style={styles.row}>
                <Image
                  source={item.image_url ? { uri: item.image_url } : undefined}
                  style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  {item.genres.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {item.genres.slice(0, 3).join(' · ')}
                    </ThemedText>
                  )}
                </View>
                <FollowButton
                  following={!!followedArtistId}
                  pending={followArtist.isPending || unfollowArtist.isPending}
                  onToggle={() => {
                    if (followedArtistId) {
                      unfollowArtist.mutate(followedArtistId);
                    } else {
                      followArtist.mutate({
                        spotify_id: item.spotify_id,
                        name: item.name,
                        image_url: item.image_url,
                        genres: item.genres,
                      });
                    }
                  }}
                />
              </View>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  input: {
    margin: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    borderRadius: 12,
    fontSize: 16,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { textAlign: 'center', padding: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
});
