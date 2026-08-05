import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Glow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The search field for the find-a-thing screens, owning its own focus glow —
 * which is WEB-ONLY, and that is load-bearing, not a style choice.
 *
 * On iOS (inside the native-stack modals) any React state flip in the focus
 * window makes the field resign first responder on the spot: probes showed
 * FOCUS then BLUR back-to-back and the input read as dead even though every
 * tap reached it. Deferring the flip with setTimeout(0) still lands inside
 * the responder handoff and kills it the same way; only never re-rendering
 * on focus survives. Keystroke re-renders after focus has settled are fine.
 * On native the caret and keyboard are the focus affordance instead.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  barStyle,
  inputStyle,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
  /** The screen's own bar shape (radius, height, margins). */
  barStyle?: StyleProp<ViewStyle>;
  /** The screen's own text style (font, size, padding). */
  inputStyle?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const trackFocus = Platform.OS === 'web';

  return (
    <View
      style={[
        barStyle,
        { backgroundColor: theme.inputBg, borderColor: focused ? theme.primary : theme.border },
        // The design language asks a focused field to glow in the primary, not
        // just change its border colour.
        focused && Glow.primary,
      ]}>
      <Ionicons name="search" size={18} color={focused ? theme.primary : theme.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={trackFocus ? () => setFocused(true) : undefined}
        onBlur={trackFocus ? () => setFocused(false) : undefined}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        // Web only: on iOS, focusing during the modal's presentation animation
        // wins the JS race and loses the native first responder — the field
        // then reads as focused while taps and typing do nothing.
        autoFocus={Platform.OS === 'web'}
        // Artist and town names are exactly what autocorrect mangles
        // ("Aldous" became "Aldo is" in testing).
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
        style={[inputStyle, { color: theme.text }]}
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={12}
          onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={18} color={theme.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}
