import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FollowButton } from '@/components/follow-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useArtistSearch } from '@/lib/hooks';

export default function SearchScreen() {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const search = useArtistSearch(query);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search artists…"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
        />
        {input.length > 0 && (
          <Ionicons
            name="close-circle"
            size={18}
            color={theme.textTertiary}
            onPress={() => setInput('')}
          />
        )}
      </View>

      {search.isLoading && query.length >= 2 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.tint} />
        </View>
      ) : (
        <FlatList
          data={search.data ?? []}
          keyExtractor={(a) => a.spotify_id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {query.length >= 2 && search.isFetched
                ? `No artists found for “${query}”.`
                : 'Search Spotify’s catalog and follow artists to spotlight their shows near you.'}
            </ThemedText>
          }
          renderItem={({ item, index }) => {
            const following = isFollowing({ spotifyId: item.spotify_id });
            return (
              <Animated.View
                entering={FadeInDown.delay(Math.min(index * 40, 300)).duration(320)}
                style={styles.row}>
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
                  following={following}
                  onToggle={() =>
                    toggle({
                      artistId: null,
                      spotifyId: item.spotify_id,
                      name: item.name,
                      imageUrl: item.image_url,
                      genres: item.genres,
                    })
                  }
                />
              </Animated.View>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    margin: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  input: { flex: 1, paddingVertical: Spacing.two + 4, fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: Spacing.five },
  hint: { textAlign: 'center', padding: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  avatar: { width: 52, height: 52, borderRadius: Radius.pill },
});
