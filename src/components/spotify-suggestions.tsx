import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ArtistArt } from '@/components/artist-art';
import { FollowButton } from '@/components/follow-button';
import { PressableScale } from '@/components/pressable-scale';
import { SectionTitle } from '@/components/section-title';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSpotifySuggestions } from '@/hooks/queries';
import { useFollows } from '@/lib/follows-store';
import type { SpotifySuggestion } from '@/lib/types';

/**
 * "You follow these on Spotify, and they're playing."
 *
 * Renders **nothing at all** unless the account has Spotify linked. That isn't
 * only tidiness: the Spotify app is in development mode, so linking is limited to
 * 25 hand-allowlisted accounts, and an entry point that most people cannot use is
 * worse than no entry point. `linked` comes back false for them and this
 * disappears — when extended quota lands it appears on its own, with no release.
 *
 * Acts with shows come first (see the server's sort) because that's the whole
 * proposition; the rest are still listed, because following them is how you find
 * out when they announce one.
 */
export function SpotifySuggestions({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  const { isFollowing, toggle } = useFollows();
  const suggestions = useSpotifySuggestions(signedIn);

  const data = suggestions.data;
  // Not linked, or linked with nothing matched: both are silence rather than an
  // empty state. There is no action to offer — linking happens in Clerk's portal,
  // not here — so a "no results" card would just be noise on the screen.
  if (!signedIn || !data?.linked || data.items.length === 0) {
    if (suggestions.isLoading && signedIn) {
      return <ActivityIndicator color={theme.primary} style={{ marginVertical: Spacing.four }} />;
    }
    return null;
  }

  const playing = data.items.filter((s) => s.upcoming > 0);
  const quiet = data.items.filter((s) => s.upcoming === 0);

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
