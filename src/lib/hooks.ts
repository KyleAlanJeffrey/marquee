import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type {
  Artist,
  ArtistEvent,
  ArtistSearchResult,
  Coords,
  Follow,
  FollowedEvent,
  NearbyEvent,
  Profile,
} from '@/lib/types';

// --- Queries ---------------------------------------------------------------

export function useFollowedEvents() {
  return useQuery({
    queryKey: ['followed-events'],
    queryFn: async (): Promise<FollowedEvent[]> => {
      const { data, error } = await supabase.rpc('followed_events');
      if (error) throw error;
      return data ?? [];
    },
  });
}

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

export function useFollows() {
  return useQuery({
    queryKey: ['follows'],
    queryFn: async (): Promise<Follow[]> => {
      const { data, error } = await supabase
        .from('follows')
        .select('artist_id, artist:artists(id, name, spotify_id, image_url, genres)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as Follow[]) ?? [];
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
      const { data, error } = await supabase.rpc('artist_events', {
        p_artist_id: artistId,
      });
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

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, home_label, notify_radius_miles, expo_push_token')
        .single();
      if (error) throw error;
      return data;
    },
  });
}

// --- Mutations ---------------------------------------------------------------

export function useFollowArtist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artist: {
      spotify_id: string;
      name: string;
      image_url: string | null;
      genres: string[];
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('follow_artist', {
        p_spotify_id: artist.spotify_id,
        p_name: artist.name,
        p_image_url: artist.image_url,
        p_genres: artist.genres,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follows'] });
      queryClient.invalidateQueries({ queryKey: ['followed-events'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-events'] });
    },
  });
}

export function useFollowExistingArtist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artistId: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('follows')
        .upsert({ user_id: userData.user!.id, artist_id: artistId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follows'] });
      queryClient.invalidateQueries({ queryKey: ['followed-events'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-events'] });
    },
  });
}

export function useUnfollowArtist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artistId: string) => {
      const { error } = await supabase.from('follows').delete().eq('artist_id', artistId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follows'] });
      queryClient.invalidateQueries({ queryKey: ['followed-events'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-events'] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Profile, 'notify_radius_miles' | 'expo_push_token'>>) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userData.user!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useSetHomeLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ coords, label }: { coords: Coords; label: string | null }) => {
      const { error } = await supabase.rpc('set_home_location', {
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_label: label,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['followed-events'] });
    },
  });
}
