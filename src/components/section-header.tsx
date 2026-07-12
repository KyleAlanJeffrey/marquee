import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Section title in the Sora headline voice, with an optional trailing accent. */
export function SectionHeader({ children, accent }: { children: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {accent && <View style={[styles.bar, { backgroundColor: theme.primary }]} />}
      <ThemedText type="title">{children}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two + 2,
  },
  bar: { width: 4, height: 22, borderRadius: 2 },
});
