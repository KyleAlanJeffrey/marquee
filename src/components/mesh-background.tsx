import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Ambient "stage light" wash — a purple glow bleeding from the top-left and a
 * cyan glow from the bottom-right over the deep background, approximating the
 * design's mesh gradient. Purely decorative; sits behind all content.
 */
export function MeshBackground() {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} pointerEvents="none">
      <LinearGradient
        colors={['rgba(189,0,255,0.16)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,219,233,0.10)']}
        start={{ x: 0.35, y: 0.5 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
