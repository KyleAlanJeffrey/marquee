import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
};

/**
 * Tier-2 surface: a translucent dark card with a hairline light border — the
 * glassmorphism the design leans on instead of shadows. (Native lacks a live
 * backdrop blur for arbitrary content, so we use a solid-ish translucent fill
 * that reads the same over the dark background.)
 *
 * Carries no shadow by design. The top edge is lit brighter than the other three
 * instead, which is what suggests a light source above it — the spec's rule for
 * cards, and the reason this doesn't need one.
 */
export function GlassCard({ children, style }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElevated,
          borderColor: theme.border,
          borderTopColor: theme.borderTop,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Containers take 12px; only buttons and inputs go down to 4px.
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
