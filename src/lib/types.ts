/** One upcoming show near a point, as returned by the `nearby_events` RPC. */
export type NearbyEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  price_from: number | null;
  artist_id: string;
  artist_name: string;
  artist_image_url: string | null;
  artist_spotify_id: string | null;
  artist_genres: string[];
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  distance_miles: number | null;
};

export type ArtistEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  price_from: number | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
};

export type EventDetail = {
  id: string;
  name: string;
  starts_at: string;
  ticket_url: string | null;
  price_from: number | null;
  source: string;
  artist: {
    id: string;
    name: string;
    spotify_id: string | null;
    image_url: string | null;
    genres: string[];
  };
  venue: {
    id: string;
    name: string | null;
    city: string | null;
    region: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
};

/** A venue and its upcoming shows (the /api/venues/:id response). */
export type VenueEvent = {
  event_id: string;
  event_name: string;
  starts_at: string;
  ticket_url: string | null;
  price_from: number | null;
  artist_id: string;
  artist_name: string;
  artist_image_url: string | null;
  artist_genres: string[];
};

export type VenueDetail = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
};

/** A page of a paginated list (cursor = next offset, or null when done). */
export type Page<T> = { items: T[]; nextCursor: number | null };

export type Artist = {
  id: string;
  name: string;
  spotify_id: string | null;
  image_url: string | null;
  genres: string[];
};

export type ArtistTrack = {
  id: string;
  name: string;
  album: string | null;
  image_url: string | null;
  /** 30s preview mp3 (Deezer), when available. */
  preview_url: string | null;
  /** Link to the full track. */
  url: string | null;
};

/** Aggregated public info for an artist (Spotify link/image, Deezer top tracks
 *  + fan count, Wikipedia bio). Any field may be null when a source misses. */
export type ArtistInfo = {
  spotify_url: string | null;
  image_url: string | null;
  followers: number | null;
  bio: string | null;
  bio_url: string | null;
  top_tracks: ArtistTrack[];
};

export type ArtistSearchResult = {
  spotify_id: string;
  name: string;
  image_url: string | null;
  genres: string[];
  popularity: number;
};

export type Coords = { lat: number; lng: number };
