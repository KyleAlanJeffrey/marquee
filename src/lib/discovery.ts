import type { FollowedArtist } from '@/lib/follows-store';
import { supabase } from '@/lib/supabase';
import type { Coords } from '@/lib/types';

/**
 * Ask the backend to pull fresh nearby shows for this location. The server
 * rate-limits per area, so calling this on every feed load is cheap. Returns
 * how many new events were ingested (0 on error / no key / throttled).
 */
export async function discoverEvents(coords: Coords, radiusMiles: number): Promise<number> {
  try {
    const { data, error } = await supabase.functions.invoke('discover-events', {
      body: { lat: coords.lat, lng: coords.lng, radius: radiusMiles },
    });
    if (error) return 0;
    return data?.ingested ?? 0;
  } catch {
    return 0;
  }
}

/** Pull upcoming shows for the on-device follow list. Returns new-event count. */
export async function refreshArtistEvents(artists: FollowedArtist[]): Promise<number> {
  if (artists.length === 0) return 0;
  try {
    const { data, error } = await supabase.functions.invoke('refresh-artist-events', {
      body: {
        artists: artists.map((a) => ({
          artistId: a.artistId,
          spotifyId: a.spotifyId,
          name: a.name,
          imageUrl: a.imageUrl,
          genres: a.genres,
        })),
      },
    });
    if (error) return 0;
    return data?.ingested ?? 0;
  } catch {
    return 0;
  }
}
