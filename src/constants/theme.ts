/**
 * Marquee "Stage Black" design system.
 *
 * A deep, immersive dark theme lit by neon stage lights: electric purple as the
 * primary accent, neon cyan for technical/following states, sunset orange for
 * urgency. Depth comes from glassmorphism and neon glows rather than shadows.
 * Three-tier type: Sora (display/headlines), Plus Jakarta Sans (body),
 * Space Grotesk (labels/metadata — the "ticket stub" voice).
 *
 * The app is intentionally dark-only — it's a dark venue.
 */

import '@/global.css';

const stage = {
  // Surfaces (deep → elevated)
  background: '#131313',
  backgroundLowest: '#0e0e0e',
  backgroundElevated: '#201f1f', // cards (surface-container)
  backgroundHigh: '#2a2a2a', // date blocks, chips (surface-container-high)
  backgroundHighest: '#353534',
  inputBg: '#080808',
  glass: 'rgba(20,20,20,0.6)',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.16)',

  // Text
  text: '#e5e2e1', // on-surface
  textSecondary: '#d4c0d7', // on-surface-variant
  textTertiary: '#9d8ba0', // outline

  // Primary — Electric Purple
  primary: '#ecb2ff', // accent text / borders / active
  primaryVivid: '#bd00ff', // primary-container (gradient start, solid CTAs)
  onPrimary: '#520071',

  // Secondary — Neon Cyan
  cyan: '#00dbe9',
  cyanSoft: '#d3fbff',

  // Tertiary — Sunset Orange (urgency)
  orange: '#ffb59a',
  orangeVivid: '#cf4900',

  // Aliases kept for shared component ergonomics
  tint: '#ecb2ff',
  onTint: '#520071',
  following: '#00dbe9',
  onGradient: '#ffffff',
  onGradientMuted: 'rgba(255,255,255,0.82)',
  backgroundElement: '#201f1f',
  backgroundSelected: '#2a2a2a',

  // Primary button gradient (135°): purple → cyan
  gradient: ['#bd00ff', '#00dbe9'] as const,
  // Hero image → background fade
  heroFade: ['transparent', 'rgba(19,19,19,0.6)', '#131313'] as const,
} as const;

export const Colors = { light: stage, dark: stage } as const;

export type ThemeColor = Exclude<
  keyof typeof stage,
  'gradient' | 'heroFade'
>;

/** Loaded @expo-google-fonts families, keyed by role. */
export const Fonts = {
  display: 'Sora_800ExtraBold',
  headline: 'Sora_700Bold',
  headlineMd: 'Sora_600SemiBold',
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemibold: 'PlusJakartaSans_600SemiBold',
  label: 'SpaceGrotesk_500Medium',
  labelBold: 'SpaceGrotesk_700Bold',
} as const;

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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Neon glow presets (outer light spill). */
export const Glow = {
  purple: {
    shadowColor: '#ecb2ff',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cyan: {
    shadowColor: '#00dbe9',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
} as const;

export const Spring = {
  snappy: { damping: 18, stiffness: 260, mass: 0.7 },
  gentle: { damping: 20, stiffness: 140, mass: 0.9 },
} as const;
