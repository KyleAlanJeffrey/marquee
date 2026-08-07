import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FollowButton } from '@/components/follow-button';
import { GenreChip } from '@/components/genre-chip';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { SearchBar } from '@/components/search-bar';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ensureArtist } from '@/lib/discovery';
import { useFollows } from '@/lib/follows-store';
import { personLabel, usePersonSearch, type PersonSearchResult } from '@/lib/people';
import { useArtistSearch, useTownSearch } from '@/hooks/queries';
import type { ArtistSearchResult, Town } from '@/lib/types';

/** Wide enough to cover a metro area from the centroid of its venues. */
const TOWN_RADIUS_MILES = 25;

/** "Austin, TX" · "London, ON" · "London, United Kingdom" — a bare "London"
 *  twice in one list tells nobody which one they want. */
const townLabel = (t: Town) => [t.city, t.region || t.country].filter(Boolean).join(', ');

export default function SearchScreen() {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  // `?only=people` narrows the whole screen to people. Activity's "Find
  // people" opens it that way: a button that says people and then answers
  // with artists and towns is answering a question nobody asked, and the
  // artist hits — the loudest rows, with follow buttons — bury the humans.
  const { only } = useLocalSearchParams<{ only?: string }>();
  const peopleOnly = only === 'people';
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  // Nothing else is even fetched in people-only mode.
  const search = useArtistSearch(query, !peopleOnly);
  const towns = useTownSearch(query, !peopleOnly);
  const people = usePersonSearch(query);

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
  const peopleRows = people.data?.people ?? [];

  /** A person, as a row. The list item in people-only mode; a header row in
   *  the mixed one, where artists own the list. */
  const personRow = (p: (typeof peopleRows)[number]) => (
    <PressableScale
      key={p.id}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={`Open ${personLabel(p)}'s profile`}
      onPress={() => router.push(`/user/${encodeURIComponent(p.handle ?? p.id)}`)}
      style={[styles.townRow, peopleOnly && styles.personRowInset]}>
      {p.avatarUrl ? (
        <Image
          source={{ uri: p.avatarUrl }}
          style={[styles.personAvatar, { backgroundColor: theme.backgroundElevated }]}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.townIcon, { backgroundColor: theme.backgroundElevated }]}>
          <Ionicons name="person" size={18} color={theme.primary} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {personLabel(p)}
        </ThemedText>
        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
          {p.handle && p.displayName ? `@${p.handle} · ` : ''}
          {p.followers} {p.followers === 1 ? 'follower' : 'followers'}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </PressableScale>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* The modal's own header, set from here rather than the layout, because
          only this screen knows which mode it opened in. */}
      <Stack.Screen options={{ title: peopleOnly ? 'Find people' : 'Find artists' }} />
      <PageMeta
        title={peopleOnly ? 'Find people' : 'Find artists, towns and people'}
        description={
          peopleOnly
            ? 'Find people on Marquee and follow the ones whose nights you want to see.'
            : 'Search millions of artists, jump straight to the upcoming shows in any town, or find people to follow.'
        }
      />
      {/* One list, two kinds of row — artists normally, people in people-only
          mode. Typed as the union rather than split into two FlatLists so the
          header (and the search bar inside it) is never remounted by a mode
          change, which would drop the keyboard. */}
      <FlatList<ArtistSearchResult | PersonSearchResult>
        data={peopleOnly ? peopleRows : (search.data ?? [])}
        keyExtractor={(item) => ('spotify_id' in item ? item.spotify_id : item.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        // The header is passed as an element (not a component) so it reconciles
        // instead of remounting on each keystroke — a remount would drop the
        // keyboard mid-word. See SearchBar for why the focus glow must not live
        // in this component's state.
        ListHeaderComponent={
          <View>
            <SearchBar
              value={input}
              onChangeText={setInput}
              placeholder={peopleOnly ? 'Find people by name…' : 'Artists, towns or people…'}
              accessibilityLabel={peopleOnly ? 'Search people' : 'Search artists, towns and people'}
              barStyle={styles.searchBar}
              inputStyle={styles.input}
            />
            {!peopleOnly && townRows.length > 0 && (
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
            {!peopleOnly && peopleRows.length > 0 && (
              <View style={styles.section}>
                <ThemedText type="label" style={{ color: theme.textTertiary }}>
                  PEOPLE
                </ThemedText>
                {peopleRows.map(personRow)}
              </View>
            )}
            {!peopleOnly && query.length >= 2 && (townRows.length > 0 || peopleRows.length > 0) && (
              <View style={styles.section}>
                <ThemedText type="label" style={{ color: theme.textTertiary }}>
                  ARTISTS
                </ThemedText>
              </View>
            )}
            {(peopleOnly ? people.isLoading : search.isLoading) && query.length >= 2 && (
              <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.three }} />
            )}
          </View>
        }
        ListEmptyComponent={
          (peopleOnly ? people.isLoading : search.isLoading) && query.length >= 2 ? null : (
            <ThemedText themeColor="textSecondary" style={styles.hint}>
              {peopleOnly
                ? query.length >= 2 && people.isFetched
                  ? `No one found for “${query}”.`
                  : 'Search for people by name and follow the ones whose nights you want to see.'
                : query.length >= 2 && search.isFetched
                  ? `No artists found for “${query}”.`
                  : 'Search artists, towns and people — follow the acts you love to spotlight their shows near you, and the friends whose nights you want to see.'}
            </ThemedText>
          )
        }
        renderItem={({ item, index }) => {
          if (peopleOnly) return personRow(item as (typeof peopleRows)[number]);
          const artist = item as ArtistSearchResult;
          const following = isFollowing({ spotifyId: artist.spotify_id });
          const isOpening = opening === artist.spotify_id;
          return (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index * 40, 300)).duration(320)}
              style={styles.row}>
              <PressableScale
                haptic={false}
                onPress={() => openArtist(artist)}
                style={styles.rowMain}>
                <Image
                  source={artist.image_url ? { uri: artist.image_url } : undefined}
                  style={[styles.avatar, { backgroundColor: theme.backgroundElevated }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {artist.name}
                  </ThemedText>
                  {artist.genres.length > 0 && <GenreChip label={artist.genres[0]} tone="neutral" />}
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
                    spotifyId: artist.spotify_id,
                    name: artist.name,
                    imageUrl: artist.image_url,
                    genres: artist.genres,
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
  personAvatar: { width: 40, height: 40, borderRadius: Radius.pill },
  // People-only: the rows are the list, so they carry the gutter the section
  // wrapper gives them in mixed mode.
  personRowInset: { paddingHorizontal: Spacing.three },
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
