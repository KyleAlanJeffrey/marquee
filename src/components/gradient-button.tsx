import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  onPress: () => void;
  /** Full-width block button vs. inline pill. */
  block?: boolean;
  style?: ViewStyle;
};

/** Primary CTA: solid acid lime with near-black text and a soft neon glow. */
export function GradientButton({ label, onPress, block, style }: Props) {
  const theme = useTheme();
  return (
    <PressableScale onPress={onPress} style={[Glow.primary, style]}>
      <LinearGradient
        colors={theme.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.btn, block && styles.block]}>
        <View>
          <ThemedText type="label" style={[styles.label, { color: theme.onPrimary }]}>
            {label}
          </ThemedText>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    // Buttons take the 4px UI radius, not a pill — pills are reserved for chips.
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch', paddingVertical: Spacing.three },
  label: { fontFamily: Fonts.labelBold, fontSize: 15, letterSpacing: 0.5 },
});
