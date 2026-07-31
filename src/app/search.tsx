import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FollowButton } from '@/components/follow-button';
import { GenreChip } from '@/components/genre-chip';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ensureArtist } from '@/lib/discovery';
import { useFollows } from '@/lib/follows-store';
import { useArtistSearch, useTownSearch } from '@/lib/hooks';
import type { ArtistSearchResult, Town } from '@/lib/types';

/** Wide enough to cover a metro area from the centroid of its venues. */
const TOWN_RADIUS_MILES = 25;

/** "Austin, TX" · "London, ON" · "London, United Kingdom" — a bare "London"
 *  twice in one list tells nobody which one they want. */
const townLabel = (t: Town) => [t.city, t.region || t.country].filter(Boolean).join(', ');

export default function SearchScreen() {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const search = useArtistSearch(query);
  const towns = useTownSearch(query);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  // Resolve the Spotify hit to a stored artist, then open their page (which
  // pulls their upcoming shows from Ticketmaster on open).
  async function openArtist(item: ArtistSearchResult) {
    if (opening) return;
    setOpening(item.spotify_id);
    const id = await ensureArtist({
      artistId: null,
      spotifyId: item.spotify_id,
      name: item.name,
      imageUrl: item.image_url,
      genres: item.genres,
    });
    setOpening(null);
    if (id) router.push(`/artist/${id}`);
  }

  // A town opens the normal nearby feed, centred on the town instead of on the
  // device — so genres, paging and the map all come for free.
  function openTown(town: Town) {
    const label = encodeURIComponent(townLabel(town));
    router.push(`/browse?lat=${town.lat}&lng=${town.lng}&radius=${TOWN_RADIUS_MILES}&town=${label}`);
  }

  const townRows = towns.data ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <PageMeta
        title="Find artists and towns"
        description="Search millions of artists, or jump straight to the upcoming shows in any town."
      />
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: theme.inputBg,
            borderColor: focused ? theme.primary : theme.border,
          },
          // The design language asks a focused field to glow in the primary, not
          // just change its border colour.
          focused && Glow.primary,
        ]}>
        <Ionicons name="search" size={18} color={focused ? theme.primary : theme.textTertiary} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Artists or towns…"
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

      <FlatList
        data={search.data ?? []}
        keyExtractor={(a) => a.spotify_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {townRows.length > 0 && (
              <View style={styles.section}>
                <ThemedText type="label" style={{ color: theme.textTertiary }}>
                  {query.length >= 2 ? 'TOWNS' : 'BUSIEST TOWNS'}
                </ThemedText>
                {townRows.map((town) => (
                  <PressableScale
                    key={`${town.city}|${town.region ?? ''}`}
                    haptic={false}
                    onPress={() => openTown(town)}
                    style={styles.townRow}>
                    <View style={[styles.townIcon, { backgroundColor: theme.backgroundElevated }]}>
                      <Ionicons name="location" size={18} color={theme.cyan} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {townLabel(town)}
                      </ThemedText>
                      <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                        {town.upcoming} {town.upcoming === 1 ? 'show' : 'shows'} · {town.venues}{' '}
                        {town.venues === 1 ? 'venue' : 'venues'}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
                  </PressableScale>
                ))}
              </View>
            )}
            {query.length >= 2 && townRows.length > 0 && (
              <View style={styles.section}>
                <ThemedText type="label" style={{ color: theme.textTertiary }}>
                  ARTISTS
                </ThemedText>
              </View>
            )}
            {search.isLoading && query.length >= 2 && (
              <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.three }} />
            )}
          </View>
        }
        ListEmptyComponent={
          search.isLoading && query.length >= 2 ? null : (
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {query.length >= 2 && search.isFetched
                ? `No artists found for “${query}”.`
                : 'Search artists and towns — follow the acts you love to spotlight their shows near you.'}
            </ThemedText>
          )
        }
        renderItem={({ item, index }) => {
          const following = isFollowing({ spotifyId: item.spotify_id });
          const isOpening = opening === item.spotify_id;
          return (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index * 40, 300)).duration(320)}
              style={styles.row}>
              <PressableScale
                haptic={false}
                onPress={() => openArtist(item)}
                style={styles.rowMain}>
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
                {isOpening ? (
                  <ActivityIndicator color={theme.textTertiary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
                )}
              </PressableScale>
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
    // Inputs take the 4px UI radius, same as buttons.
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  input: { flex: 1, paddingVertical: Spacing.two + 4, fontSize: 16, fontFamily: Fonts.body },
  list: { paddingBottom: Spacing.five },
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one },
  townRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  townIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { textAlign: 'center', padding: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 52, height: 52, borderRadius: Radius.pill },
});
