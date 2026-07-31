import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextType =
  | 'display' // Anybody 800 italic, caps — hero artist and event names only
  | 'headline' // Anybody 700 upright — big titles
  | 'title' // Anybody 600 — section titles
  | 'body' // Anybody 400
  | 'bodyLg'
  | 'bodyMedium'
  | 'small'
  | 'smallBold'
  | 'label' // Anybody 700, caps, wide tracking — metadata / labels
  | 'labelSm'; // the same voice one step down. Pass textTransform: 'none' for a name.

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
  // The signature treatment, and the reason it is only on `display`: caps italic
  // ExtraBold carries the energy on a hero name and shouts on anything smaller.
  // `fontStyle` is deliberately not set — Fonts.display is already an italic file.
  display: {
    fontFamily: Fonts.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.6,
    textTransform: 'uppercase',
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
  // body-sm holds 500, not 400: light text this size haloes against charcoal, and
  // the extra weight is what stops it.
  small: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    lineHeight: 20,
  },
  // label-md: 12/16 at weight 700 with 0.05em tracking, in caps — the "ticket
  // stub" voice used for dates, counts and status.
  label: {
    fontFamily: Fonts.label,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Caps is right for the counts, dates and genres this carries, but it shouts a
  // proper noun. The few sites holding a name override textTransform back to 'none'.
  labelSm: {
    fontFamily: Fonts.label,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
});
