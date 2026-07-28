import { KyleBadge as Badge } from '@kylealanjeffrey/badge';
import { useWindowDimensions } from 'react-native';

/** The badge is `position: fixed`, and on a phone-width layout every corner is
 *  already taken (top bar, genre chips, Map View button, tab bar), so it only
 *  shows once there's empty gutter to sit in. */
const MIN_WIDTH = 900;

/** "built by Kyle" badge — links to kylejeffrey.com. */
export function KyleBadge() {
  const { width } = useWindowDimensions();
  if (width < MIN_WIDTH) return null;
  return <Badge position="top-right" />;
}
