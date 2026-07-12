import { apiPost } from '@/lib/api';
import type { FollowedArtist } from '@/lib/follows-store';
import type { Coords } from '@/lib/types';

/**
 * Ask the Worker to pull fresh nearby shows for this location. The server
 * rate-limits per area, so calling this on every feed load is cheap. Returns
 * how many new events were ingested (0 on error / no key / throttled).
 */
export async function discoverEvents(coords: Coords, radiusMiles: number): Promise<number> {
  try {
    const data = await apiPost<{ ingested?: number }>('/discover-events', {
      lat: coords.lat,
      lng: coords.lng,
      radius: radiusMiles,
    });
    return data.ingested ?? 0;
  } catch {
    return 0;
  }
}

/** Pull upcoming shows for the on-device follow list. Returns new-event count. */
export async function refreshArtistEvents(artists: FollowedArtist[]): Promise<number> {
  if (artists.length === 0) return 0;
  try {
    const data = await apiPost<{ ingested?: number }>('/refresh-artist-events', {
      artists: artists.map((a) => ({
        artistId: a.artistId,
        spotifyId: a.spotifyId,
        name: a.name,
        imageUrl: a.imageUrl,
        genres: a.genres,
      })),
    });
    return data.ingested ?? 0;
  } catch {
    return 0;
  }
}
