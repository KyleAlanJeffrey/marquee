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
 */
export function GlassCard({ children, style }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
