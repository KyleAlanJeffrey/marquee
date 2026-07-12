import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type MapPin = { lat: number; lng: number; following: boolean };

type Props = {
  pins: MapPin[];
  city: string | null;
  count: number;
  onExpand?: () => void;
};

const GRID = 5;

/**
 * A stylized, data-driven "map" — venue coordinates normalized onto a dark grid
 * with neon pins. Deliberately dependency-free (no native maps module) so it
 * renders identically on web and device.
 */
export function VenueMap({ pins, city, count, onExpand }: Props) {
  const theme = useTheme();

  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;

  function pos(p: MapPin) {
    // pad 12% so pins don't hug the edges; invert lat (north = up)
    const x = 0.12 + (0.76 * (p.lng - minLng)) / spanLng;
    const y = 0.12 + 0.76 * (1 - (p.lat - minLat) / spanLat);
    return { left: `${x * 100}%` as const, top: `${y * 100}%` as const };
  }

  return (
    <PressableScale onPress={onExpand} scaleTo={0.99} style={[styles.card, { borderColor: theme.border }, Glow.cyan, { shadowOpacity: 0.2 }]}>
      <LinearGradient
        colors={['#161422', '#0e0e0e']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* grid */}
      {Array.from({ length: GRID - 1 }).map((_, i) => (
        <View
          key={`h${i}`}
          style={[styles.gridLine, { top: `${((i + 1) / GRID) * 100}%`, height: 1, left: 0, right: 0 }]}
        />
      ))}
      {Array.from({ length: GRID - 1 }).map((_, i) => (
        <View
          key={`v${i}`}
          style={[styles.gridLine, { left: `${((i + 1) / GRID) * 100}%`, width: 1, top: 0, bottom: 0 }]}
        />
      ))}
      {/* pins */}
      {pins.slice(0, 12).map((p, i) => {
        const c = p.following ? theme.primary : theme.cyan;
        return (
          <View key={i} style={[styles.pin, pos(p)]}>
            <View style={[styles.pinDot, { backgroundColor: c, shadowColor: c }]} />
          </View>
        );
      })}
      <View style={styles.labelWrap}>
        <View style={[styles.label, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <Ionicons name="location" size={16} color={theme.cyan} />
          <ThemedText type="label" style={{ color: theme.text, fontSize: 12 }}>
            {count} live {count === 1 ? 'venue' : 'venues'}
            {city ? ` in ${city}` : ' nearby'}
          </ThemedText>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 176,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
  pin: { position: 'absolute', width: 12, height: 12, marginLeft: -6, marginTop: -6 },
  pinDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  labelWrap: { position: 'absolute', left: Spacing.three, bottom: Spacing.three },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
});
