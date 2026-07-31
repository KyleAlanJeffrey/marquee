/**
 * The Electric Stage colours, and nothing else.
 *
 * A separate module because it has two consumers on two runtimes: `theme.ts`
 * builds the app's design system from it, and `worker/src/page.ts` builds the
 * server-rendered pages' `:root` from it. The worker can't import `theme.ts` —
 * that file pulls in `global.css`, which only a Metro bundle knows what to do
 * with — so the rule "keep one palette" is enforced the only way that works
 * across the boundary: the colours live here, imported by both, and neither side
 * carries a literal the other can drift from. This module must import nothing.
 *
 * The design reasoning for these values lives in `theme.ts`, next to the roles.
 */

export const stage = {
  // Surfaces (deep → elevated). Charcoal, never #000.
  background: '#131315',
  backgroundLowest: '#0e0e10',
  backgroundElevated: '#201f21', // cards (surface-container)
  backgroundHigh: '#2a2a2c', // date blocks, chips (surface-container-high)
  // Inputs sit *below* the base layer so a focused green border reads as a glow.
  inputBg: '#0a0a0b',
  glass: 'rgba(19,19,21,0.6)',
  border: 'rgba(255,255,255,0.10)',
  // A card's top edge only. Brighter than the rest of its border, which is what
  // stands in for a light source above it now that cards carry no drop shadow.
  borderTop: 'rgba(255,255,255,0.20)',

  // Text
  text: '#e5e1e4', // on-surface
  // Near-neutral, with only enough green in them to belong to the accent. They
  // used to be a khaki (#c4c9ac) and an olive (#8e9379), pulled from the old
  // yellow-green — which put a sickly cast on every line of secondary copy in
  // the app, far more surface than the accent itself ever touched.
  textSecondary: '#c3cbc6', // on-surface-variant
  textTertiary: '#879089', // outline

  // Primary — high-visibility neon green. The dominant focal point; nothing else
  // competes with it, which is why it is spent only on actions and active states.
  primary: '#2fff6a', // accent text / borders / active
  primaryVivid: '#2ae05d', // the slightly recessed green
  onPrimary: '#00230f', // near-black green, for text sitting on the accent
  // The two accent alphas the spec calls out by name: a 12% fill behind a chip,
  // and the 30% edge that lifts a floating element without a drop shadow.
  primaryFill: 'rgba(47,255,106,0.12)',
  primaryEdge: 'rgba(47,255,106,0.30)',

  // Tertiary — electric cyan. Supporting accent, so the green never saturates the
  // whole screen. It stays ~50° off the primary on the wheel: cyan carries a
  // meaning here (following, saved), so the two must never be mistaken.
  cyan: '#7df4ff',
  cyanSoft: '#00dbe9',
  onCyan: '#00363a', // deep teal, for text and icons sitting on cyan
  cyanFill: 'rgba(0,219,233,0.12)',
  cyanEdge: 'rgba(0,219,233,0.30)',

  // Urgency / error. Named for the role, not the hue — the old names said
  // "orange" and these are a salmon and a deep red.
  error: '#ffb4ab',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  /**
   * Text and icons sitting on photography or a scrim over it.
   *
   * Pure white on purpose, and the one place the palette's `text` is wrong: over
   * an image, the warm cast of #e5e1e4 reads as dirty, and there is no
   * controlled background behind it to keep contrast honest.
   */
  onImage: '#ffffff',

  /** Following is expressed in cyan throughout, never in the primary green. */
  following: '#7df4ff',

  // Primary button fill. Deliberately a near-solid ramp in one hue rather than a
  // two-hue gradient: the spec calls for solid CTAs, and this keeps the one
  // gradient component honest without it reading as a colour transition.
  gradient: ['#2fff6a', '#2ae05d'] as const,
  // Hero image → background fade
  heroFade: ['transparent', 'rgba(19,19,21,0.6)', '#131315'] as const,
} as const;
