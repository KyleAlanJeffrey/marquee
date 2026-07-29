import type { Coords } from '@/lib/types';

/**
 * Route params arrive as strings (or arrays of them, on web, when a key repeats)
 * and are user-editable — everything that reads `?lat=&lng=&radius=` goes
 * through here so a hand-typed URL can't put the map at 0,0 or crash Mapbox
 * with an out-of-range latitude.
 */
export const DEFAULT_RADIUS = 50;

type Param = string | string[] | undefined;

export const scalar = (v: Param): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseCoords(lat: Param, lng: Param): Coords | null {
  const rawLat = scalar(lat)?.trim();
  const rawLng = scalar(lng)?.trim();
  // Number('') is 0, so a blank param would otherwise read as the Gulf of
  // Guinea instead of "no location".
  if (!rawLat || !rawLng) return null;
  const la = Number(rawLat);
  const ln = Number(rawLng);
  const inRange = la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
  return Number.isFinite(la) && Number.isFinite(ln) && inRange ? { lat: la, lng: ln } : null;
}

export function parseRadius(radius: Param): number {
  const r = Number(scalar(radius));
  return Number.isFinite(r) && r > 0 ? r : DEFAULT_RADIUS;
}
