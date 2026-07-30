import { and, between, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { getDb, type DB } from './db';
import { zoneFor } from './timezone';
import {
  bestVenueMatch,
  hoursApart,
  isPlaceholderPoint,
  looksLikeTourName,
  PLACEHOLDER_POINT_GROUPS,
  pointKey,
  sameVenue,
  mergeField,
  parseSources,
  sameShow,
  SHOW_MATCH_HOURS,
  VENUE_SAME_NAME_METERS,
  type VenuePoint,
} from './dedupe';
import type { Env } from './env';
import { artists, artistSources, events, ingestRuns, venues } from './schema';

// --- helpers ----------------------------------------------------------------

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
export const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 19) + 'Z';
export const isoAt = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** Sources send both `null` and `''` for "no region"; the UI only handles one. */
const blankToNull = (v: string | null) => (v && v.trim() !== '' ? v : null);

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
  /** Only some sources publish an end time (Bandsintown, festivals). */
  ends_at?: string | null;
  ticket_url: string | null;
  price_from: number | null;
  sold_out?: boolean | null;
  is_free?: boolean | null;
  /** Billed acts, headliner first (Bandsintown). */
  lineup?: string[] | null;
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
  bandsintown_id: string | null;
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
  const canon = alias(venues, 'canon');
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
      // Identity and naming come from the canonical row, so a card and the venue
      // page it opens agree on which room this is. The coordinates stay on the
      // row the bounding box below actually filtered.
      venue_id: canon.id,
      venue_name: canon.name,
      venue_city: canon.city,
      venue_region: canon.region,
      venue_country: canon.country,
      venue_lat: venues.lat,
      venue_lng: venues.lng,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(
      and(
        gte(events.startsAt, nowIso()),
        lte(events.startsAt, isoInDays(120)),
        between(venues.lat, lat - latDelta, lat + latDelta),
        between(venues.lng, lng - lngDelta, lng + lngDelta),
      ),
    )
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);

  const items = rows
    .map((r) => ({
      ...r,
      artist_genres: parseGenres(r.artist_genres),
      // The zone the show actually happens in: a 23:00 gig in London is not a
      // 3pm gig, whatever the reader's own clock says.
      venue_timezone: zoneFor(r.venue_region, r.venue_country),
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

/**
 * How many grouped venue rows one nearby-venues query will consider. The bounding
 * box already limits this to one radius around one point, so this is a ceiling
 * against a dense city rather than a page size — the exact radius filter and the
 * ordering both happen after, on the rows we have.
 */
const NEARBY_VENUE_SCAN = 200;

/**
 * Venues with upcoming shows near a point, busiest first.
 *
 * Grouped by *canonical* venue, joining through `canonical_venue_id`, so a room
 * three sources name differently is one entry holding all of its shows rather
 * than three thin ones. Busiest-first rather than nearest-first: the nearest
 * venues to any given point are largely a function of where the user is standing,
 * whereas the rooms with the most on are the ones worth a tap.
 */
export async function nearbyVenues(
  db: DB,
  lat: number,
  lng: number,
  radiusMiles: number,
  limit = 12,
) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const canon = alias(venues, 'canon');
  const upcoming = sql<number>`count(distinct ${events.id})`;

  const rows = await db
    .select({
      id: canon.id,
      name: canon.name,
      city: canon.city,
      region: canon.region,
      country: canon.country,
      lat: canon.lat,
      lng: canon.lng,
      upcoming,
      next_at: sql<string>`min(${events.startsAt})`,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(
      and(
        gte(events.startsAt, nowIso()),
        lte(events.startsAt, isoInDays(120)),
        between(canon.lat, lat - latDelta, lat + latDelta),
        between(canon.lng, lng - lngDelta, lng + lngDelta),
        sql`${canon.name} is not null and trim(${canon.name}) <> ''`,
      ),
    )
    .groupBy(canon.id)
    .orderBy(sql`count(distinct ${events.id}) desc`)
    .limit(NEARBY_VENUE_SCAN);

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      city: blankToNull(r.city),
      region: blankToNull(r.region),
      country: blankToNull(r.country),
      lat: r.lat,
      lng: r.lng,
      timezone: zoneFor(r.region, r.country),
      upcoming: r.upcoming,
      next_at: r.next_at,
      distance_miles:
        r.lat != null && r.lng != null ? haversineMiles(lat, lng, r.lat, r.lng) : null,
    }))
    // The box is square and the radius is round, so its corners reach ~1.4x.
    .filter((r) => r.distance_miles == null || r.distance_miles <= radiusMiles)
    .sort((a, b) => b.upcoming - a.upcoming || (a.distance_miles ?? 0) - (b.distance_miles ?? 0))
    .slice(0, limit);
}

/** Ids per `in (...)` lookup, under D1's 100-bound-parameter ceiling. */
const EVENT_LOOKUP_CHUNK = 90;
/** A saved list longer than this is not a reading list, it's a scrape. */
export const EVENTS_BY_IDS_MAX = 200;

/**
 * The current rows for a set of event ids, in the same shape as the nearby feed.
 *
 * This is what keeps the Saved screen honest: it renders instantly from the
 * snapshot stored on the device, then replaces it with this. Doors get moved and
 * shows get pulled, and a saved show is exactly the case where a stale time costs
 * somebody their evening. Ids that no longer exist are simply absent, which is
 * how the screen knows to mark them gone.
 */
export async function eventsByIds(db: DB, ids: string[]) {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))].slice(
    0,
    EVENTS_BY_IDS_MAX,
  );
  if (unique.length === 0) return [];

  const canon = alias(venues, 'canon');
  const rows: {
    event_id: string;
    event_name: string;
    starts_at: string;
    ticket_url: string | null;
    price_from: number | null;
    artist_id: string;
    artist_name: string;
    artist_image_url: string | null;
    artist_spotify_id: string | null;
    artist_genres: string | null;
    venue_id: string | null;
    venue_name: string | null;
    venue_city: string | null;
    venue_region: string | null;
    venue_country: string | null;
    venue_lat: number | null;
    venue_lng: number | null;
  }[] = [];

  for (let i = 0; i < unique.length; i += EVENT_LOOKUP_CHUNK) {
    const chunk = await db
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
        venue_id: canon.id,
        venue_name: canon.name,
        venue_city: canon.city,
        venue_region: canon.region,
        venue_country: canon.country,
        venue_lat: canon.lat,
        venue_lng: canon.lng,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .leftJoin(venues, eq(venues.id, events.venueId))
      .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(
        and(
          inArray(events.id, unique.slice(i, i + EVENT_LOOKUP_CHUNK)),
          gte(events.startsAt, nowIso()),
        ),
      );
    rows.push(...chunk);
  }

  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return rows.map((r) => ({
    ...r,
    artist_genres: parseGenres(r.artist_genres),
    venue_timezone: zoneFor(r.venue_region, r.venue_country),
    distance_miles: null as number | null,
  }));
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
  const rows = await db
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
      venue_country: venues.country,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.artistId, id), gte(events.startsAt, nowIso())))
    .orderBy(events.startsAt);
  return rows.map((r) => ({ ...r, venue_timezone: zoneFor(r.venue_region, r.venue_country) }));
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
      v_country: venues.country,
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
      ? {
          id: r.v_id,
          name: r.v_name,
          city: r.v_city,
          region: r.v_region,
          lat: r.v_lat,
          lng: r.v_lng,
          timezone: zoneFor(r.v_region, r.v_country),
        }
      : null,
  };
}

/**
 * Towns with upcoming shows, best match first. `q` matches anywhere in the city
 * name but ranks a prefix hit first, so "port" finds Portland before Millersport.
 * Without `q` this is the busiest towns we know about, which is what the search
 * screen shows before anyone types.
 *
 * The centroid is the average of the town's venue coordinates — enough to open
 * the feed on, and it needs no geocoding service.
 */
export async function searchTowns(db: DB, q: string, limit = 12) {
  const term = q.trim().toLowerCase();
  const busiest = sql`count(distinct ${events.id}) desc`;
  // A prefix hit is what the user meant; after that, the busiest town wins. Note
  // sql`1` would be an *ordinal* reference in SQLite (sort by the first column),
  // so the no-search case has to omit the ranking term rather than neutralise it.
  const order = term
    ? [sql`case when lower(${venues.city}) like ${`${term}%`} then 0 else 1 end`, busiest]
    : [busiest];

  const rows = await db
    .select({
      city: venues.city,
      region: venues.region,
      country: venues.country,
      lat: sql<number>`avg(${venues.lat})`,
      lng: sql<number>`avg(${venues.lng})`,
      upcoming: sql<number>`count(distinct ${events.id})`,
      venues: sql<number>`count(distinct ${venues.id})`,
    })
    .from(venues)
    .innerJoin(events, eq(events.venueId, venues.id))
    .where(
      and(
        gte(events.startsAt, nowIso()),
        lte(events.startsAt, isoInDays(365)),
        sql`${venues.city} is not null and trim(${venues.city}) <> ''`,
        sql`${venues.lat} is not null and ${venues.lng} is not null`,
        term ? sql`lower(${venues.city}) like ${`%${term}%`}` : undefined,
      ),
    )
    // One town per (city, region): "Portland, OR" and "Portland, ME" are two.
    .groupBy(sql`lower(${venues.city})`, sql`lower(coalesce(${venues.region}, ''))`)
    .orderBy(...order)
    .limit(limit);

  return rows.map((r) => ({
    city: r.city as string,
    region: blankToNull(r.region),
    country: blankToNull(r.country),
    lat: r.lat,
    lng: r.lng,
    upcoming: r.upcoming,
    venues: r.venues,
  }));
}

/** Venue metadata. */
/**
 * A venue, by any of its ids.
 *
 * Sources name the same room differently, so several rows can point at one
 * canonical venue; whichever member id the caller arrived with, they get the
 * canonical identity back. One room, one page, one id to follow.
 */
export async function venueById(db: DB, id: string) {
  const canon = alias(venues, 'canon');
  const r = await db
    .select({
      id: canon.id,
      name: canon.name,
      city: canon.city,
      region: canon.region,
      country: canon.country,
      lat: canon.lat,
      lng: canon.lng,
    })
    .from(venues)
    .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(eq(venues.id, id))
    .get();
  return r ? { ...r, timezone: zoneFor(r.region, r.country) } : null;
}

/**
 * A page of a venue's upcoming shows — every show in its cluster, not just the
 * ones filed against this exact row, and again by any of its ids: resolve to the
 * cluster head first, then take every member's shows.
 */
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
    .where(
      and(
        sql`${events.venueId} in (
          select id from ${venues}
          where coalesce(canonical_venue_id, id) = (
            select coalesce(canonical_venue_id, id) from ${venues} where id = ${id}
          )
        )`,
        gte(events.startsAt, nowIso()),
      ),
    )
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);
  const items = rows.map((r) => ({ ...r, artist_genres: parseGenres(r.artist_genres) }));
  return { items, nextCursor: rows.length === limit ? offset + limit : null };
}

// --- Writes -----------------------------------------------------------------

/**
 * A show more than this far out is almost always a data error (a mis-parsed year,
 * a placeholder date), and one already past is dead weight in a table whose reads
 * are all "upcoming".
 */
const MAX_YEARS_AHEAD = 2;
/** Cap per artist per pass, so one malformed feed can't flood the table. */
const MAX_EVENTS_PER_ARTIST = 200;

/** Drop listings we shouldn't store at all: past, absurdly far out, or a flood. */
export function sanitizeInputs(inputs: EventInput[], now = Date.now()): EventInput[] {
  const horizon = now + MAX_YEARS_AHEAD * 365 * 86_400_000;
  const perArtist = new Map<string, number>();
  const kept: EventInput[] = [];
  for (const i of inputs) {
    const t = Date.parse(i.starts_at);
    if (Number.isNaN(t) || t < now - 86_400_000 || t > horizon) continue;
    const n = perArtist.get(i.artist_id) ?? 0;
    if (n >= MAX_EVENTS_PER_ARTIST) continue;
    perArtist.set(i.artist_id, n + 1);
    kept.push(i);
  }
  return kept;
}

/** Upsert venues + insert unseen events; returns ids of newly inserted events. */
export async function persist(db: DB, raw: EventInput[]): Promise<string[]> {
  const inputs = sanitizeInputs(raw);
  if (raw.length !== inputs.length) {
    console.warn(`persist: dropped ${raw.length - inputs.length} unusable listing(s)`);
  }
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
    const res = await batchChunked<{ id: string }[]>(db, stmts);
    res.forEach((rows, idx) => {
      const id = rows[0]?.id;
      if (id) venueIdByKey.set(venueKeys[idx], id);
    });
  }

  // Point each venue at the row that represents its physical location, so a room
  // Ticketmaster and Bandsintown name differently still holds one set of shows.
  const canonicalByKey = await canonicalizeVenues(db, venueKeys, venueRows, venueIdByKey);

  const venueFor = (i: EventInput) =>
    i.venue ? canonicalByKey.get(`${i.venue.source}:${i.venue.source_venue_id}`) ?? null : null;

  // Is this show already on file — from this source, or from another one? A
  // Ticketmaster listing and a Bandsintown listing of the same night must end up
  // as one row, or the feed shows the gig twice.
  const found = await findExistingShows(
    db,
    inputs.map((i) => ({
      source: i.source,
      sourceEventId: i.source_event_id,
      artistId: i.artist_id,
      venueId: venueFor(i),
      startsAt: i.starts_at,
    })),
  );

  const inserts: (typeof events.$inferInsert)[] = [];
  /**
   * Updates keyed by event id, because several incoming listings can land on one
   * show. Each is folded through `mergeShow` in turn and written once: a separate
   * statement per listing would recompute from the original row every time, so
   * the last write would erase the provenance the earlier ones added.
   */
  const pending = new Map<string, { row: ExistingShow; listings: { input: EventInput; venueId: string | null }[] }>();
  const stage = (id: string, row: ExistingShow, input: EventInput, venueId: string | null) => {
    const entry = pending.get(id) ?? { row, listings: [] };
    entry.listings.push({ input, venueId });
    pending.set(id, entry);
  };
  /** Rows this batch is about to insert, so a sibling listing can join them. */
  const staged: { id: string; row: ExistingShow }[] = [];

  inputs.forEach((i, idx) => {
    const venueId = venueFor(i);
    const existing = found[idx];
    if (existing) {
      stage(existing.id, existing, i, venueId);
      return;
    }

    // Both sources for one artist are fetched together (`refreshArtists`), and
    // `findExistingShows` ran before any of them was written — so a Ticketmaster
    // and a Bandsintown listing of the same night have to find each other here,
    // or they become two rows that only `repair-duplicates` can collapse.
    const sibling = staged.find((s) =>
      sameShow(
        { artistId: s.row.artistId, venueId: s.row.venueId, startsAt: s.row.startsAt },
        { artistId: i.artist_id, venueId, startsAt: i.starts_at },
      ),
    );
    if (sibling) {
      stage(sibling.id, sibling.row, i, venueId ?? sibling.row.venueId);
      return;
    }

    const id = uuid();
    const values = {
      id,
      artistId: i.artist_id,
      venueId,
      name: i.name,
      startsAt: i.starts_at,
      endsAt: i.ends_at ?? null,
      ticketUrl: i.ticket_url,
      priceFrom: i.price_from,
      soldOut: i.sold_out ?? null,
      isFree: i.is_free ?? null,
      lineup: i.lineup?.length ? JSON.stringify(i.lineup) : null,
      source: i.source,
      sourceEventId: i.source_event_id,
      sources: JSON.stringify({ [i.source]: i.source_event_id }),
    };
    inserts.push(values);
    staged.push({ id, row: { ...values, sources: values.sources } });
  });

  const newIds: string[] = [];
  if (inserts.length) {
    const stmts = inserts.map((values) =>
      db
        .insert(events)
        .values(values)
        // Two listings in the same batch can still collide on the source key.
        .onConflictDoNothing({ target: [events.source, events.sourceEventId] })
        .returning({ id: events.id }),
    );
    const res = await batchChunked<{ id: string }[]>(db, stmts);
    for (const rows of res) if (rows[0]?.id) newIds.push(rows[0].id);
  }

  // After the inserts, so an update against a just-staged row has something to
  // update.
  await inBatches(
    db,
    [...pending.entries()].map(([id, { row, listings }]) => {
      let merged = row;
      let set = mergeShow(row, listings[0].input, listings[0].venueId);
      for (const { input, venueId } of listings.slice(1)) {
        merged = { ...merged, ...set };
        set = mergeShow(merged, input, venueId);
      }
      return db.update(events).set(set).where(eq(events.id, id));
    }),
  );

  return newIds;
}

type ExistingShow = {
  id: string;
  artistId: string;
  source: string;
  sourceEventId: string;
  sources: string | null;
  name: string;
  startsAt: string;
  endsAt: string | null;
  ticketUrl: string | null;
  priceFrom: number | null;
  soldOut: boolean | null;
  isFree: boolean | null;
  lineup: string | null;
  venueId: string | null;
};

/**
 * Merge an incoming listing into the show we already have. Field ownership lives
 * in `dedupe.ts`; the row's `source` stands in for per-field provenance, which is
 * a simplification but the right one for two sources with clear specialities.
 */
function mergeShow(row: ExistingShow, i: EventInput, venueId: string | null) {
  const from = i.source;
  const to = row.source;
  const pick = <T>(field: string, incoming: T | null | undefined, existing: T | null | undefined) =>
    mergeField(field, incoming, existing, from, to);

  return {
    name: pick('name', i.name, row.name) ?? row.name,
    startsAt: pick('starts_at', i.starts_at, row.startsAt) ?? row.startsAt,
    endsAt: pick('ends_at', i.ends_at ?? null, row.endsAt),
    ticketUrl: pick('ticket_url', i.ticket_url, row.ticketUrl),
    priceFrom: pick('price_from', i.price_from, row.priceFrom),
    soldOut: pick('sold_out', i.sold_out ?? null, row.soldOut),
    isFree: pick('is_free', i.is_free ?? null, row.isFree),
    lineup: pick('lineup', i.lineup?.length ? JSON.stringify(i.lineup) : null, row.lineup),
    // Never drop a venue we already resolved for a listing that lacks one.
    venueId: venueId ?? row.venueId,
    // Seed with the row's own id: rows written before `sources` existed have it
    // null, and a merge must not leave the kept row's provenance out.
    sources: JSON.stringify({
      [row.source]: row.sourceEventId,
      ...parseSources(row.sources),
      [i.source]: i.source_event_id,
    }),
  };
}

/**
 * For each incoming listing, the show already on file, or null. Matched by the
 * source's own id first (cheap and exact), then by the ids recorded in `sources`
 * from an earlier merge, then by venue + artist + a time window — Bandsintown
 * publishes venue-local times, so "same show" can't mean "same timestamp".
 */
async function findExistingShows(
  db: DB,
  keys: { source: string; sourceEventId: string; artistId: string; venueId: string | null; startsAt: string }[],
): Promise<(ExistingShow | null)[]> {
  if (keys.length === 0) return [];
  const cols = {
    id: events.id,
    artistId: events.artistId,
    source: events.source,
    sourceEventId: events.sourceEventId,
    sources: events.sources,
    name: events.name,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
    ticketUrl: events.ticketUrl,
    priceFrom: events.priceFrom,
    soldOut: events.soldOut,
    isFree: events.isFree,
    lineup: events.lineup,
    venueId: events.venueId,
  };

  const stmts = keys.map((k) => {
    const clauses = [
      and(eq(events.source, k.source), eq(events.sourceEventId, k.sourceEventId)),
      sql`json_extract(${events.sources}, ${'$."' + k.source + '"'}) = ${k.sourceEventId}`,
    ];
    const t = new Date(k.startsAt).getTime();
    if (k.venueId && !Number.isNaN(t)) {
      const window = SHOW_MATCH_HOURS * 3_600_000;
      clauses.push(
        and(
          // Anywhere in the venue's cluster, not just the row this listing
          // resolved to. `k.venueId` is already canonical, but a show stored
          // earlier can still point at a row that *was* the representative before
          // a later venue joined the cluster and took the name — lexicographic
          // order picks the representative, so it moves when the cluster grows.
          // Comparing ids directly missed those and left the show stored twice.
          sql`${events.venueId} in (
                select id from ${venues} where coalesce(canonical_venue_id, id) = ${k.venueId}
              )`,
          eq(events.artistId, k.artistId),
          between(events.startsAt, isoAt(t - window), isoAt(t + window)),
        ),
      );
    }
    // Exact-id matches sort first so a re-ingest updates its own row.
    return db
      .select(cols)
      .from(events)
      .where(or(...clauses))
      .orderBy(sql`case when ${events.source} = ${k.source} then 0 else 1 end`)
      .limit(1);
  });

  const res = await batchChunked<ExistingShow[]>(db, stmts);
  return res.map((rows) => rows[0] ?? null);
}

/**
 * How many upcoming events one repair pass will scan. Pass the returned
 * `next_artist_id` back in to continue past it.
 */
const REPAIR_EVENT_LIMIT = 5_000;

/**
 * Cluster the whole venue table, repoint events at canonical venues, and merge
 * shows that were stored twice before ingestion knew how to match them. Safe to
 * re-run; returns what it changed.
 *
 * `afterArtistId` resumes the event scan. Without it the scan always started from
 * the beginning, so with more upcoming events than the ceiling the tail was never
 * reached however many times it ran — production had 6,832 upcoming events against
 * a 5,000 ceiling, and a duplicated pair ranked 1,370 and 5,542, so the two rows
 * were never in scope together.
 */
export async function repairDuplicates(
  db: DB,
  opts: { afterArtistId?: string } = {},
): Promise<{
  venues_clustered: number;
  events_repointed: number;
  shows_merged: number;
  provenance_filled: number;
  truncated: boolean;
  next_artist_id: string | null;
}> {
  // Invariant: every row records its own upstream id in `sources`. Rows written
  // before the column existed don't, which would make a later merge lose track of
  // where the surviving row came from.
  const filled = await db.run(sql`
    update events
       set sources = json_set(coalesce(sources, '{}'), '$.' || source, source_event_id)
     where sources is null
        or json_extract(sources, '$.' || source) is null
  `);

  const all = await db
    .select({
      id: venues.id,
      name: venues.name,
      lat: venues.lat,
      lng: venues.lng,
      city: venues.city,
      canonicalVenueId: venues.canonicalVenueId,
    })
    .from(venues);

  // Deterministic order (by id) so the same row wins the cluster on every run.
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const canonicalOf = new Map<string, string>();
  // Comparing every venue with every other one is quadratic, and this table only
  // grows as the crawl finds venues. Candidates are bucketed into a grid instead
  // and each venue is compared with its own cell and the eight around it — the
  // cell is wider than the furthest distance `sameVenue` will match over, so no
  // pair that could have matched is skipped.
  const CELL_DEG = 0.2; // ~22km of latitude, against a 12km match ceiling.
  const buckets = new Map<string, VenuePoint[]>();
  const cellKey = (lat: number, lng: number) =>
    `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
  /**
   * How many cells sideways cover the match ceiling at this latitude. A degree of
   * longitude narrows with `cos(lat)` — 0.2° is 22km at the equator but 11km in
   * Reykjavík and 1km in Svalbard — so the sideways reach has to widen as the
   * cells do not. Latitude needs no such correction.
   */
  const xReach = (lat: number) => {
    const kmPerDeg = 111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.02);
    return Math.min(60, Math.max(1, Math.ceil(VENUE_SAME_NAME_METERS / 1000 / (kmPerDeg * CELL_DEG))));
  };
  const neighbours = (lat: number, lng: number): VenuePoint[] => {
    const out: VenuePoint[] = [];
    const y = Math.floor(lat / CELL_DEG);
    const x = Math.floor(lng / CELL_DEG);
    for (let dy = -1; dy <= 1; dy++) {
      // Reach is taken from the widest of the three latitude bands in play, since
      // a neighbour one band poleward has narrower cells than this one.
      const reach = Math.max(xReach(lat), xReach((y + dy) * CELL_DEG), xReach((y + dy + 1) * CELL_DEG));
      for (let dx = -reach; dx <= reach; dx++) {
        const cell = buckets.get(`${y + dy}:${x + dx}`);
        if (cell) out.push(...cell);
      }
    }
    return out;
  };

  for (const v of sorted) {
    const match = v.lat != null && v.lng != null ? bestVenueMatch(v, neighbours(v.lat, v.lng)) : null;
    const resolved = match ? canonicalOf.get(match.id) ?? match.id : v.id;
    canonicalOf.set(v.id, resolved);
    if (resolved === v.id && v.lat != null && v.lng != null) {
      const key = cellKey(v.lat, v.lng);
      const cell = buckets.get(key);
      if (cell) cell.push(v);
      else buckets.set(key, [v]);
    }
  }

  // The loop above hands each cluster to whichever member it reached first, which
  // is the smallest id and takes no account of what the row is called or whether we
  // believe where it says it is. Re-pick the head: every event in the cluster is
  // repointed at it, so its name is what the feed and the venue page show, and its
  // coordinates are the distance and the map pin.
  const clusterMembers = new Map<string, string[]>();
  for (const [id, canonical] of canonicalOf) {
    const group = clusterMembers.get(canonical) ?? [];
    group.push(id);
    clusterMembers.set(canonical, group);
  }
  const nameById = new Map(all.map((v) => [v.id, v.name]));
  const placeholderIds = placeholderPointIds(all);
  for (const [head, ids] of clusterMembers) {
    if (ids.length < 2) continue;
    const better = representative(
      ids,
      (id) => nameById.get(id),
      (id) => placeholderIds.has(id),
    );
    if (better !== head) for (const id of ids) canonicalOf.set(id, better);
  }

  const clustered = [...canonicalOf.entries()].filter(([id, canonical]) => id !== canonical);
  // Migration 0002 pointed every venue at itself, so only a row whose canonical
  // actually moves is worth a write.
  const currentCanonical = new Map(all.map((v) => [v.id, v.canonicalVenueId]));
  await inBatches(
    db,
    [...canonicalOf.entries()]
      .filter(([id, canonical]) => currentCanonical.get(id) !== canonical)
      .map(([id, canonical]) =>
        db.update(venues).set({ canonicalVenueId: canonical }).where(eq(venues.id, id)),
      ),
  );

  // Events follow their venue's canonical row.
  let repointed = 0;
  await inBatches(
    db,
    clustered.map(([id, canonical]) => {
      repointed++;
      return db.update(events).set({ venueId: canonical }).where(eq(events.venueId, id));
    }),
  );

  // Now that same-place shows share a venue id, collapse the duplicates.
  const scanned = await db
    .select({
      id: events.id,
      artistId: events.artistId,
      venueId: events.venueId,
      startsAt: events.startsAt,
      source: events.source,
      sources: events.sources,
      sourceEventId: events.sourceEventId,
      name: events.name,
      endsAt: events.endsAt,
      ticketUrl: events.ticketUrl,
      priceFrom: events.priceFrom,
      soldOut: events.soldOut,
      isFree: events.isFree,
      lineup: events.lineup,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(
      opts.afterArtistId
        ? and(gte(events.startsAt, nowIso()), gte(events.artistId, opts.afterArtistId))
        : gte(events.startsAt, nowIso()),
    )
    .orderBy(events.artistId, events.venueId, events.startsAt)
    // Bounded so one repair can't try to hold the entire future in a single D1
    // response. Duplicates are found within an (artist, venue) run, and the pass
    // is idempotent, so a truncated run is a partial repair, not a wrong one.
    .limit(REPAIR_EVENT_LIMIT);

  // A full page probably cut an artist in half, and half a run can pair a row with
  // the wrong neighbour or miss its twin entirely. Drop the trailing artist and
  // hand it back as the cursor so the next pass sees all of its rows at once.
  const truncated = scanned.length === REPAIR_EVENT_LIMIT;
  const lastArtistId = truncated ? scanned[scanned.length - 1].artistId : null;
  const trimmed = lastArtistId ? scanned.filter((r) => r.artistId !== lastArtistId) : scanned;
  // One artist filling an entire page would otherwise trim to nothing and ask the
  // next pass to start where this one did, forever. `MAX_EVENTS_PER_ARTIST` makes
  // that unreachable, but a repair that silently spins is worse than one that
  // admits it stopped.
  const rows = trimmed.length ? trimmed : scanned;
  const nextArtistId = trimmed.length ? lastArtistId : null;

  const merges: { keep: (typeof rows)[number]; drop: (typeof rows)[number] }[] = [];
  const dropped = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    if (dropped.has(rows[i].id)) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.artistId !== b.artistId || a.venueId !== b.venueId) break; // ordered
      if (dropped.has(b.id)) continue;
      if (hoursApart(a.startsAt, b.startsAt) > SHOW_MATCH_HOURS) break;
      // Keep the older row so anything already linking to it still resolves.
      merges.push({ keep: a, drop: b });
      dropped.add(b.id);
    }
  }

  // A keeper can absorb more than one duplicate (three sources, or a repair after
  // a long gap), so its drops are folded in sequence and written once. One
  // statement per pair would recompute each merge from the untouched keeper and
  // the last write would drop the others' provenance.
  const byKeeper = new Map<string, { keep: (typeof rows)[number]; drops: (typeof rows)[number][] }>();
  for (const { keep, drop } of merges) {
    const entry = byKeeper.get(keep.id) ?? { keep, drops: [] };
    entry.drops.push(drop);
    byKeeper.set(keep.id, entry);
  }

  const asInput = (r: (typeof rows)[number]): EventInput => ({
    source: r.source,
    source_event_id: r.sourceEventId,
    name: r.name,
    starts_at: r.startsAt,
    ends_at: r.endsAt,
    ticket_url: r.ticketUrl,
    price_from: r.priceFrom,
    sold_out: r.soldOut,
    is_free: r.isFree,
    lineup: r.lineup ? (parseGenres(r.lineup) as string[]) : null,
    artist_id: r.artistId,
    venue: null,
  });

  await inBatches(
    db,
    [...byKeeper.values()].flatMap(({ keep, drops }) => {
      let merged = keep as unknown as ExistingShow;
      let set = mergeShow(merged, asInput(drops[0]), keep.venueId);
      for (const drop of drops.slice(1)) {
        merged = { ...merged, ...set };
        set = mergeShow(merged, asInput(drop), keep.venueId);
      }
      return [
        db.update(events).set(set).where(eq(events.id, keep.id)),
        ...drops.map((drop) => db.delete(events).where(eq(events.id, drop.id))),
      ];
    }),
  );

  return {
    venues_clustered: clustered.length,
    events_repointed: repointed,
    shows_merged: merges.length,
    provenance_filled: filled.meta?.changes ?? 0,
    // True when the event scan hit its ceiling; pass `next_artist_id` back to
    // continue from there. Null with `truncated` set means the scan could not
    // advance, which needs a look rather than another run.
    truncated,
    next_artist_id: nextArtistId,
  };
}

/** D1 caps how much one batch can carry; keep each round modest. */
 
/**
 * `db.batch` is one D1 round trip, and one call carries every statement handed to
 * it — an ingest of a few hundred events, or a repair over the whole venue table,
 * would otherwise be a single oversized request. Everything that batches goes
 * through here so the size stays bounded no matter how big the input grows.
 */
async function batchChunked<T>(db: DB, stmts: any[], size = 50): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size);
    if (chunk.length) out.push(...((await db.batch(chunk as [any, ...any[]])) as T[]));
  }
  return out;
}

async function inBatches(db: DB, stmts: any[], size = 50): Promise<void> {
  await batchChunked(db, stmts, size);
}

/**
 * The row that represents a cluster of listings for one physical venue:
 * deterministically the lexicographically smallest id involved.
 *
 * It has to be order-independent. Two venues in the *same* batch are resolved
 * against candidate rows that were read before either write landed, so following
 * "the match's canonical" let each point at the other — Oakland Arena → Yoshi's
 * Oakland → Oakland Arena, observed in production. In a two-cycle neither row is
 * its own canonical, so the cluster never collapses to one id, and two listings of
 * one show keep separate venue ids and never merge: ENHYPEN appeared twice in the
 * San Francisco feed, at two venues sharing one set of coordinates.
 *
 * A minimum can't do that. Whatever order the batch is processed in, and whatever
 * each row currently points at, every member picks the same representative.
 *
 * The representative also *names* the cluster, because every event is repointed at
 * it — so a row carrying a tour title instead of a room ("Final Frontier Tour",
 * sitting on CFG Bank Arena's coordinates) must lose to a row with a real name, or
 * the arena's venue page ends up titled after somebody's tour. Ranking by
 * (has a real name, then id) keeps the property that matters: it is a total order
 * over the cluster, so every member still picks the same winner regardless of the
 * order they are processed in. `nameOf` is optional and an unknown name counts as
 * real, which leaves callers that don't have names behaving exactly as before.
 */
/**
 * Which of these rows sit on a coordinate that is really a source's "somewhere in
 * this city" default. Grouped by exact point, so this only ever costs one pass over
 * the rows the caller already has.
 */
export function placeholderPointIds(
  rows: { id: string; name: string; lat: number | null; lng: number | null }[],
): Set<string> {
  const byPoint = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    const key = pointKey(r.lat, r.lng);
    if (!key) continue;
    const at = byPoint.get(key);
    if (at) at.push(r);
    else byPoint.set(key, [r]);
  }
  const ids = new Set<string>();
  for (const at of byPoint.values()) {
    if (at.length < PLACEHOLDER_POINT_GROUPS) continue;
    if (!isPlaceholderPoint(at.map((r) => r.name))) continue;
    for (const r of at) ids.add(r.id);
  }
  return ids;
}

export function representative(
  ids: (string | null | undefined)[],
  nameOf?: (id: string) => string | null | undefined,
  onPlaceholderPoint?: (id: string) => boolean,
): string {
  const real = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v !== ''))];
  // A tour title costs the venue its name; a placeholder coordinate costs it its
  // position. Both are worth avoiding, and a real name outranks good coordinates
  // because the name is the venue's identity — the offset is at worst a few km
  // inside the right town. Either way this stays a total order over the cluster.
  const rank = (id: string) =>
    (looksLikeTourName(nameOf?.(id) ?? '') ? 2 : 0) + (onPlaceholderPoint?.(id) ? 1 : 0);
  return real.reduce((best, id) => {
    const rankedBest = rank(best);
    const rankedId = rank(id);
    if (rankedId !== rankedBest) return rankedId < rankedBest ? id : best;
    return id < best ? id : best;
  }, real[0]);
}

/**
 * Give every venue in this batch a canonical row: an existing venue at the same
 * place if there is one, otherwise itself.
 */
async function canonicalizeVenues(
  db: DB,
  venueKeys: string[],
  venueRows: Map<string, VenueRow>,
  venueIdByKey: Map<string, string>,
): Promise<Map<string, string>> {
  const canonical = new Map<string, string>();
  if (venueKeys.length === 0) return canonical;

  // Narrow box for the distance-based match, plus a town-wide box for the
  // name-based one (Ticketmaster coordinates can sit kilometres off the door).
  const DEG = 0.006;
  const TOWN_DEG = 0.15;
  const targets = venueKeys
    .map((key) => ({ key, id: venueIdByKey.get(key), row: venueRows.get(key)! }))
    .filter((t): t is { key: string; id: string; row: VenueRow } => Boolean(t.id));

  for (const t of targets) canonical.set(t.key, t.id);
  const locatable = targets.filter((t) => t.row.lat != null && t.row.lng != null);
  if (locatable.length === 0) return canonical;

  const stmts = locatable.map((t) =>
    db
      .select({
        id: venues.id,
        name: venues.name,
        lat: venues.lat,
        lng: venues.lng,
        city: venues.city,
        canonicalVenueId: venues.canonicalVenueId,
      })
      .from(venues)
      .where(
        or(
          and(
            between(venues.lat, t.row.lat! - DEG, t.row.lat! + DEG),
            between(venues.lng, t.row.lng! - DEG, t.row.lng! + DEG),
          ),
          t.row.city
            ? and(
                eq(venues.city, t.row.city),
                between(venues.lat, t.row.lat! - TOWN_DEG, t.row.lat! + TOWN_DEG),
                between(venues.lng, t.row.lng! - TOWN_DEG, t.row.lng! + TOWN_DEG),
              )
            : undefined,
        ),
      )
      .limit(100),
  );
  type Candidate = VenuePoint & { canonicalVenueId: string | null };
  const res = await batchChunked<Candidate[]>(db, stmts);

  // Names for the head-of-cluster choice. Every row this batch can see is in here;
  // a row referenced only as some candidate's `canonical_venue_id` may not be, and
  // an unknown name counts as a real one. That is the safe direction — it can leave
  // a tour title heading a cluster for one pass, which the next pass corrects once
  // the real head shows up as a candidate id, rather than moving a whole cluster on
  // incomplete information.
  const nameById = new Map<string, string>();
  for (const t of targets) nameById.set(t.id, t.row.name);
  for (const list of res) for (const c of list ?? []) nameById.set(c.id, c.name);
  const nameOf = (id: string) => nameById.get(id);

  // Same for coordinates: a row on a town-wide placeholder point shouldn't get to
  // place the cluster. Only the rows this batch can see are considered, so a point
  // that looks fine here can still be caught by the next pass or by the repair,
  // which sees the whole table.
  const seenRows = new Map<string, { id: string; name: string; lat: number | null; lng: number | null }>();
  for (const t of targets) {
    seenRows.set(t.id, { id: t.id, name: t.row.name, lat: t.row.lat, lng: t.row.lng });
  }
  for (const list of res) {
    for (const c of list ?? []) seenRows.set(c.id, { id: c.id, name: c.name, lat: c.lat, lng: c.lng });
  }
  const placeholderIds = placeholderPointIds([...seenRows.values()]);

  const writes = new Map<string, string>();
  locatable.forEach((t, idx) => {
    const target = { id: t.id, name: t.row.name, lat: t.row.lat, lng: t.row.lng, city: t.row.city };
    const candidates = res[idx] ?? [];
    if (!bestVenueMatch(target, candidates)) {
      canonical.set(t.key, t.id);
      return;
    }
    // Everything here that is the same physical room, plus wherever those rows
    // already point.
    const cluster = candidates.filter((c) => c.id !== t.id && sameVenue(target, c));
    const resolved = representative(
      [t.id, ...cluster.map((c) => c.id), ...cluster.map((c) => c.canonicalVenueId)],
      nameOf,
      (id) => placeholderIds.has(id),
    );
    canonical.set(t.key, resolved);

    // Every member points at the representative, including the representative
    // itself — a row whose canonical isn't itself can't be a cluster head, and a
    // second head is how the feed ends up showing one show twice.
    const currentOf = new Map<string, string | null>(
      candidates.map((c) => [c.id, c.canonicalVenueId] as const),
    );
    for (const id of [t.id, ...cluster.map((c) => c.id)]) {
      // Untouched rows already point at themselves (migration 0002 seeded
      // canonical_venue_id = id), so only a change is worth a write.
      if (currentOf.get(id) !== resolved) writes.set(id, resolved);
    }
  });

  await inBatches(
    db,
    [...writes.entries()].map(([id, canonicalVenueId]) =>
      db.update(venues).set({ canonicalVenueId }).where(eq(venues.id, id)),
    ),
  );
  return canonical;
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
    bandsintown_id: artists.bandsintownId,
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

/**
 * Find or create an artist we only know by name — a support act off a lineup,
 * with no Spotify or Ticketmaster id to key on. Matching is on the trimmed,
 * case-folded name: the crawl adds thousands of these, and inserting blind would
 * multiply the duplicate-artist rows we already have rather than expand coverage.
 */
export async function ensureArtistByName(
  db: DB,
  name: string,
): Promise<{ id: string; created: boolean } | null> {
  // Indexed by `artists_name_folded_idx` (migration 0005). That index is
  // deliberately *not* unique: two different bands can share a name, and the
  // table already holds such rows — so this is a best-effort match, and two
  // concurrent callers can still create a duplicate rather than one failing.
  const clean = name.trim();
  if (!clean) return null;
  const existing = await db
    .select({ id: artists.id })
    .from(artists)
    .where(sql`lower(trim(${artists.name})) = ${clean.toLowerCase()}`)
    .limit(1)
    .get();
  if (existing) return { id: existing.id, created: false };

  const id = uuid();
  await db.insert(artists).values({ id, name: clean }).onConflictDoNothing();
  return { id, created: true };
}

/** A name to resolve, plus an image to use if the artist turns out to be new. */
export type ArtistNameInput = { name: string; imageUrl?: string | null };

/** Names per `in (...)` lookup, under D1's 100-bound-parameter ceiling. */
const ARTIST_LOOKUP_CHUNK = 90;

/**
 * `ensureArtistByName` for a whole page of listings at once. A SeatGeek geo page
 * is up to 100 events, and doing this one name at a time would be 200 round trips
 * to D1 inside a single request; this is one read plus one batched write, keyed
 * on the same folded name so it lands on the artist rows the other sources built.
 *
 * Returns a map from folded name to artist id, so callers can look up whichever
 * spelling their payload used.
 */
export async function ensureArtistsByName(
  db: DB,
  inputs: ArtistNameInput[],
): Promise<{ ids: Map<string, string>; created: number }> {
  const wanted = new Map<string, ArtistNameInput>();
  for (const i of inputs) {
    const clean = i.name?.trim();
    if (!clean) continue;
    const folded = clean.toLowerCase();
    // First spelling wins, but a later duplicate may supply the image.
    const prev = wanted.get(folded);
    if (!prev) wanted.set(folded, { name: clean, imageUrl: i.imageUrl ?? null });
    else if (!prev.imageUrl && i.imageUrl) prev.imageUrl = i.imageUrl;
  }
  const ids = new Map<string, string>();
  if (wanted.size === 0) return { ids, created: 0 };

  const folded = [...wanted.keys()];
  // D1 allows 100 bound parameters per query — not SQLite's 999 — and a metro's
  // worth of headliners is a few hundred, so the lookup is chunked under that.
  for (let i = 0; i < folded.length; i += ARTIST_LOOKUP_CHUNK) {
    const rows = await db
      .select({ id: artists.id, name: artists.name })
      .from(artists)
      .where(inArray(sql`lower(trim(${artists.name}))`, folded.slice(i, i + ARTIST_LOOKUP_CHUNK)))
      // Duplicate artist rows exist (two bands can share a name, and older
      // ingestion made some by accident), so pick deterministically: the oldest
      // row is the one the rest of the data already points at.
      .orderBy(artists.createdAt, artists.id);
    for (const r of rows) {
      const key = r.name.trim().toLowerCase();
      if (!ids.has(key)) ids.set(key, r.id);
    }
  }

  const missing = folded.filter((f) => !ids.has(f));
  if (missing.length) {
    await inBatches(
      db,
      missing.map((f) => {
        const i = wanted.get(f)!;
        const id = uuid();
        ids.set(f, id);
        return db
          .insert(artists)
          .values({ id, name: i.name, imageUrl: i.imageUrl ?? null })
          .onConflictDoNothing();
      }),
    );
  }
  return { ids, created: missing.length };
}

/** Note that a client asked about these artists; the crawl checks them sooner. */
export async function touchArtistsRequested(db: DB, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(artists).set({ lastRequestedAt: nowIso() }).where(inArray(artists.id, ids));
}

// --- Crawl queue ------------------------------------------------------------

export type DueArtist = {
  artistId: string;
  source: string;
  sourceKey: string | null;
  state: string;
  failCount: number;
  name: string;
  bandsintownId: string | null;
  bandsintownName: string | null;
  lastRequestedAt: string | null;
};

/** Artists whose next check is in the past, longest-waiting first. */
export async function dueArtistSources(db: DB, source: string, limit: number): Promise<DueArtist[]> {
  return db
    .select({
      artistId: artistSources.artistId,
      source: artistSources.source,
      sourceKey: artistSources.sourceKey,
      state: artistSources.state,
      failCount: artistSources.failCount,
      name: artists.name,
      bandsintownId: artists.bandsintownId,
      bandsintownName: artists.bandsintownName,
      lastRequestedAt: artists.lastRequestedAt,
    })
    .from(artistSources)
    .innerJoin(artists, eq(artists.id, artistSources.artistId))
    .where(
      and(
        eq(artistSources.source, source),
        inArray(artistSources.state, ['active', 'discovered', 'not_found']),
        lte(artistSources.nextCheckAt, nowIso()),
      ),
    )
    .orderBy(artistSources.nextCheckAt)
    .limit(limit);
}

/**
 * Put artists on the queue without disturbing rows already there. `nextCheckAt`
 * defaults to the column default (1970, i.e. due immediately); pass a later time
 * to queue an artist behind the ones we already care about — the queue is drained
 * in `next_check_at` order, so that timestamp *is* the priority.
 */
export async function enqueueArtistSources(
  db: DB,
  rows: {
    artistId: string;
    source: string;
    sourceKey?: string | null;
    state?: string;
    nextCheckAt?: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await inBatches(
    db,
    rows.map((r) =>
      db
        .insert(artistSources)
        .values({
          artistId: r.artistId,
          source: r.source,
          sourceKey: r.sourceKey ?? null,
          state: r.state ?? 'active',
          ...(r.nextCheckAt ? { nextCheckAt: r.nextCheckAt } : {}),
        })
        .onConflictDoNothing(),
    ),
  );
}

/**
 * Push back the next check for artists we have just fetched by hand, but only
 * where that's later than what's already scheduled — a deferral must never pull a
 * due artist forward or delay one we deliberately want soon.
 */
export async function deferArtistSources(
  db: DB,
  artistIds: string[],
  source: string,
  nextCheckAt: string,
): Promise<void> {
  if (artistIds.length === 0) return;
  await db
    .update(artistSources)
    .set({ nextCheckAt })
    .where(
      and(
        inArray(artistSources.artistId, artistIds),
        eq(artistSources.source, source),
        lte(artistSources.nextCheckAt, nextCheckAt),
      ),
    );
}

/** Which of these artists have a show coming up (drives the crawl interval)? */
export async function artistsWithUpcoming(db: DB, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ artistId: events.artistId })
    .from(events)
    .where(and(inArray(events.artistId, ids), gte(events.startsAt, nowIso())));
  return new Set(rows.map((r) => r.artistId));
}

export type CrawlOutcome = {
  artistId: string;
  source: string;
  /** The key that worked, when the lookup succeeded with a different one. */
  sourceKey?: string | null;
  state: string;
  ok: boolean;
  failCount: number;
  nextCheckAt: string;
};

/** Record the result of one crawl attempt and when to try again. */
export async function recordCrawlOutcomes(db: DB, outcomes: CrawlOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;
  const now = nowIso();
  await inBatches(
    db,
    outcomes.map((o) =>
      db
        .update(artistSources)
        .set({
          state: o.state,
          failCount: o.failCount,
          lastCheckedAt: now,
          nextCheckAt: o.nextCheckAt,
          ...(o.ok ? { lastOkAt: now } : {}),
          ...(o.sourceKey !== undefined ? { sourceKey: o.sourceKey } : {}),
        })
        .where(and(eq(artistSources.artistId, o.artistId), eq(artistSources.source, o.source))),
    ),
  );
}

// --- Ingest runs ------------------------------------------------------------

export type RunTotals = { scanned?: number; inserted?: number; failed?: number; note?: string | null };

/**
 * Record an ingestion pass. Every source no-ops politely when misconfigured, so
 * "nothing came back" and "nothing ran" look identical from the event table —
 * this is the difference between them.
 *
 * Never throws: the log going missing must not take an ingest down with it.
 */
export async function startRun(db: DB, source: string, kind: string): Promise<string | null> {
  const id = uuid();
  try {
    await db.insert(ingestRuns).values({ id, source, kind, startedAt: nowIso() });
    return id;
  } catch (err) {
    console.error('startRun failed:', err);
    return null;
  }
}

export async function finishRun(db: DB, id: string | null, totals: RunTotals): Promise<void> {
  if (!id) return;
  try {
    await db
      .update(ingestRuns)
      .set({
        finishedAt: nowIso(),
        scanned: totals.scanned ?? 0,
        inserted: totals.inserted ?? 0,
        failed: totals.failed ?? 0,
        note: totals.note ?? null,
      })
      .where(eq(ingestRuns.id, id));
  } catch (err) {
    console.error('finishRun failed:', err);
  }
}

/**
 * Per-source ingest health over a window: how many runs, what they produced, and
 * when each source last actually inserted something. A source whose runs succeed
 * while inserting nothing is the failure this exists to surface.
 */
export async function ingestStats(db: DB, days = 7) {
  const since = isoInDays(-days);
  const runs = await db
    .select({
      source: ingestRuns.source,
      kind: ingestRuns.kind,
      runs: sql<number>`count(*)`,
      scanned: sql<number>`sum(${ingestRuns.scanned})`,
      inserted: sql<number>`sum(${ingestRuns.inserted})`,
      failed: sql<number>`sum(${ingestRuns.failed})`,
      unfinished: sql<number>`sum(case when ${ingestRuns.finishedAt} is null then 1 else 0 end)`,
      last_run_at: sql<string>`max(${ingestRuns.startedAt})`,
      last_insert_at: sql<string | null>`max(case when ${ingestRuns.inserted} > 0 then ${ingestRuns.startedAt} end)`,
    })
    .from(ingestRuns)
    .where(gte(ingestRuns.startedAt, since))
    .groupBy(ingestRuns.source, ingestRuns.kind)
    .orderBy(sql`max(${ingestRuns.startedAt}) desc`);

  const notes = await db
    .select({ source: ingestRuns.source, note: ingestRuns.note, at: ingestRuns.startedAt })
    .from(ingestRuns)
    .where(and(gte(ingestRuns.startedAt, since), sql`${ingestRuns.note} is not null`))
    .orderBy(sql`${ingestRuns.startedAt} desc`)
    .limit(10);

  // Coverage by town and source: where a source stops contributing, it shows up
  // here as a column of zeroes long before anyone notices a thin feed.
  const coverage = await db
    .select({
      city: venues.city,
      region: venues.region,
      source: events.source,
      upcoming: sql<number>`count(*)`,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(gte(events.startsAt, nowIso()), lte(events.startsAt, isoInDays(90))))
    .groupBy(venues.city, venues.region, events.source)
    .orderBy(sql`count(*) desc`)
    .limit(40);

  return { window_days: days, runs, recent_notes: notes, coverage };
}

/** Queue depth by state, plus how many are due — the numbers /health reports. */
export async function crawlQueueStats(db: DB, source: string) {
  const rows = await db
    .select({
      state: artistSources.state,
      total: sql<number>`count(*)`,
      due: sql<number>`sum(case when ${artistSources.nextCheckAt} <= ${nowIso()} then 1 else 0 end)`,
    })
    .from(artistSources)
    .where(eq(artistSources.source, source))
    .groupBy(artistSources.state);
  return rows;
}
