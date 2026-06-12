import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  following: boolean;
  pending?: boolean;
  onToggle: () => void;
};

export function FollowButton({ following, pending, onToggle }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={pending}
      style={({ pressed }) => [
        styles.button,
        following
          ? { backgroundColor: theme.backgroundSelected }
          : { backgroundColor: theme.tint },
        pressed && { opacity: 0.85 },
      ]}>
      {pending ? (
        <ActivityIndicator size="small" color={following ? theme.text : theme.onTint} />
      ) : (
        <ThemedText
          type="smallBold"
          style={{ color: following ? theme.text : theme.onTint }}>
          {following ? 'Following' : 'Follow'}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    minWidth: 92,
    alignItems: 'center',
  },
});
