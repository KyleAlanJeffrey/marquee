import { Colors } from '@/constants/theme';

/**
 * Marquee is dark-only ("Stage Black"), so the theme is constant. Kept as a
 * hook so call sites don't change if theming returns later.
 */
export function useTheme() {
  return Colors.dark;
}
