/**
 * React Query hooks over the public catalogue — artists, events, venues, towns
 * and search. Lived in `src/lib/hooks.ts` until the folder audit: a file of
 * nothing but hooks belongs in `src/hooks`, next to `use-theme`.
 *
 * The rule that keeps the rest of `src/lib` where it is: a hook that is a
 * domain module's public face (reviews, curated lists, the account stores)
 * stays co-located with that module's types and requests — splitting those
 * apart would trade cohesion for a tidier-looking tree. This file had no such
 * module; it was only ever the hooks.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiPost } from '@/lib/api';
import type {
  Artist,
  ArtistEvent,
  ArtistInfo,
  ArtistPastEvent,
  ArtistSearchResult,
  Coords,
  EventBuzz,
  EventDetail,
  EventLineup,
  FollowingEvent,
  NearbyEvent,
  NearbyVenue,
  Page,
  Town,
  VenueDetail,
  VenueInfo,
  VenueEvent,
} from '@/lib/types';

/** Mirrors the Worker's own caps — see EVENTS_BY_IDS_MAX and FOLLOWING_IDS_MAX in
 *  worker/src/data.ts. Sending more is a 400, not a truncation. */
export const EVENTS_BY_IDS_MAX = 200;
const FOLLOWING_IDS_MAX = 100;

/** Upcoming shows near a point (curated set for the Explore dashboard). */
export function useNearbyEvents(coords: Coords | null, radiusMiles: number) {
  return useQuery({
    queryKey: ['nearby-events', coords, radiusMiles],
    enabled: coords != null,
    queryFn: async (): Promise<NearbyEvent[]> => {
      // POST body + anonymous: coordinates stay out of request logs and never
      // travel with the session token. See RequestOpts in api.ts.
      const page = await apiPost<Page<NearbyEvent>>(
        '/nearby',
        { lat: coords!.lat, lng: coords!.lng, radius: radiusMiles, limit: 400, offset: 0 },
        { anonymous: true },
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
      apiPost(
        '/nearby',
        { lat: coords!.lat, lng: coords!.lng, radius: radiusMiles, limit: pageSize, offset: pageParam },
        { anonymous: true },
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

/**
 * Shows of theirs that have already happened — the "I saw them before" list.
 *
 * `enabled` so opening an artist page costs nothing: the catalogue's history is only
 * read once somebody says they want to look for a past gig. Long `staleTime` because
 * history does not change.
 */
export function useArtistPastEvents(artistId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['artist-past-events', artistId],
    enabled: enabled && !!artistId,
    staleTime: 60 * 60 * 1000,
    queryFn: (): Promise<ArtistPastEvent[]> => apiGet(`/artists/${artistId}/past-events`),
  });
}

/**
 * Ask the Worker to fetch this artist's history from upstream.
 *
 * Safe to call more than once — the server keeps a stamp and returns without going
 * out a second time — but still only fired on the user's say-so, because the first
 * call is a real request to a third party.
 */
export function useFetchArtistHistory(artistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<{ ingested: number; found: boolean; past_on_file: number }> =>
      apiPost(`/artists/${artistId}/history`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artist-past-events', artistId] });
    },
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
      const data = await apiPost<{ items: NearbyVenue[] }>(
        '/venues/nearby',
        { lat: coords!.lat, lng: coords!.lng, radius: radiusMiles, limit },
        { anonymous: true },
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
  // Capped in the caller's order because the Worker rejects a longer list
  // outright — and the caller sends soonest-first, so the cap keeps the shows
  // about to happen rather than whichever ids sort lexicographically earliest.
  // Only the query key gets sorted, so the same set arriving in a new order
  // doesn't refetch.
  const ids = [...new Set(eventIds)].slice(0, EVENTS_BY_IDS_MAX);
  return useQuery({
    queryKey: ['saved-show-details', [...ids].sort()],
    enabled: ids.length > 0,
    // Unsaving a show rewrites the key; without this the list empties for a beat.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<NearbyEvent[]> => {
      const data = await apiPost<{ items: NearbyEvent[] }>('/events/by-ids', { ids });
      return data.items ?? [];
    },
  });
}

/**
 * Upcoming shows for the artists and venues held on the device.
 *
 * Asked as its own question rather than filtered out of `useNearbyEvents`: that
 * feed is one bounded page of what's nearest in time inside a radius, so a followed
 * artist playing past the end of it was invisible. This asks about the follows
 * themselves and keeps the radius as the bound — the whole horizon inside it, not
 * the first page of it. Without a point there is no gate, only no distances.
 */
export function useFollowingEvents(
  ids: { artistIds: string[]; spotifyIds: string[]; venueIds: string[] },
  coords: Coords | null,
  radiusMiles: number | null,
) {
  // Caller order is kept — the stores hold the newest follow first — so a list over
  // the cap loses its oldest entries rather than whichever ids happen to sort last.
  const clean = (list: string[]) => [...new Set(list.filter(Boolean))].slice(0, FOLLOWING_IDS_MAX);
  const artistIds = clean(ids.artistIds);
  const spotifyIds = clean(ids.spotifyIds);
  const venueIds = clean(ids.venueIds);
  // Sorted only for the key, so the same set in a new order isn't a new query.
  const key = [artistIds, spotifyIds, venueIds].map((l) => [...l].sort());
  // Rounded into the key too: distance labels don't need to survive every GPS
  // twitch, and a raw point would refetch the whole list each time it moved a metre.
  const near = coords ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}` : null;
  // No point means no gate: a radius is meaningless without somewhere to measure
  // from, and an empty screen would be the wrong way to say location is off.
  const radius = coords ? radiusMiles : null;
  return useQuery({
    queryKey: ['following-events', ...key, near, radius],
    enabled: artistIds.length + spotifyIds.length + venueIds.length > 0,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<FollowingEvent[]> => {
      const data = await apiPost<{ items: FollowingEvent[] }>(
        '/following',
        {
          artistIds,
          spotifyIds,
          venueIds,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          radiusMiles: radius,
        },
        // Carries coordinates, so no token — see RequestOpts in api.ts.
        { anonymous: true },
      );
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

/**
 * The venue's description, photo and derived stats.
 *
 * Its own query rather than part of `useVenue` because a venue nobody has opened
 * before reaches Wikipedia on the way, and the name and map shouldn't wait on that.
 * Cached for an hour on the client and, once fetched, indefinitely on the venue row
 * — a room's photograph doesn't change.
 */
export function useVenueInfo(venueId: string) {
  return useQuery({
    queryKey: ['venue-info', venueId],
    staleTime: 60 * 60 * 1000,
    queryFn: (): Promise<VenueInfo> => apiGet(`/venues/${venueId}/info`),
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
  // Keyed on the trimmed query it actually sends, like useTownSearch — " foo"
  // and "foo" are one request and should be one cache entry.
  const q = query.trim();
  return useQuery({
    queryKey: ['artist-search', q],
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ArtistSearchResult[]> => {
      const data = await apiPost<{ artists?: ArtistSearchResult[] }>('/search-artists', {
        query: q,
      });
      return data.artists ?? [];
    },
  });
}
