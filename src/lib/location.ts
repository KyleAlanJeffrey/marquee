import * as Location from 'expo-location';

import type { Coords } from '@/lib/types';

export async function getCurrentCoords(): Promise<Coords | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
