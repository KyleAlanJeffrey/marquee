import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet, apiPost } from '@/lib/api';
import type {
  Artist,
  ArtistEvent,
  ArtistSearchResult,
  Coords,
  EventDetail,
  NearbyEvent,
  Page,
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

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: (): Promise<EventDetail> => apiGet(`/events/${eventId}`),
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
