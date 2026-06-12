export type FollowedEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  artist_id: string;
  artist_name: string;
  artist_image_url: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
  distance_miles: number | null;
};

export type NearbyEvent = FollowedEvent & {
  artist_genres: string[];
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

export type Follow = {
  artist_id: string;
  artist: Artist;
};

export type ArtistSearchResult = {
  spotify_id: string;
  name: string;
  image_url: string | null;
  genres: string[];
  popularity: number;
};

export type Profile = {
  id: string;
  home_label: string | null;
  notify_radius_miles: number;
  expo_push_token: string | null;
};

export type Coords = { lat: number; lng: number };
