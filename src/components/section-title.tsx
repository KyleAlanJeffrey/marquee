import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  /** Trailing "See all" style action. */
  actionLabel?: string;
  onAction?: () => void;
  /** Small HOT-style badge next to the title. */
  badge?: string;
  accent?: boolean;
};

export function SectionTitle({ title, actionLabel, onAction, badge, accent }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {accent && <View style={[styles.bar, { backgroundColor: theme.primary }]} />}
        <ThemedText type="title">{title}</ThemedText>
        {badge && (
          <View style={[styles.badge, { backgroundColor: theme.orangeVivid }]}>
            <ThemedText type="labelSm" style={styles.badgeText}>
              {badge.toUpperCase()}
            </ThemedText>
          </View>
        )}
      </View>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={16} style={styles.action}>
          <ThemedText type="label" style={{ color: theme.primary, fontSize: 12 }}>
            {actionLabel}
          </ThemedText>
          <Ionicons name="arrow-forward" size={14} color={theme.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: Spacing.two, paddingLeft: Spacing.three },
  bar: { width: 4, height: 22, borderRadius: 2 },
  badge: { paddingHorizontal: Spacing.one + 2, paddingVertical: 2, borderRadius: Radius.xs },
  badgeText: { color: '#fff', letterSpacing: 1, fontSize: 10 },
});
