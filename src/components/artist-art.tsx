import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { artistImageSrc } from '@/lib/api';

/**
 * An artist image, or something designed instead of a blank box.
 *
 * 73% of the catalogue's artists have no image from any source (measured on
 * production 2026-08-03 — 4,447 of 6,050, mostly small acts the artist crawl
 * found), and an empty grey rectangle on every card for them read as a
 * broken app rather than a missing photo. The fallback is the same glyph the
 * log wall already uses, so "no photo" looks the same everywhere.
 */
export function ArtistArt({
  uri,
  artistId,
  style,
  iconSize = 24,
}: {
  uri: string | null | undefined;
  /**
   * The stored artist, when the caller knows it. Given one, the photo is
   * fetched from our own mirror rather than hotlinked — see `artistImageSrc`.
   * `uri` is still required either way: it answers "is there a photo", which
   * the id can't, and it remains the source for callers that have no id yet
   * (a search hit isn't a stored artist until somebody opens it).
   */
  artistId?: string | null;
  /** Sizing + radius come from the caller; both branches wear it. */
  style: StyleProp<ViewStyle>;
  iconSize?: number;
}) {
  const theme = useTheme();
  if (uri) {
    const src = artistImageSrc(artistId) ?? uri;
    return (
      <Image source={{ uri: src }} style={style as object} contentFit="cover" transition={200} />
    );
  }
  return (
    <View style={[style, styles.fallback, { backgroundColor: theme.backgroundHigh }]}>
      <Ionicons name="musical-notes" size={iconSize} color={theme.textTertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
