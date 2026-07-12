import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type {
  Artist,
  ArtistEvent,
  ArtistSearchResult,
  Coords,
  EventDetail,
  NearbyEvent,
} from '@/lib/types';

/** Upcoming shows near a point, soonest first. Powers the home feed. */
export function useNearbyEvents(coords: Coords | null, radiusMiles: number) {
  return useQuery({
    queryKey: ['nearby-events', coords, radiusMiles],
    enabled: coords != null,
    queryFn: async (): Promise<NearbyEvent[]> => {
      const { data, error } = await supabase.rpc('nearby_events', {
        p_lat: coords!.lat,
        p_lng: coords!.lng,
        p_radius_miles: radiusMiles,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ['event', eventId],
    queryFn: async (): Promise<EventDetail> => {
      const { data, error } = await supabase
        .from('events')
        .select(
          'id, name, starts_at, ticket_url, source, artist:artists(id, name, spotify_id, image_url, genres), venue:venues(name, city, region)',
        )
        .eq('id', eventId)
        .single();
      if (error) throw error;
      return data as unknown as EventDetail;
    },
  });
}

export function useArtist(artistId: string) {
  return useQuery({
    queryKey: ['artist', artistId],
    queryFn: async (): Promise<Artist> => {
      const { data, error } = await supabase
        .from('artists')
        .select('id, name, spotify_id, image_url, genres')
        .eq('id', artistId)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useArtistEvents(artistId: string) {
  return useQuery({
    queryKey: ['artist-events', artistId],
    queryFn: async (): Promise<ArtistEvent[]> => {
      const { data, error } = await supabase.rpc('artist_events', { p_artist_id: artistId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useArtistSearch(query: string) {
  return useQuery({
    queryKey: ['artist-search', query],
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ArtistSearchResult[]> => {
      const { data, error } = await supabase.functions.invoke('search-artists', {
        body: { query: query.trim() },
      });
      if (error) throw error;
      return data?.artists ?? [];
    },
  });
}
