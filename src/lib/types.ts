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
  /** Our canonical venue id, so a followed venue can be matched against a show. */
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_region: string | null;
  /** IANA zone of the venue, when we can name one — show times belong to the
   *  place, not to whoever is reading. Null falls back to the device clock. */
  venue_timezone: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  distance_miles: number | null;
};

/**
 * A show on the Following screen, tagged with which half of the question it
 * answers. The server decides: rows come back under the canonical venue id, which
 * isn't necessarily the id the device stored, so the client can't tell.
 */
export type FollowingEvent = NearbyEvent & {
  matched_artist: boolean;
  matched_venue: boolean;
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
  venue_timezone: string | null;
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
    timezone: string | null;
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

/**
 * A venue near a point, with how much is on there. One entry per *canonical*
 * venue, so a room several sources name differently appears once.
 */
export type NearbyVenue = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  upcoming: number;
  next_at: string;
  distance_miles: number | null;
};

export type VenueDetail = {
  id: string;
  /** Null when the row is named after a tour rather than a room — the server
   *  refuses to publish those, so the town is the honest heading. */
  name: string | null;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  /** Its shows are listed in this zone (see `NearbyEvent.venue_timezone`). */
  timezone: string | null;
};

/**
 * What a room is like, rather than just what's on there.
 *
 * `stats` is always present — every number in it comes from shows we already hold,
 * so it works for a basement venue as well as an arena. `description` and `photo`
 * come from Wikipedia and are usually null: it covers named theatres and arenas and
 * knows nothing about the club tier.
 */
export type VenueInfo = {
  description: string | null;
  /** The article, for the CC BY-SA attribution the licence requires. */
  description_url: string | null;
  /** Free-licensed, so it never arrives without its credit — the server drops the
   *  photo entirely rather than publish one it can't attribute. */
  photo: {
    url: string;
    credit: string | null;
    license: string;
    license_url: string | null;
  } | null;
  stats: {
    upcoming: number;
    past: number;
    /** Distinct acts booked here, across everything we know about. */
    acts: number;
    next_at: string | null;
    last_at: string | null;
    /** Lowest advertised entry price of anything upcoming, or null. */
    cheapest: number | null;
    /** "2026-09", the month with the most upcoming shows. */
    busiest_month: string | null;
    busiest_month_shows: number;
    genres: string[];
    recent: {
      artist_id: string;
      artist_name: string;
      artist_image_url: string | null;
      starts_at: string;
    }[];
  } | null;
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

/** A real post about a show (from Bluesky's open search). */
export type BuzzPost = {
  id: string;
  author: string;
  handle: string;
  avatar: string | null;
  text: string;
  image: string | null;
  likes: number;
  replies: number;
  reposts: number;
  created_at: string | null;
  url: string;
};

export type EventBuzz = { posts: BuzzPost[] };

export type SupportAct = { name: string; image_url: string | null };
export type EventLineup = { support: SupportAct[] };

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

/** A town we have upcoming shows in, with the centroid of its venues. */
export type Town = {
  city: string;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
  /** Upcoming shows in the next year. */
  upcoming: number;
  venues: number;
};

export type Coords = { lat: number; lng: number };
