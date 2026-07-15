import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type MapPin = { lat: number; lng: number; following: boolean };

type Props = {
  pins: MapPin[];
  locationLabel: string | null;
  withinMiles: number | null;
  onExplore?: () => void;
};

const GRID = 5;

// Only a Mapbox *public* token (pk.*) may ship in the client bundle. A secret
// (sk.*) token would leak full account access to anyone viewing the page, so we
// ignore it and fall back to the stylized grid.
const RAW_MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_TOKEN = RAW_MAPBOX_TOKEN?.startsWith('pk.') ? RAW_MAPBOX_TOKEN : undefined;
if (RAW_MAPBOX_TOKEN && !MAPBOX_TOKEN) {
  console.warn('EXPO_PUBLIC_MAPBOX_TOKEN must be a public "pk." token; ignoring it (using the fallback map).');
}

/** Real dark map (Mapbox Static Images API) with venue pins baked in — a plain
 *  image, so it works identically on web and native. `auto` frames all pins;
 *  extra bottom padding keeps them clear of the info overlay. */
function staticMapUrl(pins: MapPin[]): string | null {
  if (!MAPBOX_TOKEN || pins.length === 0) return null;
  const markers = pins
    .slice(0, 15)
    .map((p) => `pin-s+${p.following ? 'bd00ff' : '00dbe9'}(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`)
    .join(',');
  return (
    `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${markers}/auto/700x224@2x` +
    `?access_token=${MAPBOX_TOKEN}&padding=30,30,80,30&attribution=false&logo=false`
  );
}

/**
 * "Nearby Venues" map. Renders a real Mapbox map when a token is configured,
 * else a dependency-free stylized grid of the same pins. Both share the same
 * card chrome and bottom info overlay.
 */
export function VenueMap({ pins, locationLabel, withinMiles, onExplore }: Props) {
  const theme = useTheme();
  const mapUrl = staticMapUrl(pins);

  return (
    <View style={[styles.card, { borderColor: theme.border }, Glow.cyan, { shadowOpacity: 0.15 }]}>
      {mapUrl ? (
        <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
      ) : (
        <StylizedGrid pins={pins} />
      )}

      {/* Bottom overlay: location + distance + explore */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.overlay}>
        <View style={styles.overlayRow}>
          <View style={[styles.nearIcon, { backgroundColor: 'rgba(0,219,233,0.15)', borderColor: 'rgba(0,219,233,0.3)' }]}>
            <Ionicons name="navigate" size={18} color={theme.cyan} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={{ color: '#fff' }} numberOfLines={1}>
              {locationLabel ?? 'Your area'}
            </ThemedText>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
              {withinMiles != null
                ? `You're within ${withinMiles} ${withinMiles === 1 ? 'mile' : 'miles'}`
                : 'Live shows near you'}
            </ThemedText>
          </View>
          <PressableScale
            haptic={false}
            onPress={onExplore}
            style={[styles.exploreBtn, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: theme.border }]}>
            <ThemedText type="label" style={{ color: '#fff', fontSize: 12 }}>
              Explore Area
            </ThemedText>
          </PressableScale>
        </View>
      </LinearGradient>
    </View>
  );
}

/** Venue coordinates normalized onto a dark neon grid — the no-token fallback. */
function StylizedGrid({ pins }: { pins: MapPin[] }) {
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
    const x = 0.12 + (0.76 * (p.lng - minLng)) / spanLng;
    const y = 0.12 + 0.76 * (1 - (p.lat - minLat) / spanLat);
    return { left: `${x * 100}%` as const, top: `${y * 100}%` as const };
  }

  return (
    <>
      <LinearGradient
        colors={['#161422', '#0e0e0e']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
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
      {pins.slice(0, 12).map((p, i) => {
        const c = p.following ? theme.primary : theme.cyan;
        return (
          <View key={i} style={[styles.pin, pos(p)]}>
            <View style={[styles.pinDot, { backgroundColor: c, shadowColor: c }]} />
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 224,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.lg,
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
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  overlayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  nearIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
