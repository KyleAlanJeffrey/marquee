import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FollowButton } from '@/components/follow-button';
import { GenreChip } from '@/components/genre-chip';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useArtistSearch } from '@/lib/hooks';

export default function SearchScreen() {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const search = useArtistSearch(query);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: theme.inputBg,
            borderColor: focused ? theme.cyan : theme.border,
          },
        ]}>
        <Ionicons name="search" size={18} color={focused ? theme.cyan : theme.textTertiary} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Artists, venues, or vibes…"
          placeholderTextColor={theme.textTertiary}
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
          <ActivityIndicator color={theme.primary} />
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
                  style={[styles.avatar, { backgroundColor: theme.backgroundElevated }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  {item.genres.length > 0 && <GenreChip label={item.genres[0]} tone="neutral" />}
                </View>
                <FollowButton
                  compact
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    margin: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  input: { flex: 1, paddingVertical: Spacing.two + 4, fontSize: 16, fontFamily: Fonts.body },
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
