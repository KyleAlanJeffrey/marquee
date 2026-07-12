import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Horizontal photo strip. We only have the artist's single hero image, so we
 * present it across a few tiles with varied crops + tints — an atmosphere
 * gallery rather than fabricated distinct photos.
 */
export function GalleryStrip({ imageUrl }: { imageUrl: string | null }) {
  const theme = useTheme();
  const crops: { x: number; y: number }[] = [
    { x: 0.5, y: 0.2 },
    { x: 0.2, y: 0.6 },
    { x: 0.8, y: 0.5 },
    { x: 0.5, y: 0.85 },
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {crops.map((c, i) => (
        <View key={i} style={[styles.tile, { backgroundColor: theme.backgroundHigh, borderColor: theme.border }]}>
          <Image
            source={imageUrl ? { uri: imageUrl } : undefined}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={{ top: `${c.y * 100}%`, left: `${c.x * 100}%` }}
            transition={200}
          />
          <LinearGradient
            colors={i % 2 ? ['rgba(0,219,233,0.18)', 'transparent'] : ['rgba(189,0,255,0.18)', 'transparent']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
          />
          <View style={[styles.likeChip, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
            <Ionicons name="heart" size={12} color="#fff" />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: Spacing.three, gap: Spacing.two + 2 },
  tile: {
    width: 150,
    height: 190,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  likeChip: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 3,
    borderRadius: Radius.xs,
  },
});
