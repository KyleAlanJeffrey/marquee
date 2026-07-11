/** One upcoming show near a point, as returned by the `nearby_events` RPC. */
export type NearbyEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  artist_id: string;
  artist_name: string;
  artist_image_url: string | null;
  artist_spotify_id: string | null;
  artist_genres: string[];
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
  distance_miles: number | null;
};

export type ArtistEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
};

export type Artist = {
  id: string;
  name: string;
  spotify_id: string | null;
  image_url: string | null;
  genres: string[];
};

export type ArtistSearchResult = {
  spotify_id: string;
  name: string;
  image_url: string | null;
  genres: string[];
  popularity: number;
};

export type Coords = { lat: number; lng: number };
