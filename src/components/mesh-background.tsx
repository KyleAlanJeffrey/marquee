import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Ambient "stage light" wash — a lime glow bleeding from the top-left and a
 * cyan glow from the bottom-right over the charcoal base. Both sit far below the
 * opacity of the accents themselves: lime is the brightest colour in the palette
 * and reads as a haze rather than a wash past about 12%. Purely decorative; sits
 * behind all content.
 */
export function MeshBackground() {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} pointerEvents="none">
      <LinearGradient
        colors={['rgba(195,244,0,0.10)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(125,244,255,0.07)']}
        start={{ x: 0.35, y: 0.5 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
