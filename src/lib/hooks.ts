import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet, apiPost } from '@/lib/api';
import type {
  Artist,
  ArtistEvent,
  ArtistInfo,
  ArtistSearchResult,
  Coords,
  EventBuzz,
  EventDetail,
  EventLineup,
  NearbyEvent,
  NearbyVenue,
  Page,
  Town,
  VenueDetail,
  VenueEvent,
} from '@/lib/types';

/** Upcoming shows near a point (curated set for the Explore dashboard). */
export function useNearbyEvents(coords: Coords | null, radiusMiles: number) {
  return useQuery({
    queryKey: ['nearby-events', coords, radiusMiles],
    enabled: coords != null,
    queryFn: async (): Promise<NearbyEvent[]> => {
      const page = await apiGet<Page<NearbyEvent>>(
        `/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=${radiusMiles}&limit=400&offset=0`,
      );
      return page.items;
    },
  });
}

/** Paginated nearby shows for infinite scroll (Browse). */
export function useInfiniteNearby(coords: Coords | null, radiusMiles: number, pageSize = 12) {
  return useInfiniteQuery({
    queryKey: ['nearby-infinite', coords, radiusMiles],
    enabled: coords != null,
    initialPageParam: 0,
    queryFn: ({ pageParam }): Promise<Page<NearbyEvent>> =>
      apiGet(
        `/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=${radiusMiles}&limit=${pageSize}&offset=${pageParam}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useArtist(artistId: string) {
  return useQuery({
    queryKey: ['artist', artistId],
    queryFn: (): Promise<Artist> => apiGet(`/artists/${artistId}`),
  });
}

export function useArtistEvents(artistId: string) {
  return useQuery({
    queryKey: ['artist-events', artistId],
    queryFn: (): Promise<ArtistEvent[]> => apiGet(`/artists/${artistId}/events`),
  });
}

/** Aggregated artist info: bio, top tracks, fan count, Spotify link. */
export function useArtistInfo(artistId: string) {
  return useQuery({
    queryKey: ['artist-info', artistId],
    staleTime: 60 * 60 * 1000,
    queryFn: (): Promise<ArtistInfo> => apiGet(`/artists/${artistId}/info`),
  });
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: (): Promise<EventDetail> => apiGet(`/events/${eventId}`),
  });
}

/** Real discussion posts about a show (Bluesky). */
export function useEventBuzz(eventId: string) {
  return useQuery({
    queryKey: ['event-buzz', eventId],
    staleTime: 5 * 60 * 1000,
    queryFn: (): Promise<EventBuzz> => apiGet(`/events/${eventId}/buzz`),
  });
}

/** Supporting acts for a show (Ticketmaster attractions). */
export function useEventLineup(eventId: string) {
  return useQuery({
    queryKey: ['event-lineup', eventId],
    staleTime: 60 * 60 * 1000,
    queryFn: (): Promise<EventLineup> => apiGet(`/events/${eventId}/lineup`),
  });
}

/** Venues with upcoming shows near a point, busiest first. */
export function useNearbyVenues(coords: Coords | null, radiusMiles: number, limit = 12) {
  return useQuery({
    queryKey: ['nearby-venues', coords, radiusMiles, limit],
    enabled: coords != null,
    queryFn: async (): Promise<NearbyVenue[]> => {
      const data = await apiGet<{ items: NearbyVenue[] }>(
        `/venues/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=${radiusMiles}&limit=${limit}`,
      );
      return data.items ?? [];
    },
  });
}

/**
 * Current rows for the saved list held on the device.
 *
 * The Saved screen renders its stored snapshots first and prefers these once they
 * arrive: doors move and shows get pulled, and a saved show is where a stale time
 * actually costs somebody their evening. The response holds only shows still to
 * come, soonest first — an id missing from it has either passed or been pulled, and
 * the server's clock is the one that decides which side of that line a show is on.
 */
export function useSavedShowDetails(eventIds: string[]) {
  // Sorted so the key doesn't change when the same set arrives in a new order.
  const ids = [...new Set(eventIds)].sort();
  return useQuery({
    queryKey: ['saved-show-details', ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<NearbyEvent[]> => {
      const data = await apiPost<{ items: NearbyEvent[] }>('/events/by-ids', { ids });
      return data.items ?? [];
    },
  });
}

export function useVenue(venueId: string) {
  return useQuery({
    queryKey: ['venue', venueId],
    queryFn: (): Promise<VenueDetail> => apiGet(`/venues/${venueId}`),
  });
}

/** Paginated upcoming shows at a venue for infinite scroll. */
export function useInfiniteVenueEvents(venueId: string, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['venue-events', venueId],
    initialPageParam: 0,
    queryFn: ({ pageParam }): Promise<Page<VenueEvent>> =>
      apiGet(`/venues/${venueId}/events?limit=${pageSize}&offset=${pageParam}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Towns we have shows in. This is answered from our own database rather than
 * Spotify, so an empty query is valid and returns the busiest towns — which is
 * what makes the search screen useful before anyone types.
 */
export function useTownSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['town-search', q],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Town[]> => {
      const data = await apiGet<{ towns?: Town[] }>(`/towns?q=${encodeURIComponent(q)}&limit=8`);
      return data.towns ?? [];
    },
  });
}

export function useArtistSearch(query: string) {
  return useQuery({
    queryKey: ['artist-search', query],
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ArtistSearchResult[]> => {
      const data = await apiPost<{ artists?: ArtistSearchResult[] }>('/search-artists', {
        query: query.trim(),
      });
      return data.artists ?? [];
    },
  });
}
