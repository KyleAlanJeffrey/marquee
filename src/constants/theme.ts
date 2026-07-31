/**
 * Marquee "Electric Stage" design system.
 *
 * A deep charcoal foundation punctuated by a high-visibility neon green. Charcoal
 * rather than pure black on purpose: it lets tonal layering read as depth. Depth
 * comes from translucent overlays and luminous 1px borders, not drop shadows —
 * a glassmorphic stack over a neutral base.
 *
 * The accent is a laser green at hue 137°, not the acid lime this started as. The
 * lime sat at hue 72°, where red and green are nearly equal — which is to say it
 * was a yellow, and it read as one: fine at full strength on a CTA, olive at 12%
 * behind a chip, and sickly once the neutrals were derived from it. Rotating it
 * into true green is only half the fix; the greys had to stop being khaki too.
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

import { stage } from './palette';


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
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Soft shape language — subtle rounding, to balance aggressive type and a
 * vibrant accent. Anything blobbier fights the typography.
 *
 * There are deliberately only these four. The design names exactly two UI radii,
 * 4px for buttons and inputs and 12px for containers, so an 8px middle step had
 * nothing to be faithful to — everything that used it was a card. `pill` is for
 * chips and selection controls; `xs` is for hairline internal detail.
 */
export const Radius = {
  xs: 2,
  sm: 4,
  lg: 12,
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
    shadowColor: '#2fff6a',
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
  /**
   * The one plain drop shadow, for a full-bleed image tile.
   *
   * Not for glass cards — those carry no shadow at all and get their light from a
   * brighter top border instead. A photo tile has no border to light, so it needs
   * something to separate it from the charcoal behind it.
   */
  lift: {
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
