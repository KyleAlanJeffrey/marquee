import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextType =
  | 'display' // Sora 800 — hero artist names
  | 'headline' // Sora 700 — big titles
  | 'title' // Sora 600 — section titles
  | 'body' // Jakarta 400
  | 'bodyLg'
  | 'bodyMedium'
  | 'small'
  | 'smallBold'
  | 'label' // Space Grotesk — metadata / labels
  | 'labelSm';

export type ThemedTextProps = TextProps & {
  type?: TextType;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />
  );
}

const styles = StyleSheet.create({
  display: {
    fontFamily: Fonts.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
  },
  headline: {
    fontFamily: Fonts.headline,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: Fonts.headlineMd,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: Fonts.body,
    fontSize: 18,
    lineHeight: 28,
  },
  bodyMedium: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
  },
  labelSm: {
    fontFamily: Fonts.label,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
  },
});
