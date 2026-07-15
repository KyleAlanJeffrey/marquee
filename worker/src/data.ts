import { and, between, eq, gte, lte, sql } from 'drizzle-orm';

import { getDb, type DB } from './db';
import type { Env } from './env';
import { artists, events, venues } from './schema';

// --- helpers ----------------------------------------------------------------

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
export const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 19) + 'Z';

export function parseGenres(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- types ------------------------------------------------------------------

export type VenueRow = {
  source: string;
  source_venue_id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export type EventInput = {
  source: string;
  source_event_id: string;
  name: string;
  starts_at: string;
  ticket_url: string | null;
  price_from: number | null;
  artist_id: string;
  venue: VenueRow | null;
};

export type IncomingArtist = {
  artistId?: string | null;
  spotifyId?: string | null;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
};

export type ArtistIdentity = {
  id: string;
  name: string;
  ticketmaster_id: string | null;
  bandsintown_name: string | null;
};

// --- Reads (feed / detail) --------------------------------------------------

export async function nearbyEvents(
  db: DB,
  lat: number,
  lng: number,
  radiusMiles: number,
  limit = 400,
  offset = 0,
) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  // Bounding-box prefilter on the indexed lat/lng; the exact radius check is the
  // haversine below (SQLite has no spherical distance).
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      artist_id: artists.id,
      artist_name: artists.name,
      artist_image_url: artists.imageUrl,
      artist_spotify_id: artists.spotifyId,
      artist_genres: artists.genres,
      venue_name: venues.name,
      venue_city: venues.city,
      venue_region: venues.region,
      venue_lat: venues.lat,
      venue_lng: venues.lng,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        gte(events.startsAt, nowIso()),
        lte(events.startsAt, isoInDays(120)),
        between(venues.lat, lat - latDelta, lat + latDelta),
        between(venues.lng, lng - lngDelta, lng + lngDelta),
      ),
    )
    // Collapse the same show listed under multiple TM ids (VIP/packages/etc.).
    .groupBy(events.artistId, events.venueId, events.startsAt)
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);

  const items = rows
    .map((r) => ({
      ...r,
      artist_genres: parseGenres(r.artist_genres),
      distance_miles:
        r.venue_lat != null && r.venue_lng != null
          ? haversineMiles(lat, lng, r.venue_lat, r.venue_lng)
          : null,
    }))
    .filter((r) => r.distance_miles == null || r.distance_miles <= radiusMiles);

  // Page on the SQL row count (pre-haversine) so we keep advancing even when a
  // page loses a few corner-of-the-bbox rows to the radius filter.
  const nextCursor = rows.length === limit ? offset + limit : null;
  return { items, nextCursor };
}

export async function artistById(db: DB, id: string) {
  const r = await db
    .select({
      id: artists.id,
      name: artists.name,
      spotify_id: artists.spotifyId,
      image_url: artists.imageUrl,
      genres: artists.genres,
    })
    .from(artists)
    .where(eq(artists.id, id))
    .get();
  if (!r) return null;
  return { ...r, genres: parseGenres(r.genres) };
}

export async function artistEvents(db: DB, id: string) {
  return db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      venue_id: venues.id,
      venue_name: venues.name,
      venue_city: venues.city,
      venue_region: venues.region,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.artistId, id), gte(events.startsAt, nowIso())))
    .groupBy(events.artistId, events.venueId, events.startsAt)
    .orderBy(events.startsAt);
}

export async function eventById(db: DB, id: string) {
  const r = await db
    .select({
      id: events.id,
      name: events.name,
      starts_at: events.startsAt,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      source: events.source,
      a_id: artists.id,
      a_name: artists.name,
      a_spotify: artists.spotifyId,
      a_image: artists.imageUrl,
      a_genres: artists.genres,
      v_id: venues.id,
      v_name: venues.name,
      v_city: venues.city,
      v_region: venues.region,
      v_lat: venues.lat,
      v_lng: venues.lng,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, id))
    .get();
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    starts_at: r.starts_at,
    ticket_url: r.ticket_url,
    price_from: r.price_from,
    source: r.source,
    artist: {
      id: r.a_id,
      name: r.a_name,
      spotify_id: r.a_spotify,
      image_url: r.a_image,
      genres: parseGenres(r.a_genres),
    },
    venue: r.v_name
      ? { id: r.v_id, name: r.v_name, city: r.v_city, region: r.v_region, lat: r.v_lat, lng: r.v_lng }
      : null,
  };
}

/** Venue metadata. */
export async function venueById(db: DB, id: string) {
  const r = await db
    .select({
      id: venues.id,
      name: venues.name,
      city: venues.city,
      region: venues.region,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(venues)
    .where(eq(venues.id, id))
    .get();
  return r ?? null;
}

/** A page of a venue's upcoming shows. */
export async function venueEvents(db: DB, id: string, limit = 20, offset = 0) {
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      artist_id: artists.id,
      artist_name: artists.name,
      artist_image_url: artists.imageUrl,
      artist_genres: artists.genres,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .where(and(eq(events.venueId, id), gte(events.startsAt, nowIso())))
    .groupBy(events.artistId, events.venueId, events.startsAt)
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);
  const items = rows.map((r) => ({ ...r, artist_genres: parseGenres(r.artist_genres) }));
  return { items, nextCursor: rows.length === limit ? offset + limit : null };
}

// --- Writes -----------------------------------------------------------------

/** Upsert venues + insert unseen events; returns ids of newly inserted events. */
export async function persist(db: DB, inputs: EventInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];

  // Venues: upsert each, map (source:id) -> venue uuid.
  const venueRows = new Map<string, VenueRow>();
  for (const i of inputs) if (i.venue) venueRows.set(`${i.venue.source}:${i.venue.source_venue_id}`, i.venue);

  const venueIdByKey = new Map<string, string>();
  const venueKeys = [...venueRows.keys()];
  if (venueKeys.length) {
    const stmts = venueKeys.map((k) => {
      const v = venueRows.get(k)!;
      return db
        .insert(venues)
        .values({
          id: uuid(),
          source: v.source,
          sourceVenueId: v.source_venue_id,
          name: v.name,
          city: v.city,
          region: v.region,
          country: v.country,
          lat: v.lat,
          lng: v.lng,
        })
        .onConflictDoUpdate({
          target: [venues.source, venues.sourceVenueId],
          set: {
            name: sql`excluded.name`,
            city: sql`excluded.city`,
            region: sql`excluded.region`,
            country: sql`excluded.country`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
          },
        })
        .returning({ id: venues.id });
    });
    const res = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    res.forEach((rows, idx) => {
      const id = rows[0]?.id;
      if (id) venueIdByKey.set(venueKeys[idx], id);
    });
  }

  // Events: insert-if-new, RETURNING only new rows.
  const stmts = inputs.map((i) =>
    db
      .insert(events)
      .values({
        id: uuid(),
        artistId: i.artist_id,
        venueId: i.venue ? venueIdByKey.get(`${i.venue.source}:${i.venue.source_venue_id}`) ?? null : null,
        name: i.name,
        startsAt: i.starts_at,
        ticketUrl: i.ticket_url,
        priceFrom: i.price_from,
        source: i.source,
        sourceEventId: i.source_event_id,
      })
      .onConflictDoNothing({ target: [events.source, events.sourceEventId] })
      .returning({ id: events.id }),
  );
  const res = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  const newIds: string[] = [];
  for (const rows of res) if (rows[0]?.id) newIds.push(rows[0].id);
  return newIds;
}

/** Ticketmaster returns several resolutions per attraction; pick the sharpest
 *  (widest, non-fallback) instead of whatever happens to be first. */
export function bestTmImage(images: any): string | null {
  if (!Array.isArray(images)) return null;
  const usable = images.filter((i) => i?.url);
  if (!usable.length) return null;
  const byWidth = [...usable].sort((a, b) => (b.width || 0) - (a.width || 0));
  const nonFallback = byWidth.filter((i) => !i.fallback);
  return (nonFallback[0] ?? byWidth[0]).url;
}

export async function upsertTmArtist(db: DB, attraction: any): Promise<string | null> {
  if (!attraction?.id || !attraction?.name) return null;
  const genres = (attraction.classifications ?? [])
    .map((c: any) => c.genre?.name)
    .filter((g: string) => g && g !== 'Undefined');
  const r = await db
    .insert(artists)
    .values({
      id: uuid(),
      ticketmasterId: attraction.id,
      name: attraction.name,
      imageUrl: bestTmImage(attraction.images),
      genres: JSON.stringify(genres),
    })
    .onConflictDoUpdate({
      target: artists.ticketmasterId,
      set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, genres: sql`excluded.genres` },
    })
    .returning({ id: artists.id })
    .get();
  return r?.id ?? null;
}

export async function ensureArtist(db: DB, a: IncomingArtist): Promise<ArtistIdentity | null> {
  const cols = {
    id: artists.id,
    name: artists.name,
    ticketmaster_id: artists.ticketmasterId,
    bandsintown_name: artists.bandsintownName,
  };
  if (a.artistId) {
    const r = await db.select(cols).from(artists).where(eq(artists.id, a.artistId)).get();
    if (r) return r;
  }
  if (a.spotifyId) {
    const r = await db
      .insert(artists)
      .values({
        id: uuid(),
        spotifyId: a.spotifyId,
        name: a.name,
        imageUrl: a.imageUrl ?? null,
        genres: JSON.stringify(a.genres ?? []),
      })
      .onConflictDoUpdate({
        target: artists.spotifyId,
        set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, genres: sql`excluded.genres` },
      })
      .returning(cols)
      .get();
    return r ?? null;
  }
  return null;
}

/** Upsert a single artist (typically from a Spotify search result) and return
 *  the full stored record. Fast — no external event fetch; the artist screen
 *  pulls the schedule on open. */
export async function ensureArtistRecord(env: Env, a: IncomingArtist) {
  const db = getDb(env.DB);
  const row = await ensureArtist(db, a);
  if (!row) return null;
  return artistById(db, row.id);
}
