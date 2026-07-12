import { useQuery } from '@tanstack/react-query';

import { apiGet, apiPost } from '@/lib/api';
import type { Artist, ArtistEvent, ArtistSearchResult, Coords, EventDetail, NearbyEvent } from '@/lib/types';

/** Upcoming shows near a point, soonest first. Powers the home feed. */
export function useNearbyEvents(coords: Coords | null, radiusMiles: number) {
  return useQuery({
    queryKey: ['nearby-events', coords, radiusMiles],
    enabled: coords != null,
    queryFn: (): Promise<NearbyEvent[]> =>
      apiGet(`/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=${radiusMiles}`),
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
