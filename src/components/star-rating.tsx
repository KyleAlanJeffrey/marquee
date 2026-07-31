import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { RATING_MAX, RATING_MIN } from '@/lib/attendances-store';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** 1–5, or null for "not rated". */
  value: number | null;
  /** Omit to render a read-only rating. */
  onChange?: (value: number | null) => void;
  size?: number;
  /** What is being rated, for screen readers — "the performance", "the room". */
  subject?: string;
  /** Shown to the right when nothing is set yet. */
  placeholder?: string;
};

/**
 * Five taps, and a sixth for changing your mind.
 *
 * Tapping the star you already chose clears the rating rather than re-setting it.
 * There is otherwise no way back out of a mis-tap — the control has no zero
 * position — and "I was there but I'd rather not score it" is a state the log
 * explicitly supports, so it needs to be reachable after the fact and not only
 * before.
 */
export function StarRating({ value, onChange, size = 28, subject = 'this show', placeholder }: Props) {
  const theme = useTheme();
  const readOnly = !onChange;
  const stars = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  const press = (star: number) => {
    if (!onChange) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(value === star ? null : star);
  };

  return (
    <View style={styles.row}>
      {stars.map((star) => {
        const filled = value != null && star <= value;
        const label = value === star ? `clear your rating of ${subject}` : `rate ${subject} ${star} of ${RATING_MAX}`;
        const icon = (
          <Ionicons
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? theme.primary : theme.textTertiary}
          />
        );
        return readOnly ? (
          <View key={star}>{icon}</View>
        ) : (
          <PressableScale
            key={star}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: filled }}
            hitSlop={6}
            onPress={() => press(star)}>
            {icon}
          </PressableScale>
        );
      })}
      {value == null && placeholder ? (
        <ThemedText type="labelSm" themeColor="textTertiary" style={styles.placeholder}>
          {placeholder}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  placeholder: { marginLeft: Spacing.two },
});
