import { and, between, eq, gte, lte, or, sql } from 'drizzle-orm';

import { getDb, type DB } from './db';
import {
  bestVenueMatch,
  hoursApart,
  mergeField,
  parseSources,
  SHOW_MATCH_HOURS,
  type VenuePoint,
} from './dedupe';
import type { Env } from './env';
import { artists, events, venues } from './schema';

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
  const updates: { id: string; row: ExistingShow; input: EventInput; venueId: string | null }[] = [];
  inputs.forEach((i, idx) => {
    const existing = found[idx];
    if (existing) updates.push({ id: existing.id, row: existing, input: i, venueId: venueFor(i) });
    else
      inserts.push({
        id: uuid(),
        artistId: i.artist_id,
        venueId: venueFor(i),
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
      });
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
    const res = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    for (const rows of res) if (rows[0]?.id) newIds.push(rows[0].id);
  }

  if (updates.length) {
    const stmts = updates.map(({ id, row, input, venueId }) =>
      db.update(events).set(mergeShow(row, input, venueId)).where(eq(events.id, id)),
    );
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  return newIds;
}

type ExistingShow = {
  id: string;
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
          eq(events.venueId, k.venueId),
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

  const res = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  return res.map((rows) => (rows[0] as ExistingShow | undefined) ?? null);
}

/**
 * Cluster the whole venue table, repoint events at canonical venues, and merge
 * shows that were stored twice before ingestion knew how to match them. Safe to
 * re-run; returns what it changed.
 */
export async function repairDuplicates(db: DB): Promise<{
  venues_clustered: number;
  events_repointed: number;
  shows_merged: number;
  provenance_filled: number;
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
    .select({ id: venues.id, name: venues.name, lat: venues.lat, lng: venues.lng, city: venues.city })
    .from(venues);

  // Deterministic order (by id) so the same row wins the cluster on every run.
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const canonicalOf = new Map<string, string>();
  const accepted: VenuePoint[] = [];
  for (const v of sorted) {
    const match = bestVenueMatch(v, accepted);
    const resolved = match ? canonicalOf.get(match.id) ?? match.id : v.id;
    canonicalOf.set(v.id, resolved);
    if (resolved === v.id) accepted.push(v);
  }

  const clustered = [...canonicalOf.entries()].filter(([id, canonical]) => id !== canonical);
  await inBatches(
    db,
    [...canonicalOf.entries()].map(([id, canonical]) =>
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
  const rows = await db
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
    .where(gte(events.startsAt, nowIso()))
    .orderBy(events.artistId, events.venueId, events.startsAt);

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

  await inBatches(
    db,
    merges.flatMap(({ keep, drop }) => [
      db
        .update(events)
        .set(
          mergeShow(
            keep as unknown as ExistingShow,
            {
              source: drop.source,
              source_event_id: drop.sourceEventId,
              name: drop.name,
              starts_at: drop.startsAt,
              ends_at: drop.endsAt,
              ticket_url: drop.ticketUrl,
              price_from: drop.priceFrom,
              sold_out: drop.soldOut,
              is_free: drop.isFree,
              lineup: drop.lineup ? (JSON.parse(drop.lineup) as string[]) : null,
              artist_id: drop.artistId,
              venue: null,
            },
            keep.venueId,
          ),
        )
        .where(eq(events.id, keep.id)),
      db.delete(events).where(eq(events.id, drop.id)),
    ]),
  );

  return {
    venues_clustered: clustered.length,
    events_repointed: repointed,
    shows_merged: merges.length,
    provenance_filled: filled.meta?.changes ?? 0,
  };
}

/** D1 caps how much one batch can carry; keep each round modest. */
 
async function inBatches(db: DB, stmts: any[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size);
     
    if (chunk.length) await db.batch(chunk as [any, ...any[]]);
  }
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
  const res = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);

  const writes: { id: string; canonicalVenueId: string }[] = [];
  locatable.forEach((t, idx) => {
    const target = { id: t.id, name: t.row.name, lat: t.row.lat, lng: t.row.lng, city: t.row.city };
    const match = bestVenueMatch(target, res[idx] as VenuePoint[]);
    // Follow the match's own canonical so a third listing of the same room joins
    // the same cluster instead of starting a chain.
    const resolved = match
      ? (res[idx].find((c) => c.id === match.id)?.canonicalVenueId ?? match.id)
      : t.id;
    canonical.set(t.key, resolved);
    writes.push({ id: t.id, canonicalVenueId: resolved });
  });

  if (writes.length) {
    const updates = writes.map((w) =>
      db.update(venues).set({ canonicalVenueId: w.canonicalVenueId }).where(eq(venues.id, w.id)),
    );
    await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]]);
  }
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
