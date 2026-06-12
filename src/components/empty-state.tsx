import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, message, actionLabel, onAction }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={44} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.onTint }}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
  },
  button: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    borderRadius: 999,
  },
});
