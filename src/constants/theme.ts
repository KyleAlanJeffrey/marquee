/**
 * Marquee's design tokens. The accent is a warm amber/gold — a nod to theater
 * marquee lights — set against near-neutral surfaces so cover art and the
 * accent do the talking. A single "spotlight" gradient (amber → coral → pink)
 * anchors the app's hero header.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0A0A0B',
    textSecondary: '#5B616E',
    textTertiary: '#9AA0AC',
    background: '#FFFFFF',
    backgroundElement: '#F4F4F6',
    backgroundSelected: '#E9E9ED',
    border: '#E6E6EA',
    tint: '#D9660A',
    onTint: '#FFFFFF',
    following: '#D9660A',
    // Spotlight gradient for the hero header.
    gradient: ['#F59E0B', '#EA580C', '#DB2777'] as const,
    onGradient: '#FFFFFF',
    onGradientMuted: 'rgba(255,255,255,0.82)',
  },
  dark: {
    text: '#FAFAFA',
    textSecondary: '#A2A2AC',
    textTertiary: '#71717A',
    background: '#0B0B0D',
    backgroundElement: '#161619',
    backgroundSelected: '#232327',
    border: '#26262B',
    tint: '#FBBF24',
    onTint: '#1A1200',
    following: '#FBBF24',
    gradient: ['#B45309', '#9D174D', '#6D28D9'] as const,
    onGradient: '#FFFFFF',
    onGradientMuted: 'rgba(255,255,255,0.82)',
  },
} as const;

export type ThemeColor = Exclude<
  keyof typeof Colors.light & keyof typeof Colors.dark,
  'gradient'
>;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Soft elevation shared by cards. */
export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;

/** Spring configs used across press feedback + layout transitions. */
export const Spring = {
  snappy: { damping: 18, stiffness: 260, mass: 0.7 },
  gentle: { damping: 20, stiffness: 140, mass: 0.9 },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
