import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type MapPoint = { lat: number; lng: number; following?: boolean };

// Only a Mapbox *public* token (pk.*) may ship in the client bundle. A secret
// (sk.*) token would leak full account access, so we ignore it and fall back to
// the stylized grid.
const RAW_MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
export const MAPBOX_TOKEN = RAW_MAPBOX_TOKEN?.startsWith('pk.') ? RAW_MAPBOX_TOKEN : undefined;
if (RAW_MAPBOX_TOKEN && !MAPBOX_TOKEN) {
  console.warn('EXPO_PUBLIC_MAPBOX_TOKEN must be a public "pk." token; ignoring it (using the fallback map).');
}

const pin = (p: MapPoint) => `pin-s+${p.following ? 'bd00ff' : '00dbe9'}(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`;

/** Mapbox Static Images API URL for these points, or null when unavailable.
 *  A single point is centered at `zoom`; multiple points auto-fit the frame. */
export function staticMapUrl(points: MapPoint[], zoom = 13): string | null {
  if (!MAPBOX_TOKEN || points.length === 0) return null;
  const markers = points.slice(0, 15).map(pin).join(',');
  const position =
    points.length === 1
      ? `${points[0].lng.toFixed(5)},${points[0].lat.toFixed(5)},${zoom}`
      : 'auto';
  const padding = position === 'auto' ? '&padding=30,30,60,30' : '';
  return (
    `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${markers}/${position}/700x400@2x` +
    `?access_token=${MAPBOX_TOKEN}${padding}&attribution=false&logo=false`
  );
}

/**
 * A dark map filling its parent: a real Mapbox static image when a public token
 * is configured, else a stylized neon-grid fallback. Wrap it in a sized,
 * `overflow: hidden` container and layer any overlays on top.
 */
export function StaticMap({ points, zoom }: { points: MapPoint[]; zoom?: number }) {
  const url = staticMapUrl(points, zoom);
  if (url) {
    return <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />;
  }
  return <MapGrid points={points} />;
}

/** Stylized neon grid — dependency-free fallback when no Mapbox token is set. */
function MapGrid({ points }: { points: MapPoint[] }) {
  const theme = useTheme();
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;

  function pos(p: MapPoint) {
    if (points.length <= 1) return { left: '50%' as const, top: '45%' as const };
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
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={`h${i}`} style={[styles.grid, { top: `${((i + 1) / 5) * 100}%`, left: 0, right: 0, height: 1 }]} />
      ))}
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={`v${i}`} style={[styles.grid, { left: `${((i + 1) / 5) * 100}%`, top: 0, bottom: 0, width: 1 }]} />
      ))}
      {points.slice(0, 12).map((p, i) => {
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
  grid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
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
});
