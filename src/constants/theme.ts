/**
 * Marquee "Electric Stage" design system.
 *
 * A deep charcoal foundation punctuated by high-visibility acid lime. Charcoal
 * rather than pure black on purpose: it lets tonal layering read as depth. Depth
 * comes from translucent overlays and luminous 1px borders, not drop shadows —
 * a glassmorphic stack over a neutral base.
 *
 * One typeface, Anybody, doing all the work through its weight axis. ExtraBold
 * italic in caps is the signature and is reserved for hero names, where the
 * energy belongs; headlines below it are Bold upright so the page stays readable.
 * Body text never drops under 400, and `small` holds 500 — light text on a dark
 * ground haloes, and the extra weight is what stops it.
 *
 * The app is intentionally dark-only — it's a dark venue.
 */

import '@/global.css';

const stage = {
  // Surfaces (deep → elevated). Charcoal, never #000.
  background: '#131315',
  backgroundLowest: '#0e0e10',
  backgroundElevated: '#201f21', // cards (surface-container)
  backgroundHigh: '#2a2a2c', // date blocks, chips (surface-container-high)
  backgroundHighest: '#353437',
  // Inputs sit *below* the base layer so a focused lime border reads as a glow.
  inputBg: '#0a0a0b',
  glass: 'rgba(19,19,21,0.6)',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.15)',

  // Text
  text: '#e5e1e4', // on-surface
  textSecondary: '#c4c9ac', // on-surface-variant — warm olive, not a cold grey
  textTertiary: '#8e9379', // outline

  // Primary — high-visibility acid lime. The dominant focal point; nothing else
  // competes with it, which is why it is spent only on actions and active states.
  primary: '#c3f400', // accent text / borders / active
  primaryVivid: '#abd600', // primary-fixed-dim — the slightly recessed lime
  onPrimary: '#161e00', // near-black, for text sitting on lime

  // Tertiary — electric cyan. Supporting accent, so the lime never saturates
  // the whole screen.
  cyan: '#7df4ff',
  cyanSoft: '#00dbe9',
  onCyan: '#00363a', // deep teal, for text and icons sitting on cyan

  // Urgency / error
  orange: '#ffb4ab',
  orangeVivid: '#93000a',

  // Aliases kept for shared component ergonomics
  tint: '#c3f400',
  onTint: '#161e00',
  following: '#7df4ff',
  onGradient: '#161e00',
  onGradientMuted: 'rgba(22,30,0,0.72)',
  backgroundElement: '#201f21',
  backgroundSelected: '#2a2a2c',

  // Primary button fill. Deliberately a near-solid lime ramp rather than a
  // two-hue gradient: the spec calls for solid lime CTAs, and this keeps the one
  // gradient component honest without it reading as a colour transition.
  gradient: ['#c3f400', '#abd600'] as const,
  // Hero image → background fade
  heroFade: ['transparent', 'rgba(19,19,21,0.6)', '#131315'] as const,
} as const;

export const Colors = { light: stage, dark: stage } as const;

export type ThemeColor = Exclude<
  keyof typeof stage,
  'gradient' | 'heroFade'
>;

/**
 * Loaded @expo-google-fonts families, keyed by role.
 *
 * The italic entries are real italic files, not an upright face with a synthetic
 * slant — so nothing here should also set `fontStyle: 'italic'`, which would
 * double-slant on Android.
 */
export const Fonts = {
  display: 'Anybody_800ExtraBold_Italic',
  headline: 'Anybody_700Bold',
  headlineMd: 'Anybody_600SemiBold',
  body: 'Anybody_400Regular',
  bodyMedium: 'Anybody_500Medium',
  bodySemibold: 'Anybody_600SemiBold',
  label: 'Anybody_700Bold',
  labelBold: 'Anybody_800ExtraBold',
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

/**
 * Soft shape language — subtle rounding, to balance aggressive type and a
 * vibrant accent. Buttons and inputs are 4px; containers 12px. Anything blobbier
 * fights the typography.
 */
export const Radius = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 12,
  pill: 999,
} as const;

/**
 * Luminous edges (outer light spill).
 *
 * Kept small on purpose: depth here is a 1px lit border, not a large soft
 * shadow, so these read as a filament rather than a drop shadow.
 */
export const Glow = {
  primary: {
    shadowColor: '#c3f400',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cyan: {
    shadowColor: '#7df4ff',
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
