import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The base layer every screen sits on: solid charcoal, lifted by a shallow tonal
 * ramp toward the top.
 *
 * Deliberately colourless. Depth in this design comes from tonal layering and
 * glassmorphic surfaces, not from a hue thrown across the background — and this
 * accent is the wrong one to try it with. A purple could tint a whole screen and
 * read as atmosphere; a green this saturated washes every card and label toward
 * it even at 10%. So the light spill is a change in value, not colour.
 *
 * Purely decorative; sits behind all content.
 */
export function StageBackground() {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} pointerEvents="none">
      <LinearGradient
        colors={[theme.backgroundElevated, theme.background]}
        locations={[0, 0.42]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
