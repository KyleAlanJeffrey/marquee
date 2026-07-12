import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
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
    <Animated.View entering={FadeInDown.duration(450)} style={styles.container}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: theme.backgroundElevated, borderColor: 'rgba(236,178,255,0.3)' },
          Glow.purple,
          { shadowOpacity: 0.25 },
        ]}>
        <Ionicons name={icon} size={38} color={theme.primary} />
      </View>
      <ThemedText type="title" style={styles.title}>
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      {actionLabel && onAction && (
        <PressableScale
          onPress={onAction}
          style={[styles.button, { backgroundColor: theme.primary }, Glow.purple]}>
          <ThemedText type="label" style={{ color: theme.onPrimary, fontSize: 13 }}>
            {actionLabel}
          </ThemedText>
        </PressableScale>
      )}
    </Animated.View>
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
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', maxWidth: 320 },
  button: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.pill,
  },
});
