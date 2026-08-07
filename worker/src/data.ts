import { and, asc, between, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { getDb, type DB } from './db';
import { zoneFor } from './timezone';
import {
  agreesWithCluster,
  bestVenueMatch,
  hoursApart,
  isPlaceholderPoint,
  looksLikeEventTitle,
  PLACEHOLDER_POINT_GROUPS,
  pointKey,
  sameVenue,
  mergeField,
  parseSources,
  sameShow,
  SHOW_MATCH_HOURS,
  TBD_SHOW_MATCH_HOURS,
  VENUE_SAME_NAME_METERS,
  type VenuePoint,
} from './dedupe';
import type { CoreEnv } from './env';
import { artists, artistSources, events, ingestRuns, venues } from './schema';

// --- helpers ----------------------------------------------------------------

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
export const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 19) + 'Z';
export const isoAt = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** How long past its noon placeholder a time-unknown show stays "upcoming":
 *  until midnight at the venue, which is noon plus twelve hours. */
export const TBD_GRACE_MS = 12 * 3_600_000;

/**
 * "Hasn't happened yet", aware of unannounced set times. A `time_unknown` row's
 * `starts_at` is noon at the venue — treating that as the moment the show ends
 * would retire the listing at lunchtime on the day itself, so those rows stay
 * upcoming until midnight venue-local. Shaped as a range from the earlier bound
 * with a residual check, rather than a `case`, so `events_starts_at_idx` still
 * gets a range scan.
 */
export function stillUpcoming(now = nowIso()): SQL {
  const doorsClosed = isoAt(new Date(now).getTime() - TBD_GRACE_MS);
  return and(
    gte(events.startsAt, doorsClosed),
    or(eq(events.timeUnknown, true), gte(events.startsAt, now)),
  )!;
}

/** Sources send both `null` and `''` for "no region"; the UI only handles one. */
const blankToNull = (v: string | null) => (v && v.trim() !== '' ? v : null);

/**
 * The venue name as the app is allowed to print it, or null when the row is named
 * after an event rather than a place.
 *
 * Sources file the tour title, the bill, sometimes the whole announcement in the
 * venue column, and the coordinates that come with it are real — so the row is
 * worth keeping and its *name* is not. Measured on production: 1,054 of 7,340
 * venue rows, and 283 of those are cluster heads with upcoming shows, which is the
 * number that matters because a head is what gets displayed.
 *
 * Nulled rather than dropped or corrected. Every screen already renders the name
 * through `formatVenue(name, city, region)`, which falls back to the town, so a
 * null degrades to "Austin, TX" — true, useful, and not a claim about a room that
 * doesn't exist. There is nowhere better to get the real name from: 240 of those
 * 283 are alone in their cluster, meaning no other source filed a row within 50m
 * of it, so there is no correct name in the table to promote.
 */
export const publishedVenueName = (name: string | null): string | null => {
  const n = blankToNull(name);
  return n && looksLikeEventTitle(n) ? null : n;
};

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
  /** The source mapping's verdict that `name` is a billing, not a room — made
   *  with context (the listing's own city and artist) that no string rule
   *  downstream can see. See `dashBillingVenueName`. */
  junk_name?: boolean;
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
  /** Set time not announced: `starts_at` is noon at the venue, not a clock time. */
  time_unknown?: boolean;
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

/**
 * Correlated going/interested counts for an event row — the social proof a
 * card wears. Counted live off event_rsvps' primary key (plus its event_id
 * index), never denormalised: same call as review likes, and at this volume
 * count(*) is the truth for free. Deliberately absent from past-show reads —
 * a count of people who *were going* reads as stale plans, and the log and
 * reviews are the record of a night that happened.
 */
const rsvpCounts = {
  rsvp_going: sql<number>`(select count(*) from event_rsvps where event_id = ${events.id} and status = 'going')`,
  rsvp_interested: sql<number>`(select count(*) from event_rsvps where event_id = ${events.id} and status = 'interested')`,
};

/**
 * How much a show matters, coarsely — the ranked feed's ORDER BY.
 *
 * Weights were chosen by measuring production SF (45 days, 2026-08-03): under
 * this score the top of the feed reads Toto, Tori Amos, J. Cole, Noah Kahan,
 * David Byrne, Childish Gambino; under plain date order it read "Official
 * Dailey & Vincent" and "Open Mic Night". The bands are deliberately coarse
 * integers — 13 shows scored 6–7, 175 scored 5 (the Ticketmaster tier), 187
 * scored ≤1 (the id-less long tail) — so within a band the order stays
 * soonest-first and a headline show four months out doesn't bury tonight.
 *
 * Signals, strongest first, all already in the database: a Ticketmaster id
 * (somebody sells real tickets through the majors), a Spotify id (enrichment
 * ran, which today means somebody cared enough to open the page), an image
 * and genres (realness proxies that cost nothing), Deezer fans in decade
 * bands (the artist-scale term — the measured spread runs Kesha 4.2M / IVE
 * 265k / Aldous Harding 22.5k / club acts in the hundreds, so 200k/20k/2k
 * splits arena, theatre and known-club tiers; migration 0020, filled by the
 * crawl), and the RSVP counts — zero almost everywhere today, but it's the
 * term that lets actual people outvote metadata as the social layer fills in.
 *
 * Venue-scale proxies were measured against production SF and rejected:
 * upcoming-show count ranks The Independent (53) above Oakland Arena (40),
 * and average price ranks The Chapel ($120) above the arena ($86) on sparse,
 * resale-noisy coverage. The headliner's own draw is the signal that works.
 */
const notability = sql<number>`
  (case when ${artists.ticketmasterId} is not null then 3 else 0 end)
  + (case when ${artists.spotifyId} is not null then 2 else 0 end)
  + (case when ${artists.imageUrl} is not null then 1 else 0 end)
  + (case when ${artists.genres} is not null and ${artists.genres} != '[]' then 1 else 0 end)
  + (case when ${artists.deezerFans} >= 200000 then 3
          when ${artists.deezerFans} >= 20000 then 2
          when ${artists.deezerFans} >= 2000 then 1
          else 0 end)
  + min((select count(*) * 2 from event_rsvps where event_id = ${events.id} and status = 'going')
      + (select count(*) from event_rsvps where event_id = ${events.id} and status = 'interested'), 6)`;

export type NearbySort = 'featured' | 'date';

/**
 * The radius itself, in SQL, so ORDER BY and LIMIT apply to the circle and not
 * the bounding box. The old shape — box, limit, then a haversine filter in
 * JS — silently starved wide feeds: the box's corners reach radius×1.4, and
 * under `featured` a notable show 130 miles out (in the box, outside the
 * circle) took a seat in the 400-row page from an in-radius show and was then
 * thrown away. Measured on production New York before the fix: 398 items at
 * 10 miles, 380 at 25, 391 at 100 — a wider ask returning *less*.
 * Equirectangular rather than haversine because SQLite has no trig; at these
 * radii the divergence is well under a mile.
 *
 * `cosLat` arrives clamped (≥0.01) so the callers' bounding-box division can't
 * blow up. The clamp only diverges from the real cosine above 89.4° latitude —
 * inside forty miles of a pole, where nothing has ever been on sale — so both
 * the box and this predicate use the same clamped value and stay consistent.
 */
const withinMilesSql = (
  latCol: SQLiteColumn | SQL,
  lngCol: SQLiteColumn | SQL,
  lat: number,
  lng: number,
  cosLat: number,
  radiusMiles: number,
) =>
  sql`((${latCol} - ${lat}) * 69.0) * ((${latCol} - ${lat}) * 69.0)
    + ((${lngCol} - ${lng}) * ${69 * cosLat}) * ((${lngCol} - ${lng}) * ${69 * cosLat})
    <= ${radiusMiles * radiusMiles}`;

export async function nearbyEvents(
  db: DB,
  lat: number,
  lng: number,
  radiusMiles: number,
  limit = 400,
  offset = 0,
  sort: NearbySort = 'date',
) {
  const latDelta = radiusMiles / 69;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusMiles / (69 * cosLat);

  // Bounding-box prefilter on the indexed lat/lng; the circle itself is
  // `withinMilesSql`, inside the query where LIMIT can see it.
  const canon = alias(venues, 'canon');
  const where = and(
    stillUpcoming(),
    lte(events.startsAt, isoInDays(120)),
    between(venues.lat, lat - latDelta, lat + latDelta),
    between(venues.lng, lng - lngDelta, lng + lngDelta),
    // On the attached row, like the box: that is the indexed one.
    withinMilesSql(venues.lat, venues.lng, lat, lng, cosLat, radiusMiles),
    // And on the cluster head, which supplies the coordinates the card
    // displays: a head with junk coordinates otherwise puts "319 mi" on a
    // 100-mile feed (production's Archer Music Hall cluster was headed by
    // a Bandsintown row claiming Allentown but placed in Pittsburgh).
    // Heads without coordinates stay in, like everywhere else.
    or(
      sql`${canon.lat} is null or ${canon.lng} is null`,
      withinMilesSql(canon.lat, canon.lng, lat, lng, cosLat, radiusMiles),
    ),
  );
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      artist_id: artists.id,
      artist_name: artists.name,
      artist_image_url: artists.imageUrl,
      artist_spotify_id: artists.spotifyId,
      artist_genres: artists.genres,
      ...rsvpCounts,
      // Everything the client sees comes from the canonical row, so a card, the
      // venue page it opens and /venues/nearby agree on which room this is and
      // where it is. The bounding box below still filters on the row the event is
      // actually attached to, because that is the indexed one; the two only differ
      // for events written before a cluster was re-headed, and for those the
      // canonical position is the one we believe.
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
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(where)
    // Featured: notable first, soonest within a band. The id tiebreak is what
    // makes offset paging safe — equal score and equal start time is common
    // (same-night club shows), and unspecified order across pages skips and
    // duplicates rows, the same failure the feed cursor once had.
    .orderBy(
      ...(sort === 'featured'
        ? [desc(notability), asc(events.startsAt), asc(events.id)]
        : [asc(events.startsAt), asc(events.id)]),
    )
    .limit(limit)
    .offset(offset);

  // How many shows the radius actually holds — the page is capped at `limit`,
  // and a headline reading the page length claims "400 shows" at every radius
  // wide enough to fill it. Same WHERE, no artists join (artist_id is a NOT
  // NULL cascade FK, so the join never drops rows), no ordering to pay for.
  const totalRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(where)
    .get();
  const total = totalRow?.n ?? 0;

  // No post-filter here: the SQL predicate already decided membership, and a
  // second pass on the canonical row's haversine is exactly what used to
  // return short pages. A show whose cluster head sits a hair past the line
  // may display as 100.3 mi in a 100 mi feed; that's honest, not a leak.
  const items = rows.map((r) => ({
    ...r,
    artist_genres: parseGenres(r.artist_genres),
    venue_name: publishedVenueName(r.venue_name),
    // The zone the show actually happens in: a 23:00 gig in London is not a
    // 3pm gig, whatever the reader's own clock says.
    venue_timezone: zoneFor(r.venue_region, r.venue_country),
    distance_miles:
      r.venue_lat != null && r.venue_lng != null
        ? haversineMiles(lat, lng, r.venue_lat, r.venue_lng)
        : null,
  }));

  const nextCursor = rows.length === limit ? offset + limit : null;
  return { items, nextCursor, total };
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
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusMiles / (69 * cosLat);
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
        stillUpcoming(),
        lte(events.startsAt, isoInDays(120)),
        // Boxed on the row the event points at, not on the cluster head: `canon` is
        // only reachable through a coalesce, so filtering there gives up
        // venues_latlng_idx and scans every upcoming show. The head still supplies
        // the name and the coordinates that get displayed.
        between(venues.lat, lat - latDelta, lat + latDelta),
        between(venues.lng, lng - lngDelta, lng + lngDelta),
        withinMilesSql(venues.lat, venues.lng, lat, lng, cosLat, radiusMiles),
        // The head's coordinates are what get displayed and sorted on — same
        // junk-head guard as the events feed.
        or(
          sql`${canon.lat} is null or ${canon.lng} is null`,
          withinMilesSql(canon.lat, canon.lng, lat, lng, cosLat, radiusMiles),
        ),
        sql`${canon.name} is not null and trim(${canon.name}) <> ''`,
      ),
    )
    .groupBy(canon.id)
    // Tie-broken by id: without it the rows at the count boundary swap places
    // between identical requests and the tail of the rail moves on every refresh.
    .orderBy(sql`count(distinct ${events.id}) desc`, canon.id)
    .limit(NEARBY_VENUE_SCAN);

  return rows
    // A row named after a tour is not a room. Nulling the name is right on an event
    // card, where the town still tells you where to go, but a *venue* is the whole
    // subject here — it's the thing being counted, followed and opened — so an
    // unnameable one is dropped rather than listed as "Austin, TX · 3 shows".
    .filter((r) => !looksLikeEventTitle(r.name))
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
    // Membership was decided in SQL (`withinMilesSql`); no second pass on the
    // canonical row's haversine, which used to shave rows off the corners.
    // A venue we can't place sorts after the ones we can, not at zero miles.
    .sort(
      (a, b) =>
        b.upcoming - a.upcoming ||
        (a.distance_miles ?? Number.MAX_VALUE) - (b.distance_miles ?? Number.MAX_VALUE),
    )
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
    time_unknown: boolean;
    ticket_url: string | null;
    price_from: number | null;
    artist_id: string;
    artist_name: string;
    artist_image_url: string | null;
    artist_spotify_id: string | null;
    artist_genres: string | null;
    rsvp_going: number;
    rsvp_interested: number;
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
      time_unknown: events.timeUnknown,
        ticket_url: events.ticketUrl,
        price_from: events.priceFrom,
        artist_id: artists.id,
        artist_name: artists.name,
        artist_image_url: artists.imageUrl,
        artist_spotify_id: artists.spotifyId,
        artist_genres: artists.genres,
        ...rsvpCounts,
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
          stillUpcoming(),
        ),
      );
    rows.push(...chunk);
  }

  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return rows.map((r) => ({
    ...r,
    artist_genres: parseGenres(r.artist_genres),
    venue_name: publishedVenueName(r.venue_name),
    venue_timezone: zoneFor(r.venue_region, r.venue_country),
    distance_miles: null as number | null,
  }));
}

/** Ids accepted per list by `followingEvents` (the on-device follow lists). */
export const FOLLOWING_IDS_MAX = 100;
/** Shows returned per request; a year of one person's follows fits well inside. */
const FOLLOWING_EVENT_LIMIT = 300;
/** Slack on the bounding box, in miles: the box is drawn around the row an event
 *  points at, while the gate measures from that row's cluster head. */
const VENUE_BOX_PAD_MILES = 25;
/** How far ahead the Following screen looks — further than the location feed,
 *  because a followed artist announcing a date in five months is the whole point. */
const FOLLOWING_HORIZON_DAYS = 365;

/**
 * Every venue id in the same room as any of `ids`, for heads and member ids alike.
 *
 * Two hops, exactly like `clusterVenueIds`: a member id only knows its head, so
 * asking one question gets you `{the id, its head}` and none of its siblings. The
 * device stores whichever id was canonical when the user followed, and the repair
 * pass is allowed to pick a different head later, so the stored id is regularly a
 * member rather than the head.
 *
 * Each statement binds one chunk, and only one: `or(inArray(a), inArray(b))` over
 * the same chunk binds it twice, which puts 90 ids over D1's 100-parameter ceiling.
 */
export async function clusterMemberIds(db: DB, ids: string[]): Promise<string[]> {
  const out = new Set<string>(ids);
  const heads = new Set<string>();
  // Hop one: by primary key.
  for (let i = 0; i < ids.length; i += EVENT_LOOKUP_CHUNK) {
    const rows = await db
      .select({ head: sql<string>`coalesce(${venues.canonicalVenueId}, ${venues.id})` })
      .from(venues)
      .where(inArray(venues.id, ids.slice(i, i + EVENT_LOOKUP_CHUNK)));
    for (const r of rows) if (r.head) heads.add(r.head);
  }
  for (const h of heads) out.add(h);
  // Hop two: by venues_canonical_idx.
  const headIds = [...heads];
  for (let i = 0; i < headIds.length; i += EVENT_LOOKUP_CHUNK) {
    const rows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(inArray(venues.canonicalVenueId, headIds.slice(i, i + EVENT_LOOKUP_CHUNK)));
    for (const r of rows) out.add(r.id);
  }
  return [...out];
}

/**
 * Upcoming shows for the artists and venues someone follows.
 *
 * Deliberately *not* a filter over the location feed. That feed is one bounded page
 * of whatever is nearest in time inside a radius — around San Francisco it hit its
 * 400-row ceiling at nine weeks out, so a followed artist playing in October simply
 * wasn't in it and the screen said nobody you follow is playing. A follow is a
 * standing question about a specific artist or room, so it gets asked as one.
 *
 * `lat`/`lng` fill in `distance_miles`, and with `radiusMiles` they gate the list:
 * the point of the screen is shows you could actually get to. What is *not* gated
 * is time — the whole horizon inside the radius comes back, which is the half the
 * location feed got wrong.
 */
export async function followingEvents(
  db: DB,
  opts: {
    artistIds?: string[];
    spotifyIds?: string[];
    venueIds?: string[];
    lat?: number | null;
    lng?: number | null;
    radiusMiles?: number | null;
  },
) {
  const clean = (ids: string[] | undefined) =>
    [...new Set((ids ?? []).filter((v) => typeof v === 'string' && v !== ''))].slice(
      0,
      FOLLOWING_IDS_MAX,
    );
  const artistIds = clean(opts.artistIds);
  // An artist followed from search has no catalog id yet, only a Spotify one, and
  // nothing backfills it — so asking by catalog id alone misses those follows
  // entirely. spotify_id is unique, so this arm is indexed too.
  const spotifyIds = clean(opts.spotifyIds);
  const venueIds = clean(opts.venueIds);
  if (artistIds.length === 0 && spotifyIds.length === 0 && venueIds.length === 0) return [];

  const canon = alias(venues, 'canon');
  const horizon = isoInDays(FOLLOWING_HORIZON_DAYS);
  const now = nowIso();
  const hasPoint = typeof opts.lat === 'number' && typeof opts.lng === 'number';
  const radiusMiles = hasPoint && opts.radiusMiles ? opts.radiusMiles : null;
  // Boxed on venues.lat/lng, the indexed pair, and padded because the gate itself
  // measures from the cluster head — which can sit a few miles from the row an
  // event points at. The haversine below is what actually decides.
  const box = (() => {
    if (radiusMiles === null) return undefined;
    const pad = radiusMiles + VENUE_BOX_PAD_MILES;
    const latDelta = pad / 69;
    const lngDelta = pad / (69 * Math.max(Math.cos((opts.lat! * Math.PI) / 180), 0.01));
    return and(
      between(venues.lat, opts.lat! - latDelta, opts.lat! + latDelta),
      between(venues.lng, opts.lng! - lngDelta, opts.lng! + lngDelta),
    );
  })();
  const columns = {
    event_id: events.id,
    event_name: events.name,
    starts_at: events.startsAt,
    time_unknown: events.timeUnknown,
    ticket_url: events.ticketUrl,
    price_from: events.priceFrom,
    artist_id: artists.id,
    artist_name: artists.name,
    artist_image_url: artists.imageUrl,
    artist_spotify_id: artists.spotifyId,
    artist_genres: artists.genres,
    ...rsvpCounts,
    venue_id: canon.id,
    venue_name: canon.name,
    venue_city: canon.city,
    venue_region: canon.region,
    venue_country: canon.country,
    venue_lat: canon.lat,
    venue_lng: canon.lng,
  };
  const from = (where: SQL | undefined) =>
    db
      .select(columns)
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .leftJoin(venues, eq(venues.id, events.venueId))
      .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(and(gte(events.startsAt, now), lte(events.startsAt, horizon), box, where))
      .orderBy(events.startsAt)
      .limit(FOLLOWING_EVENT_LIMIT);

  type Row = Awaited<ReturnType<typeof from>>[number];
  // Which half of the question each row answers. The screen shows artists and
  // venues on separate tabs, and it can't work this out for itself: rows come back
  // under the *canonical* venue id, which is not necessarily the id the device
  // stored, so re-deriving membership on the client drops correct shows.
  const byId = new Map<string, Row & { matched_artist: boolean; matched_venue: boolean }>();
  const collect = (rows: Row[], side: 'matched_artist' | 'matched_venue') => {
    for (const r of rows) {
      const existing = byId.get(r.event_id);
      // A show by a followed artist at a followed venue belongs to both tabs.
      if (existing) existing[side] = true;
      else byId.set(r.event_id, { ...r, matched_artist: false, matched_venue: false, [side]: true });
    }
  };

  for (let i = 0; i < artistIds.length; i += EVENT_LOOKUP_CHUNK) {
    collect(
      await from(inArray(events.artistId, artistIds.slice(i, i + EVENT_LOOKUP_CHUNK))),
      'matched_artist',
    );
  }
  for (let i = 0; i < spotifyIds.length; i += EVENT_LOOKUP_CHUNK) {
    collect(
      await from(inArray(artists.spotifyId, spotifyIds.slice(i, i + EVENT_LOOKUP_CHUNK))),
      'matched_artist',
    );
  }
  // A followed venue is a *room*, so every source's row for it counts.
  const memberIds = venueIds.length ? await clusterMemberIds(db, venueIds) : [];
  for (let i = 0; i < memberIds.length; i += EVENT_LOOKUP_CHUNK) {
    collect(
      await from(inArray(events.venueId, memberIds.slice(i, i + EVENT_LOOKUP_CHUNK))),
      'matched_venue',
    );
  }

  return [...byId.values()]
    .map((r) => ({
      ...r,
      artist_genres: parseGenres(r.artist_genres),
      venue_timezone: zoneFor(r.venue_region, r.venue_country),
      distance_miles:
        hasPoint && r.venue_lat != null && r.venue_lng != null
          ? haversineMiles(opts.lat!, opts.lng!, r.venue_lat, r.venue_lng)
          : null,
    }))
    // Measured off the head's coordinates, the same number the card shows, so the
    // gate can never contradict the label next to it. A show we can't place is out
    // when a radius is in force: "50 mi" has to mean it, and guessing on a venue
    // with no coordinates is how a London date turns up in a San Francisco list.
    .filter((r) => radiusMiles === null || (r.distance_miles !== null && r.distance_miles <= radiusMiles))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, FOLLOWING_EVENT_LIMIT);
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

/**
 * An artist's shows that have already happened, newest first.
 *
 * The mirror of `artistEvents`, and the read side of the history backfill. Newest
 * first because this list is scanned to answer "which of these was I at", and the
 * gig somebody is trying to remember is far more likely to be recent than to be from
 * 2015.
 *
 * Capped rather than paginated for now: with a measured mean of ~137 past shows per
 * artist, 300 covers all but the hardest-touring bands, and a picker nobody can reach
 * the end of is a different problem from a picker that truncates.
 */
export async function artistPastEvents(db: DB, id: string, limit = 300) {
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      venue_id: venues.id,
      venue_name: venues.name,
      venue_city: venues.city,
      venue_region: venues.region,
      venue_country: venues.country,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    // The mirror of `stillUpcoming`: a time-unknown show isn't past until
    // midnight at the venue, so it joins the log picker a day late rather
    // than at lunchtime on the day itself.
    .where(
      and(
        eq(events.artistId, id),
        lt(events.startsAt, nowIso()),
        or(eq(events.timeUnknown, false), lt(events.startsAt, isoAt(Date.now() - TBD_GRACE_MS))),
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    venue_name: publishedVenueName(r.venue_name),
    venue_timezone: zoneFor(r.venue_region, r.venue_country),
  }));
}

export async function artistEvents(db: DB, id: string) {
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      ...rsvpCounts,
      venue_id: venues.id,
      venue_name: venues.name,
      venue_city: venues.city,
      venue_region: venues.region,
      venue_country: venues.country,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.artistId, id), stillUpcoming()))
    .orderBy(events.startsAt);
  return rows.map((r) => ({
    ...r,
    venue_name: publishedVenueName(r.venue_name),
    venue_timezone: zoneFor(r.venue_region, r.venue_country),
  }));
}

export async function eventById(db: DB, id: string) {
  const canon = alias(venues, 'canon');
  const r = await db
    .select({
      id: events.id,
      name: events.name,
      starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      source: events.source,
      ...rsvpCounts,
      a_id: artists.id,
      a_name: artists.name,
      a_spotify: artists.spotifyId,
      a_image: artists.imageUrl,
      a_genres: artists.genres,
      // Canonical, like the feed and /venues/:id: a card that says "The Warfield"
      // must not open a page titled after somebody's tour, and the save button on
      // this screen stores whatever id it is handed.
      v_id: canon.id,
      v_name: canon.name,
      v_city: canon.city,
      v_region: canon.region,
      v_country: canon.country,
      v_lat: canon.lat,
      v_lng: canon.lng,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(eq(events.id, id))
    .get();
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    starts_at: r.starts_at,
    time_unknown: r.time_unknown,
    ticket_url: r.ticket_url,
    price_from: r.price_from,
    source: r.source,
    rsvp_going: r.rsvp_going,
    rsvp_interested: r.rsvp_interested,
    artist: {
      id: r.a_id,
      name: r.a_name,
      spotify_id: r.a_spotify,
      image_url: r.a_image,
      genres: parseGenres(r.a_genres),
    },
    // Keyed on the id, not the name: a room we can place but can't name still has
    // a town, a map pin and a page, and dropping the whole block over the name
    // would take those with it.
    venue: r.v_id
      ? {
          id: r.v_id,
          name: publishedVenueName(r.v_name),
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
        stillUpcoming(),
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
  return r
    ? { ...r, name: publishedVenueName(r.name), timezone: zoneFor(r.region, r.country) }
    : null;
}

/**
 * What we can say about a room from its own calendar.
 *
 * This is the half of a venue page that works for *every* venue, which is why it
 * exists: Wikipedia covers arenas and named theatres and knows nothing about the
 * club tier, so anything that depends on an article can only ever be enrichment on
 * top of this. Every number here comes from rows we already hold.
 *
 * `busiest_month` is counted in UTC rather than the venue's zone. A show at 00:30
 * local on the 1st can therefore land in the previous month, which at worst moves
 * one show between two adjacent counts — and doing it properly means grouping by a
 * zone SQLite doesn't know, per row, to change a headline that says "August".
 */
export async function venueStats(db: DB, id: string) {
  const clusterIds = (await clusterVenueIds(db, id)).slice(0, EVENT_LOOKUP_CHUNK);
  if (clusterIds.length === 0) return null;
  const scope = inArray(events.venueId, clusterIds);
  const now = nowIso();

  const [totals, months, top, recent] = await Promise.all([
    db
      .select({
        upcoming: sql<number>`count(distinct case when ${events.startsAt} >= ${now} then ${events.id} end)`,
        past: sql<number>`count(distinct case when ${events.startsAt} < ${now} then ${events.id} end)`,
        acts: sql<number>`count(distinct ${events.artistId})`,
        next_at: sql<string | null>`min(case when ${events.startsAt} >= ${now} then ${events.startsAt} end)`,
        last_at: sql<string | null>`max(case when ${events.startsAt} < ${now} then ${events.startsAt} end)`,
        // What it costs to get in, as a floor rather than an average: a room's
        // cheap night is more informative than the mean of a jazz trio and an arena
        // tour, and price_from is itself already a minimum.
        cheapest: sql<number | null>`min(case when ${events.startsAt} >= ${now} and ${events.priceFrom} > 0 then ${events.priceFrom} end)`,
      })
      .from(events)
      .where(scope)
      .get(),
    db
      .select({
        month: sql<string>`substr(${events.startsAt}, 1, 7)`,
        shows: sql<number>`count(distinct ${events.id})`,
      })
      .from(events)
      .where(and(scope, gte(events.startsAt, now)))
      .groupBy(sql`substr(${events.startsAt}, 1, 7)`)
      .orderBy(sql`count(distinct ${events.id}) desc`, sql`substr(${events.startsAt}, 1, 7)`)
      .limit(1),
    // The genres that actually play here, which is the closest thing we have to
    // saying what kind of room it is without anybody describing it.
    db
      .select({ genres: artists.genres })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .where(and(scope, gte(events.startsAt, now)))
      .limit(GENRE_SCAN),
    // Who played here lately. On a room with no upcoming shows this is the only
    // thing on the page with a name in it.
    db
      .select({
        artist_id: artists.id,
        artist_name: artists.name,
        artist_image_url: artists.imageUrl,
        starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .where(and(scope, lte(events.startsAt, now)))
      .orderBy(desc(events.startsAt))
      // Over-fetched because it's deduplicated by artist below: a residency puts
      // the same name on six consecutive nights, and one room really did return
      // "Keyon Harrold" three times.
      .limit(RECENT_SCAN),
  ]);

  const counts = new Map<string, number>();
  for (const r of top) {
    for (const g of parseGenres(r.genres)) {
      const key = g.trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const genres = [...counts.entries()]
    // Alphabetical inside a tie, or equally-common genres reorder between requests.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([g]) => g);

  return {
    upcoming: totals?.upcoming ?? 0,
    past: totals?.past ?? 0,
    acts: totals?.acts ?? 0,
    next_at: totals?.next_at ?? null,
    last_at: totals?.last_at ?? null,
    cheapest: totals?.cheapest ?? null,
    busiest_month: months[0]?.month ?? null,
    busiest_month_shows: months[0]?.shows ?? 0,
    genres,
    // One row per act, keeping their latest night. Ordered newest-first already, so
    // the first sighting of a name is the one to keep.
    recent: dedupeBy(recent, (r) => r.artist_id).slice(0, RECENT_ACTS),
  };
}

/** First occurrence wins, order preserved. */
function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Past shows read to fill the "recently played" rail, before deduplication. */
const RECENT_SCAN = 40;
/** Acts shown in it. Enough to characterise a room, few enough to scan. */
const RECENT_ACTS = 6;

/** Upcoming shows read for their genres. A ceiling, not a page size: the busiest
 *  room in the table has 163 upcoming shows and four genres is the answer either
 *  way. */
const GENRE_SCAN = 120;

/**
 * Every venue id that belongs to the same room as `id` — the cluster head, and
 * everything pointing at it — for either a head or a member id.
 *
 * Written as two indexed lookups rather than one `coalesce(canonical_venue_id, id)
 * = ?` subquery: the coalesce isn't sargable, so that form scans the whole venues
 * table, once per request and once per page of an infinite scroll.
 */
async function clusterVenueIds(db: DB, id: string): Promise<string[]> {
  const head =
    (
      await db
        .select({ head: sql<string>`coalesce(${venues.canonicalVenueId}, ${venues.id})` })
        .from(venues)
        .where(eq(venues.id, id))
        .get()
    )?.head ?? null;
  if (!head) return [];
  // canonical_venue_id is indexed (venues_canonical_idx); the head itself is found
  // by primary key. A row inserted before its cluster was computed has a null
  // canonical and is only reachable as the head.
  const members = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.canonicalVenueId, head));
  return [...new Set([head, ...members.map((m) => m.id)])];
}

/**
 * A page of a venue's upcoming shows — every show in its cluster, not just the
 * ones filed against this exact row, and by any of its ids.
 */
export async function venueEvents(db: DB, id: string, limit = 20, offset = 0) {
  const all = await clusterVenueIds(db, id);
  if (all.length === 0) return { items: [], nextCursor: null };
  // One statement, so the ids have to fit under D1's parameter ceiling. The head is
  // first, and a room with this many rows filed against it is a clustering bug
  // rather than a real venue — say so rather than 500 the page.
  const clusterIds = all.slice(0, EVENT_LOOKUP_CHUNK);
  if (all.length > clusterIds.length) {
    console.warn(`venue ${id}: cluster of ${all.length} rows, reading the first ${clusterIds.length}`);
  }
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      time_unknown: events.timeUnknown,
      ticket_url: events.ticketUrl,
      price_from: events.priceFrom,
      artist_id: artists.id,
      artist_name: artists.name,
      artist_image_url: artists.imageUrl,
      artist_genres: artists.genres,
      ...rsvpCounts,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .where(and(inArray(events.venueId, clusterIds), stillUpcoming()))
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);
  const items = rows.map((r) => ({ ...r, artist_genres: parseGenres(r.artist_genres) }));
  return { items, nextCursor: rows.length === limit ? offset + limit : null };
}

// --- Writes -----------------------------------------------------------------

/**
 * A show more than this far out is almost always a data error — a mis-parsed year
 * or a placeholder date.
 */
const MAX_YEARS_AHEAD = 2;
/**
 * How far back a listing may be dated and still be stored.
 *
 * This used to be 24 hours, with the comment "one already past is dead weight in a
 * table whose reads are all 'upcoming'". That was true of a discovery app and it is
 * fatal for one where you log what you went to: a show becomes worth keeping the
 * moment it happens, and a day later we were throwing it away. Nothing recovers
 * that later — the sources stop listing a show once it's over, so every day this
 * stayed was a day of history that can never be re-fetched.
 *
 * A floor is still needed, because the failure it was really catching is a
 * mis-parsed year: an epoch-zero date or a year rendered "0202" is a data error
 * whichever direction it points. Two years back is far enough to accept anything a
 * feed legitimately still lists and near enough that 1970 never gets in.
 *
 * Safe to widen because it changes ingest only: every read path in the Worker
 * already states `starts_at >= now` for itself rather than relying on the table
 * holding nothing else — checked across data.ts, cities.ts, landing.ts, seo.ts and
 * indexnow.ts. The one query that reads the other direction is `venueStats`, which
 * asks for past shows on purpose and gets better as this fills in.
 */
const MAX_YEARS_BEHIND = 2;
/** Cap per artist per pass, so one malformed feed can't flood the table. */
const MAX_EVENTS_PER_ARTIST = 200;

/**
 * Loosened bounds for one call, so a deliberate historical backfill isn't held to
 * limits written for the live crawl.
 *
 * Both defaults are right where they are and must not be widened globally. The
 * two-year floor exists to catch a mis-parsed year — epoch zero, or "0202" — and the
 * live crawl has no way to tell that from a real date, so it needs the tight window.
 * A history fetch does: it asked for the past on purpose, from a source whose own data
 * stops in 2014, so it can accept a decade and still reject 1970. Same for the count —
 * 200 protects against a feed flooding the table, but an artist with 308 real past
 * shows is not a flood, and silently keeping 200 of them would leave a log with
 * holes in it that nothing would ever fill.
 */
export type SanitizeLimits = { maxYearsBehind?: number; maxEventsPerArtist?: number };

/** Drop listings we shouldn't store at all: absurdly dated, or a flood. */
export function sanitizeInputs(
  inputs: EventInput[],
  now = Date.now(),
  limits: SanitizeLimits = {},
): EventInput[] {
  const yearsBehind = limits.maxYearsBehind ?? MAX_YEARS_BEHIND;
  const perArtistCap = limits.maxEventsPerArtist ?? MAX_EVENTS_PER_ARTIST;
  const horizon = now + MAX_YEARS_AHEAD * 365 * 86_400_000;
  const floor = now - yearsBehind * 365 * 86_400_000;
  const perArtist = new Map<string, number>();
  const kept: EventInput[] = [];
  for (const i of inputs) {
    const t = Date.parse(i.starts_at);
    if (Number.isNaN(t) || t < floor || t > horizon) continue;
    const n = perArtist.get(i.artist_id) ?? 0;
    if (n >= perArtistCap) continue;
    perArtist.set(i.artist_id, n + 1);
    kept.push(i);
  }
  return kept;
}

/** Upsert venues + insert unseen events; returns ids of newly inserted events. */
export async function persist(db: DB, raw: EventInput[], limits?: SanitizeLimits): Promise<string[]> {
  const inputs = sanitizeInputs(raw, Date.now(), limits);
  if (raw.length !== inputs.length) {
    console.warn(`persist: dropped ${raw.length - inputs.length} unusable listing(s)`);
  }
  if (inputs.length === 0) return [];

  // Venues: upsert each, map (source:id) -> venue uuid.
  const venueRows = new Map<string, VenueRow>();
  for (const i of inputs) if (i.venue) venueRows.set(`${i.venue.source}:${i.venue.source_venue_id}`, i.venue);

  const venueIdByKey = new Map<string, string>();
  /** Keys resolved straight to an existing room — no row of their own at all. */
  const adoptedByKey = new Map<string, string>();
  let venueKeys = [...venueRows.keys()];

  // A junk-named venue that is NEW to the table never gets a row: it is looked
  // up by location first, and if a same-spot room exists, the listing simply
  // belongs to that room. Bandsintown files some shows under the tour title
  // with the venue's real coordinates — the name guard below already stops the
  // junk overwriting a stored name, but until this check the junk still landed
  // as a fresh row that only clustering could hide. A junk name whose spot we
  // don't know yet still inserts, because the show needs somewhere to hang.
  // Known (source, source_venue_id) pairs skip all of this: their row exists,
  // and the conflict-update path owns them.
  const junkKeys = venueKeys.filter((k) => {
    const v = venueRows.get(k)!;
    // Two verdicts feed this: the string rule, and the source mapping's own
    // (`junk_name`), which sees the listing's city and artist and catches the
    // dash-separated billings the string rule deliberately lets through.
    return (looksLikeEventTitle(v.name) || v.junk_name === true) && v.lat != null && v.lng != null;
  });
  if (junkKeys.length) {
    const known = await batchChunked<{ id: string }[]>(
      db,
      junkKeys.map((k) => {
        const v = venueRows.get(k)!;
        return db
          .select({ id: venues.id })
          .from(venues)
          .where(and(eq(venues.source, v.source), eq(venues.sourceVenueId, v.source_venue_id)))
          .limit(1);
      }),
    );
    const newJunk = junkKeys.filter((_, idx) => !known[idx]?.[0]);
    if (newJunk.length) {
      const DEG = 0.006; // same ~600m box the canonical pass searches
      const nearby = await batchChunked<
        { id: string; name: string; lat: number | null; lng: number | null; city: string | null; canonicalVenueId: string | null }[]
      >(
        db,
        newJunk.map((k) => {
          const v = venueRows.get(k)!;
          return db
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
              and(
                between(venues.lat, v.lat! - DEG, v.lat! + DEG),
                between(venues.lng, v.lng! - DEG, v.lng! + DEG),
              ),
            )
            .limit(100);
        }),
      );
      newJunk.forEach((k, idx) => {
        const v = venueRows.get(k)!;
        // A tour title has no name tokens, so the comparators treat it as
        // unnamed and the same-spot rule decides — the tested behaviour for
        // junk-named rows, applied before the row exists instead of after.
        const match = bestVenueMatch(
          { id: k, name: v.name, lat: v.lat, lng: v.lng, city: v.city },
          nearby[idx] ?? [],
        );
        if (match) {
          adoptedByKey.set(k, (match as { canonicalVenueId?: string | null }).canonicalVenueId ?? match.id);
        }
      });
      if (adoptedByKey.size) {
        venueKeys = venueKeys.filter((k) => !adoptedByKey.has(k));
      }
    }
  }

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
            // An incoming name that reads as an event title never overwrites the
            // stored one. Bandsintown swaps a venue's name for the current tour's
            // title and back again between crawls, and the crawl re-sends every
            // venue on a 15-minute cycle — unconditional `excluded.name` meant a
            // room's real name survived only until its next tour stop. The other
            // direction stays open on purpose: a junk stored name is replaced the
            // moment the feed sends a real one.
            name: looksLikeEventTitle(v.name) || v.junk_name === true ? sql`name` : sql`excluded.name`,
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
  // Adopted keys resolved to an existing room before any row was written; they
  // join the map here, already canonical.
  for (const [k, id] of adoptedByKey) canonicalByKey.set(k, id);

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
      timeUnknown: i.time_unknown === true,
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
        { artistId: s.row.artistId, venueId: s.row.venueId, startsAt: s.row.startsAt, timeUnknown: s.row.timeUnknown },
        { artistId: i.artist_id, venueId, startsAt: i.starts_at, timeUnknown: i.time_unknown },
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
      timeUnknown: i.time_unknown ?? false,
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
  timeUnknown: boolean | null;
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

  // A real time beats a noon placeholder no matter which source holds which —
  // field ownership only referees contests between two facts. A placeholder
  // never overwrites a clock time (the exact accident that used to keep
  // `time_tbd` listings out entirely), and the flag clears the moment any
  // source publishes the real thing.
  const incomingTbd = i.time_unknown === true;
  const rowTbd = row.timeUnknown === true;
  const startsAt =
    incomingTbd !== rowTbd
      ? incomingTbd
        ? row.startsAt
        : i.starts_at
      : (pick('starts_at', i.starts_at, row.startsAt) ?? row.startsAt);

  return {
    name: pick('name', i.name, row.name) ?? row.name,
    startsAt,
    timeUnknown: incomingTbd && rowTbd,
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
/**
 * Cluster membership for many venue ids at once — the set-sized version of
 * `clusterVenueIds`, for callers holding a whole batch of listings.
 *
 * Two indexed reads for the entire set (primary key, then `venues_canonical_idx`),
 * chunked under D1's bound-parameter ceiling. Exists because the ingest path used to
 * inline `coalesce(canonical_venue_id, id) = ?` per listing, which is the non-sargable
 * form every read path was already moved away from — one whole-table scan per incoming
 * show, on the hottest write path in the Worker.
 *
 * An id the venues table doesn't know maps to just itself, which matches nothing
 * downstream (`events.venue_id` is a foreign key), same as the subquery it replaces.
 */
async function clusterIdsByVenue(db: DB, ids: (string | null)[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (unique.length === 0) return out;

  const headOf = new Map<string, string>();
  for (let i = 0; i < unique.length; i += EVENT_LOOKUP_CHUNK) {
    const rows = await db
      .select({ id: venues.id, head: sql<string>`coalesce(${venues.canonicalVenueId}, ${venues.id})` })
      .from(venues)
      .where(inArray(venues.id, unique.slice(i, i + EVENT_LOOKUP_CHUNK)));
    for (const r of rows) headOf.set(r.id, r.head);
  }

  const heads = [...new Set(headOf.values())];
  const membersOf = new Map<string, string[]>();
  for (let i = 0; i < heads.length; i += EVENT_LOOKUP_CHUNK) {
    const rows = await db
      .select({ id: venues.id, head: venues.canonicalVenueId })
      .from(venues)
      .where(inArray(venues.canonicalVenueId, heads.slice(i, i + EVENT_LOOKUP_CHUNK)));
    for (const r of rows) {
      if (!r.head) continue;
      (membersOf.get(r.head) ?? membersOf.set(r.head, []).get(r.head)!).push(r.id);
    }
  }

  for (const id of unique) {
    const head = headOf.get(id);
    if (!head) {
      out.set(id, [id]);
      continue;
    }
    // Head first, then members; deduped because the asked-for id may be the head.
    out.set(id, [...new Set([head, ...(membersOf.get(head) ?? [])])]);
  }
  return out;
}

/**
 * The most cluster ids one match clause will carry. Real clusters are a handful of
 * rows; a cluster past this size is a clustering bug (see `venueEvents`, which warns
 * on the same condition), and the cap keeps the statement under D1's parameter limit.
 */
const MATCH_CLUSTER_MAX = 30;

async function findExistingShows(
  db: DB,
  keys: {
    source: string;
    sourceEventId: string;
    artistId: string;
    venueId: string | null;
    startsAt: string;
    timeUnknown: boolean;
  }[],
): Promise<(ExistingShow | null)[]> {
  if (keys.length === 0) return [];
  // Resolved once for the batch, not per listing — see `clusterIdsByVenue`.
  const clusters = await clusterIdsByVenue(
    db,
    keys.map((k) => k.venueId),
  );
  const cols = {
    id: events.id,
    artistId: events.artistId,
    source: events.source,
    sourceEventId: events.sourceEventId,
    sources: events.sources,
    name: events.name,
    startsAt: events.startsAt,
    timeUnknown: events.timeUnknown,
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
    const cluster = k.venueId ? (clusters.get(k.venueId) ?? [k.venueId]) : [];
    if (cluster.length > MATCH_CLUSTER_MAX) {
      // The head sorts first, so the slice keeps the row most shows point at.
      console.warn(`venue ${k.venueId}: cluster of ${cluster.length} rows, matching the first ${MATCH_CLUSTER_MAX}`);
    }
    if (k.venueId && !Number.isNaN(t)) {
      // A placeholder listing is pinned to noon at the venue, so "same show"
      // means "same local day" — the wider TBD window — rather than a clock
      // match it can't make.
      const window = (k.timeUnknown ? TBD_SHOW_MATCH_HOURS : SHOW_MATCH_HOURS) * 3_600_000;
      clauses.push(
        and(
          // Anywhere in the venue's cluster, not just the row this listing
          // resolved to. `k.venueId` is already canonical, but a show stored
          // earlier can still point at a row that *was* the representative before
          // a later venue joined the cluster and took the name — lexicographic
          // order picks the representative, so it moves when the cluster grows.
          // Comparing ids directly missed those and left the show stored twice.
          // The ids are pre-resolved for the whole batch (two indexed reads)
          // instead of the old inline `coalesce(...)` subquery, which scanned the
          // venues table once per incoming listing.
          inArray(events.venueId, cluster.slice(0, MATCH_CLUSTER_MAX)),
          eq(events.artistId, k.artistId),
          between(events.startsAt, isoAt(t - window), isoAt(t + window)),
        ),
      );
      if (!k.timeUnknown) {
        // The mirror case: this listing has a real time, but the show may be on
        // file as a noon placeholder from a source that didn't. An 8pm show sits
        // 8 hours from noon — outside the clock window above — so placeholders
        // get their own same-local-day match.
        const tbd = TBD_SHOW_MATCH_HOURS * 3_600_000;
        clauses.push(
          and(
            inArray(events.venueId, cluster.slice(0, MATCH_CLUSTER_MAX)),
            eq(events.artistId, k.artistId),
            eq(events.timeUnknown, true),
            between(events.startsAt, isoAt(t - tbd), isoAt(t + tbd)),
          ),
        );
      }
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

  // Who has already joined each interim head, so a candidate can be checked
  // against the whole cluster and not just the one row it matched. `sameVenue` is
  // pairwise; without this, two rooms that share nothing chain together through an
  // intermediate both can reach — see `agreesWithCluster`.
  const membersOf = new Map<string, VenuePoint[]>();
  for (const v of sorted) {
    let match: VenuePoint | null = null;
    if (v.lat != null && v.lng != null) {
      let pool = neighbours(v.lat, v.lng);
      // The nearest candidate whose *cluster* accepts this row. Refusing the
      // nearest and taking the next is deliberate: the nearest may head a chain
      // this row has no business in, while its true twin sits a street further.
      for (;;) {
        const best = bestVenueMatch(v, pool);
        if (!best) break;
        const head = canonicalOf.get(best.id) ?? best.id;
        if (agreesWithCluster(v, membersOf.get(head) ?? [best])) {
          match = best;
          break;
        }
        pool = pool.filter((c) => c.id !== best.id);
      }
    }
    const resolved = match ? canonicalOf.get(match.id) ?? match.id : v.id;
    canonicalOf.set(v.id, resolved);
    const group = membersOf.get(resolved);
    if (group) group.push(v);
    else membersOf.set(resolved, [v]);
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
      timeUnknown: events.timeUnknown,
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
        ? and(stillUpcoming(), gte(events.artistId, opts.afterArtistId))
        : stillUpcoming(),
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
      const gap = hoursApart(a.startsAt, b.startsAt);
      // Ordered by startsAt, so past the widest window nothing later pairs either.
      if (gap > TBD_SHOW_MATCH_HOURS) break;
      // In the 6–13h band only a placeholder pairs — two real times that far
      // apart are two shows. Skip rather than break: a flagged row further on
      // can still fall inside its own window.
      if (gap > SHOW_MATCH_HOURS && !a.timeUnknown && !b.timeUnknown) continue;
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
    time_unknown: r.timeUnknown ?? false,
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

export async function inBatches(db: DB, stmts: any[], size = 50): Promise<void> {
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
  // An event title costs the venue its name; a placeholder coordinate costs it its
  // position. Both are worth avoiding, and a real name outranks good coordinates
  // because the name is the venue's identity — the offset is at worst a few km
  // inside the right town. Either way this stays a total order over the cluster.
  //
  // Judged with `looksLikeEventTitle`, not the narrower tour-name test that governs
  // merging: this only picks which member of an already-decided cluster supplies
  // the displayed name, so the blunt rule is the right one. Measured on production,
  // 38 clusters were headed by an event title while holding a real name.
  const rank = (id: string) =>
    (looksLikeEventTitle(nameOf?.(id)) ? 2 : 0) + (onPlaceholderPoint?.(id) ? 1 : 0);
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
    // already point. Joining a row also means joining its whole cluster, so the
    // target has to agree with every member of that cluster this batch can see —
    // members beyond the candidate radius are invisible here, and the repair pass,
    // which sees the whole table, holds the same rule over them.
    const byHead = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const h = c.canonicalVenueId ?? c.id;
      const group = byHead.get(h);
      if (group) group.push(c);
      else byHead.set(h, [c]);
    }
    const cluster = candidates.filter(
      (c) =>
        c.id !== t.id &&
        sameVenue(target, c) &&
        agreesWithCluster(target, byHead.get(c.canonicalVenueId ?? c.id) ?? []),
    );
    // An existing head keeps the job. Ranking here only ever sees one batch, while
    // repairDuplicates ranks from the whole table, so re-picking on ingest makes a
    // room's public id churn between passes — and that id is what a device stores
    // when someone follows the venue. Ingest attaches rows to the cluster; choosing
    // a better head is the repair pass's call.
    const self = candidates.find((c) => c.id === t.id)?.canonicalVenueId ?? null;
    const existing = [...new Set([self, ...cluster.map((c) => c.canonicalVenueId)].filter(Boolean))];
    const resolved = representative(
      existing.length > 0
        ? existing
        : [t.id, ...cluster.map((c) => c.id), ...cluster.map((c) => c.canonicalVenueId)],
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
    // `resolved` can come from a candidate's `canonical_venue_id` — a row this
    // batch never looked at directly — so it is flattened explicitly. Without it a
    // head could still point somewhere else, and `coalesce()` resolves one hop:
    // half the room's events would answer with one id and half with another.
    for (const id of [t.id, resolved, ...cluster.map((c) => c.id)]) {
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
export async function ensureArtistRecord(env: CoreEnv, a: IncomingArtist) {
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
    .where(and(inArray(events.artistId, ids), stillUpcoming()));
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
    .where(and(stillUpcoming(), lte(events.startsAt, isoInDays(90))))
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
