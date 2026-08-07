import * as Location from 'expo-location';

import type { Coords } from '@/lib/types';

/**
 * How stale a cached fix may be and still be worth showing a feed for.
 *
 * Five minutes of drift is at most a few miles, which changes nothing about a
 * 25-or-50-mile radius of concerts. Anything older is a different trip.
 */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;

export async function getCurrentCoords(): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/**
 * A fix good enough to draw a feed with, as fast as one can be had.
 *
 * `getCurrentPositionAsync` talks to the GPS/wifi stack and routinely takes
 * seconds — on web it's `navigator.geolocation`, which on a first visit also
 * waits for the user to answer a permission prompt. Explore blocked its whole
 * render on that, spinner and all, before it could even ask the server for
 * shows.
 *
 * So: hand back the last fix the OS already has, if it's recent enough, and let
 * the caller start rendering. `onPrecise` then fires with the real one when it
 * arrives, which matters when the cached fix is a few miles off and the feed
 * should re-centre.
 *
 * Returns null only when there is genuinely nothing — permission refused, or no
 * cached fix and the live lookup failed. Callers treat that as "ask for
 * location", so it must not be returned merely because the precise fix is slow.
 */
export async function getCoordsFast(onPrecise?: (c: Coords) => void): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  // Settled rather than left raw, and *immediately*: the cached lookup below is
  // awaited, so a precise fix that fails during that await would otherwise be an
  // unhandled rejection with nothing attached yet. The outcome is kept so the
  // no-cache path can still rethrow it.
  const precise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then((pos) => ({ ok: true as const, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))
    .catch((err: unknown) => ({ ok: false as const, err }));

  let cached: Coords | null = null;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) cached = { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch (err) {
    // Never fatal: this is the shortcut, and the precise lookup is the answer
    // either way.
    console.warn('last known position unavailable:', err);
  }

  if (!cached) {
    const settled = await precise;
    if (!settled.ok) throw settled.err;
    return settled.coords;
  }

  // Deferred past this function's own return, and via a task rather than a
  // microtask so the ordering doesn't depend on counting `await` hops.
  //
  // If the precise fix has already resolved, a bare `.then` here can run before
  // the caller's `await getCoordsFast(...)` continuation — `onPrecise` would set
  // the good coordinates and the caller would then overwrite them with the
  // cached ones it is still holding, pinning the feed to the stale position for
  // the rest of the session. A timeout cannot run until the microtask queue,
  // caller's continuation included, has drained.
  setTimeout(async () => {
    const settled = await precise;
    if (settled.ok) onPrecise?.(settled.coords);
    else console.warn('precise location lookup failed:', settled.err);
  }, 0);
  return cached;
}

export async function reverseGeocodeLabel(coords: Coords): Promise<string | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    if (!place) return null;
    return [place.city, place.region].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}
