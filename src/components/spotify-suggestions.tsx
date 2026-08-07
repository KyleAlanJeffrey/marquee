import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { ArtistArt } from '@/components/artist-art';
import { FollowButton } from '@/components/follow-button';
import { PressableScale } from '@/components/pressable-scale';
import { SectionTitle } from '@/components/section-title';
import { SpotifyConnect } from '@/components/spotify-connect';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSpotifySuggestions } from '@/hooks/queries';
import { useFollows } from '@/lib/follows-store';
import type { SpotifySuggestion } from '@/lib/types';

/**
 * "You follow these on Spotify, and they're playing."
 *
 * Three states, and each one is deliberate:
 *
 * - **signed out** — nothing. A sign-in prompt belongs to the screens that need
 *   an account, not to a suggestion block that happens to be on the page.
 * - **signed in, not linked** — the connect card. This is the state that makes
 *   the feature reachable by people who already had an account before Spotify
 *   was ever offered at sign-in, which is nearly everyone.
 * - **linked** — the suggestions, acts with dates first (the server sorts them),
 *   because that's the proposition. The ones with nothing on sale still make the
 *   `list` variant, since following them is how you hear about the announcement.
 *
 * A note on the connect card and Spotify's development mode: linking is capped at
 * 25 hand-allowlisted accounts, so for anyone else Spotify refuses at its own
 * authorize step. There is no way to know that in advance from here, so the card
 * is offered to every signed-in account and a refusal reads as "try again". At
 * seven users that exposure is nil; if the user base grows before extended quota
 * lands, this is the thing to gate rather than the suggestions.
 */
export function SpotifySuggestions({
  signedIn,
  /**
   * `list` is the full thing, for a screen about who you follow. `rail` is the
   * Explore shape: horizontal, and **only acts with dates**, because Explore is
   * about what's on — a rail of artists with nothing on sale is a dead end in
   * the middle of a discovery screen.
   */
  variant = 'list',
}: {
  signedIn: boolean;
  variant?: 'list' | 'rail';
}) {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  const suggestions = useSpotifySuggestions(signedIn);

  const data = suggestions.data;

  // Signed out has nothing to offer here: the sign-in prompt belongs to the
  // screens that need an account, not to a suggestion block.
  if (!signedIn) return null;
  if (suggestions.isLoading) {
    return <ActivityIndicator color={theme.primary} style={{ marginVertical: Spacing.four }} />;
  }
  // Signed in and not linked is the one case with an action worth offering, and
  // it's the whole reason this isn't sign-up-only: an account that already exists
  // can connect Spotify from here.
  if (!data?.linked) return <SpotifyConnect compact={variant === 'rail'} />;

  const playing = data.items.filter((s) => s.upcoming > 0);
  const quiet = data.items.filter((s) => s.upcoming === 0);

  // Linked, matched nothing playing: silence on Explore (see `variant`), and on
  // the list a "follow them anyway" group still earns its place.
  if (variant === 'rail') {
    if (playing.length === 0) return null;
    return (
      <View style={styles.railBlock}>
        <SectionTitle title="From your Spotify" />
        <FlatList
          horizontal
          data={playing}
          keyExtractor={(s) => s.spotify_id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railContent}
          renderItem={({ item }) => (
            <PressableScale
              haptic={false}
              disabled={!item.artist_id}
              accessibilityRole={item.artist_id ? 'link' : undefined}
              accessibilityLabel={item.artist_id ? `Open ${item.name}` : undefined}
              onPress={() => item.artist_id && router.push(`/artist/${item.artist_id}`)}
              style={styles.railItem}>
              <ArtistArt uri={item.image_url} artistId={item.artist_id} style={styles.railArt} iconSize={24} />
              <ThemedText type="labelSm" numberOfLines={1} style={styles.railName}>
                {item.name}
              </ThemedText>
              <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                {item.upcoming} {item.upcoming === 1 ? 'SHOW' : 'SHOWS'}
              </ThemedText>
            </PressableScale>
          )}
        />
      </View>
    );
  }

  if (data.items.length === 0) return null;

  const row = (s: SpotifySuggestion) => {
    const ref = { artistId: s.artist_id, spotifyId: s.spotify_id };
    return (
      <View key={s.spotify_id} style={styles.row}>
        <PressableScale
          haptic={false}
          disabled={!s.artist_id}
          accessibilityRole={s.artist_id ? 'link' : undefined}
          accessibilityLabel={s.artist_id ? `Open ${s.name}` : undefined}
          onPress={() => s.artist_id && router.push(`/artist/${s.artist_id}`)}
          style={styles.rowMain}>
          <ArtistArt uri={s.image_url} artistId={s.artist_id} style={styles.art} iconSize={20} />
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {s.name}
            </ThemedText>
            <ThemedText type="labelSm" style={{ color: s.upcoming > 0 ? theme.cyan : theme.textTertiary }}>
              {s.upcoming > 0
                ? `${s.upcoming} ${s.upcoming === 1 ? 'SHOW' : 'SHOWS'} ON SALE`
                : s.source === 'followed'
                  ? 'YOU FOLLOW ON SPOTIFY'
                  : 'YOU LISTEN A LOT'}
            </ThemedText>
          </View>
        </PressableScale>
        <FollowButton
          compact
          following={isFollowing(ref)}
          onToggle={() =>
            toggle({
              artistId: s.artist_id,
              spotifyId: s.spotify_id,
              name: s.name,
              imageUrl: s.image_url,
              genres: s.genres,
            })
          }
        />
      </View>
    );
  };

  return (
    <View style={styles.block}>
      <SectionTitle title="From your Spotify" />
      {playing.length > 0 && (
        <View style={styles.group}>
          <ThemedText type="labelSm" style={[styles.groupLabel, { color: theme.textTertiary }]}>
            PLAYING SOON
          </ThemedText>
          {playing.map(row)}
        </View>
      )}
      {quiet.length > 0 && (
        <View style={styles.group}>
          <ThemedText type="labelSm" style={[styles.groupLabel, { color: theme.textTertiary }]}>
            NO DATES YET — FOLLOW TO BE TOLD
          </ThemedText>
          {quiet.map(row)}
        </View>
      )}
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={14} color={theme.textTertiary} />
        <ThemedText type="labelSm" style={{ color: theme.textTertiary, flex: 1 }}>
          Read from your account when you asked for it. Nothing is posted, and
          nothing about your listening is stored.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two, paddingBottom: Spacing.four },
  railBlock: { gap: Spacing.one, paddingBottom: Spacing.three },
  railContent: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  railItem: { width: 84, alignItems: 'center', gap: 4 },
  railArt: { width: 72, height: 72, borderRadius: Radius.pill },
  railName: { textAlign: 'center' },
  group: { gap: Spacing.one },
  groupLabel: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  art: { width: 44, height: 44, borderRadius: Radius.pill },
  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
