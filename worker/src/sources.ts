import { eq, sql } from 'drizzle-orm';

import {
  artistsWithUpcoming,
  bestTmImage,
  dueArtistSources,
  enqueueArtistSources,
  ensureArtist,
  ensureArtistByName,
  nowIso,
  persist,
  recordCrawlOutcomes,
  touchArtistsRequested,
  upsertTmArtist,
  type CrawlOutcome,
  type EventInput,
  type IncomingArtist,
  type VenueRow,
} from './data';
import {
  backoffHours,
  frontierNames,
  lookupKeys,
  nextCheckAt,
  NOT_FOUND_HOURS,
  TIER_HOURS,
  tierFor,
} from './crawl';
import { getDb, type DB } from './db';
import { guessUtcOffsetHours } from './dedupe';
import { utcMsFromLocal, zoneFor } from './timezone';
import type { Env } from './env';
import { artists, discoveryLog, events, venues } from './schema';

// --- outbound HTTP ----------------------------------------------------------

const FETCH_TIMEOUT_MS = 8000;

/**
 * Every upstream here is a third party we don't control, and a hung connection
 * would hold the whole Worker request open, so all outbound calls get a
 * deadline.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Ticketmaster -----------------------------------------------------------

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';
const TM_MAX_RETRIES = 3;

function wkt(lng: any, lat: any): { lat: number | null; lng: number | null } {
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  return { lat: isNaN(la) ? null : la, lng: isNaN(ln) ? null : ln };
}

function tmVenue(e: any): VenueRow | null {
  const v = e._embedded?.venues?.[0];
  if (!v) return null;
  const { lat, lng } = wkt(v.location?.longitude, v.location?.latitude);
  return {
    source: 'ticketmaster',
    source_venue_id: v.id,
    name: v.name ?? 'Unknown venue',
    city: v.city?.name ?? null,
    region: v.state?.stateCode ?? v.state?.name ?? null,
    country: v.country?.countryCode ?? null,
    lat,
    lng,
  };
}

function tmToEventInput(e: any, artistId: string): EventInput | null {
  const startsAt = e.dates?.start?.dateTime;
  if (!startsAt) return null;
  const min = e.priceRanges?.[0]?.min;
  return {
    source: 'ticketmaster',
    source_event_id: e.id,
    name: e.name,
    starts_at: startsAt,
    ticket_url: e.url ?? null,
    price_from: typeof min === 'number' ? min : null,
    artist_id: artistId,
    venue: tmVenue(e),
  };
}

async function tmFetch(env: Env, path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, apikey: env.TICKETMASTER_API_KEY! });

  // Ticketmaster 429s both for short bursts and for a spent daily quota, so the
  // retry has to be bounded — an unbounded one would spin until the Worker's
  // limits killed the request.
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(`${TM_BASE}/${path}?${qs}`);
    if (res.status === 429 && attempt < TM_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Ticketmaster ${path}: ${res.status}`);
    return res.json();
  }
}

async function tmEventsNear(env: Env, lat: number, lng: number, radiusMiles: number): Promise<any[]> {
  const json = await tmFetch(env, 'events.json', {
    latlong: `${lat},${lng}`,
    radius: String(Math.min(Math.max(Math.round(radiusMiles), 1), 150)),
    unit: 'miles',
    classificationName: 'music',
    size: '200',
    sort: 'date,asc',
  });
  return json._embedded?.events ?? [];
}

async function tmResolveAttractionId(env: Env, name: string): Promise<string | null> {
  const json = await tmFetch(env, 'attractions.json', { keyword: name, classificationName: 'music', size: '5' });
  const hit = (json._embedded?.attractions ?? []).find((a: any) => a.name?.toLowerCase() === name.toLowerCase());
  return hit?.id ?? null;
}

async function tmEventsForAttraction(env: Env, attractionId: string): Promise<any[]> {
  const json = await tmFetch(env, 'events.json', { attractionId, size: '100', sort: 'date,asc' });
  return json._embedded?.events ?? [];
}

/** Pull this venue's full upcoming lineup from Ticketmaster into D1. Only works
 *  for Ticketmaster venues (seed venues have no TM id). Returns new-event count. */
export async function refreshVenue(env: Env, venueId: string): Promise<{ ingested: number }> {
  const db = getDb(env.DB);
  const v = await db
    .select({ source: venues.source, sourceVenueId: venues.sourceVenueId })
    .from(venues)
    .where(eq(venues.id, venueId))
    .get();
  if (!v || v.source !== 'ticketmaster') return { ingested: 0 };

  const json = await tmFetch(env, 'events.json', {
    venueId: v.sourceVenueId,
    size: '100',
    sort: 'date,asc',
    classificationName: 'music',
  });
  const tmEvents = json._embedded?.events ?? [];
  const inputs: EventInput[] = [];
  for (const e of tmEvents) {
    const artistId = await upsertTmArtist(db, e._embedded?.attractions?.[0]);
    if (!artistId) continue;
    const input = tmToEventInput(e, artistId);
    if (input) inputs.push(input);
  }
  return { ingested: (await persist(db, inputs)).length };
}

// --- Bandsintown ------------------------------------------------------------

/** Anything with a `Z` or a `±hh:mm` already knows what it means. */
const HAS_ZONE = /([Zz]|[+-]\d{2}:?\d{2})$/;
/** `2026-08-06T16:30:00` — the shape Bandsintown sends, with no zone at all. */
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** Where a naive Bandsintown timestamp happened, as far as we can tell. */
export type BitPlace = { lng: number | null; region?: string | null; country?: string | null };

/**
 * Bandsintown publishes venue-local time with no offset ("2026-08-06T16:30:00"),
 * so taking it as UTC put every show hours out — a 20:00 gig in San Francisco was
 * being stored, and displayed, as 20:00Z (1pm local).
 *
 * The venue's state/province gives a real IANA zone, and therefore the right
 * offset for that date including daylight saving (see `timezone.ts`). Where we
 * can't name a zone, longitude gives the standard offset, which is an hour out
 * under DST but eight hours better than nothing — and a Ticketmaster listing of
 * the same show overwrites it with a true UTC time when we have one.
 */
export function bitUtc(datetime: unknown, place: BitPlace | number | null): string | null {
  if (typeof datetime !== 'string') return null;
  const raw = datetime.trim();
  if (raw === '') return null;

  if (HAS_ZONE.test(raw)) {
    const zoned = new Date(raw);
    return Number.isNaN(zoned.getTime()) ? null : iso(zoned);
  }

  // Parsed field by field on purpose: `new Date('2026-08-06T20:00:00')` means
  // local time, which is UTC in a Worker but the developer's zone in a test, so
  // the same input produced two different answers.
  const m = NAIVE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, min, s] = m;
  const local = Date.UTC(+y, +mo - 1, +d, +h, +min, s ? +s : 0);
  if (Number.isNaN(local)) return null;

  const where: BitPlace = typeof place === 'number' || place === null ? { lng: place } : place;
  const zone = zoneFor(where.region, where.country);
  const exact = zone ? utcMsFromLocal(local, zone) : null;
  return iso(new Date(exact ?? local - guessUtcOffsetHours(where.lng) * 3_600_000));
}

const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z';

/** Bandsintown's `id_{id}` form is exact; a display-name lookup is not (an
 *  unknown artist and one with no upcoming shows both come back empty), so we
 *  use the stored id whenever a previous run learned it. */
function bitKey(artist: BitArtist): string {
  // Returned unencoded — `bitFetchByKeys` owns the URL encoding.
  return artist.bandsintown_id ? `id_${artist.bandsintown_id}` : (artist.bandsintown_name ?? artist.name);
}

export type BitArtist = {
  id: string;
  name: string;
  bandsintown_name: string | null;
  bandsintown_id?: string | null;
};

/**
 * Upcoming shows for one artist. Bandsintown has no location endpoint on the
 * open API — coverage comes from asking about every artist we know, so this is
 * the unit the crawl is built from.
 */
async function bitFetchEvents(env: Env, artist: BitArtist): Promise<any[]> {
  return (await bitFetchByKeys(env, [bitKey(artist)])).events;
}

/** Result of a Bandsintown lookup: `found` separates "no such artist" from
 *  "this artist has nothing coming up", which the response body does not. */
export type BitLookup = { events: any[]; key: string | null; found: boolean };

/**
 * Try each key in turn until Bandsintown recognises one. Their name lookup
 * answers on their spelling only ("MJ Lenderman and the Wind" → NotFound), so
 * the crawl passes several candidates (see `lookupKeys`) and remembers which one
 * worked. Keys are already encoded here, not by the caller.
 */
async function bitFetchByKeys(env: Env, keys: string[], maxAttempts = 3): Promise<BitLookup> {
  if (!env.BANDSINTOWN_APP_ID) return { events: [], key: null, found: false };
  let found: string | null = null;
  for (const key of keys.slice(0, maxAttempts)) {
    const res = await fetchWithTimeout(
      `https://rest.bandsintown.com/artists/${encodeURIComponent(key)}/events` +
        `?app_id=${encodeURIComponent(env.BANDSINTOWN_APP_ID)}&date=upcoming`,
    );
    // 403 is what the open tier returns for an unusable app_id, which is a
    // configuration problem rather than a fact about this artist.
    if (res.status === 403) throw new Error('bandsintown rejected the app_id (403)');
    if (!res.ok) continue;
    const raw = await res.json();
    if (!Array.isArray(raw)) continue;
    // A 200 means the artist exists; an empty array only means no dates yet, so
    // keep the key but carry on in case another spelling has the listings.
    found ??= key;
    if (raw.length > 0) return { events: raw, key, found: true };
  }
  return { events: [], key: found, found: found !== null };
}

/** Pure mapping, so it can be tested against a recorded payload. */
export function bitToEventInputs(artist: BitArtist, bitEvents: any[]): EventInput[] {
  return bitEvents.flatMap((e: any) => {
    if (!e.datetime || !e.id) return [];
    const { lat, lng } = wkt(e.venue?.longitude, e.venue?.latitude);
    const place: BitPlace = { lng, region: e.venue?.region ?? null, country: e.venue?.country ?? null };
    // One unparseable datetime would otherwise throw and lose the whole artist.
    const startsAt = bitUtc(e.datetime, place);
    if (!startsAt) return [];
    const endsAt = bitUtc(e.ends_at, place);
    return [
      {
        source: 'bandsintown',
        source_event_id: String(e.id),
        name: e.title || `${artist.name} @ ${e.venue?.name ?? 'TBA'}`,
        starts_at: startsAt,
        ends_at: endsAt,
        ticket_url: e.offers?.[0]?.url ?? e.url ?? null,
        price_from: null,
        sold_out: typeof e.sold_out === 'boolean' ? e.sold_out : null,
        is_free: typeof e.free === 'boolean' ? e.free : null,
        lineup: Array.isArray(e.lineup) ? e.lineup.filter((n: unknown) => typeof n === 'string') : null,
        artist_id: artist.id,
        venue: e.venue
          ? {
              source: 'bandsintown',
              source_venue_id: String(e.venue.id ?? `${e.venue.name}-${e.venue.city}`),
              name: e.venue.name ?? 'Unknown venue',
              city: e.venue.city ?? null,
              region: e.venue.region ?? null,
              country: e.venue.country ?? null,
              lat,
              lng,
            }
          : null,
      },
    ];
  });
}

/**
 * Learn an artist's Bandsintown id (and MusicBrainz id) from an event payload,
 * so the next lookup is by id instead of by name. Every event embeds the artist
 * it was fetched for, so this costs no extra request.
 */
async function rememberBitIdentity(db: DB, artistId: string, raw: any): Promise<void> {
  const a = raw?.artist;
  if (!a?.id) return;
  const set: Record<string, string> = { bandsintownId: String(a.id) };
  if (typeof a.name === 'string' && a.name) set.bandsintownName = a.name;
  if (typeof a.mbid === 'string' && a.mbid) set.mbid = a.mbid;
  await db.update(artists).set(set).where(eq(artists.id, artistId)).catch(() => {});
}

/** Bandsintown shows for one artist, persisted. Returns new-event ids. */
async function ingestBitArtist(env: Env, db: DB, artist: BitArtist): Promise<string[]> {
  const raw = await bitFetchEvents(env, artist);
  if (raw.length === 0) return [];
  await rememberBitIdentity(db, artist.id, raw[0]);
  return persist(db, bitToEventInputs(artist, raw));
}

/**
 * Pull Bandsintown shows for artists already in D1, oldest-known first. The
 * one-off backfill behind `/api/admin/backfill-bandsintown` until the scheduled
 * crawl (phase 3) owns this.
 */
export async function backfillBandsintown(
  env: Env,
  limit: number,
  offset: number,
): Promise<{ artists: number; ingested: number; per_artist: { name: string; ingested: number }[] }> {
  const db = getDb(env.DB);
  const rows = await db
    .select({
      id: artists.id,
      name: artists.name,
      bandsintown_name: artists.bandsintownName,
      bandsintown_id: artists.bandsintownId,
    })
    .from(artists)
    .orderBy(artists.createdAt)
    .limit(limit)
    .offset(offset);

  const per: { name: string; ingested: number }[] = [];
  let total = 0;
  for (const row of rows) {
    try {
      const ids = await ingestBitArtist(env, db, row);
      if (ids.length) per.push({ name: row.name, ingested: ids.length });
      total += ids.length;
    } catch (err) {
      console.error(`bandsintown backfill failed for ${row.name}: ${err}`);
    }
  }
  return { artists: rows.length, ingested: total, per_artist: per };
}

// --- Scheduled crawl --------------------------------------------------------

/**
 * Artists per scheduled run. Every one is at least one upstream request plus a
 * few D1 calls, and a Worker invocation has a subrequest and CPU budget it shares
 * with everything else — so the queue is drained in small bites, often, rather
 * than in one long pass. At 8 per run and a 15-minute cron this is ~770 artist
 * checks a day.
 */
const CRAWL_BATCH = 8;

/** How many lineup names one crawl may add to the frontier. Every name is a
 *  write, and the D1 free tier gives 100k a day. */
const FRONTIER_PER_RUN = 40;

export type CrawlResult = {
  source: 'bandsintown';
  checked: number;
  ingested: number;
  found: number;
  not_found: number;
  failed: number;
  frontier_added: number;
  skipped?: string;
};

/**
 * One pass of the artist crawl: take the artists whose next check is due, ask
 * Bandsintown about each, and reschedule them by how much attention they
 * deserve. Called by the Cron Trigger and by `POST /api/admin/crawl`.
 *
 * Artists are visited in series on purpose — this shares a Worker's subrequest
 * and CPU budget with everything else, and a stampede of parallel fetches to one
 * upstream is how an open API tier gets closed.
 */
export async function crawlBandsintown(env: Env, limit = CRAWL_BATCH): Promise<CrawlResult> {
  const result: CrawlResult = {
    source: 'bandsintown',
    checked: 0,
    ingested: 0,
    found: 0,
    not_found: 0,
    failed: 0,
    frontier_added: 0,
  };
  if (!env.BANDSINTOWN_APP_ID) return { ...result, skipped: 'BANDSINTOWN_APP_ID not set' };

  const db = getDb(env.DB);
  const due = await dueArtistSources(db, 'bandsintown', limit);
  if (due.length === 0) return result;

  const upcoming = await artistsWithUpcoming(
    db,
    due.map((d) => d.artistId),
  );
  const outcomes: CrawlOutcome[] = [];
  const frontier: string[] = [];

  for (const row of due) {
    result.checked++;
    const artist: BitArtist = {
      id: row.artistId,
      name: row.name,
      bandsintown_name: row.bandsintownName,
      bandsintown_id: row.bandsintownId,
    };
    const keys = lookupKeys({
      name: row.name,
      bandsintownId: row.bandsintownId,
      bandsintownName: row.bandsintownName,
      sourceKey: row.sourceKey,
    });

    try {
      const lookup = await bitFetchByKeys(env, keys);
      if (!lookup.found) {
        result.not_found++;
        outcomes.push({
          artistId: row.artistId,
          source: 'bandsintown',
          state: 'not_found',
          ok: false,
          failCount: 0, // Not a failure — upstream answered, it just has nobody.
          nextCheckAt: nextCheckAt(NOT_FOUND_HOURS),
        });
        continue;
      }

      result.found++;
      if (lookup.events.length > 0) {
        await rememberBitIdentity(db, row.artistId, lookup.events[0]);
        const inputs = bitToEventInputs(artist, lookup.events);
        result.ingested += (await persist(db, inputs)).length;
        for (const input of inputs) {
          if (frontier.length >= FRONTIER_PER_RUN) break;
          frontier.push(...frontierNames(input.lineup, row.name));
        }
      }

      // A lineup name that answers upstream is a real artist, so it graduates
      // out of the frontier and onto the normal schedule.
      const hours = TIER_HOURS[tierFor({ lastRequestedAt: row.lastRequestedAt, hasUpcoming: upcoming.has(row.artistId) || lookup.events.length > 0 })];
      outcomes.push({
        artistId: row.artistId,
        source: 'bandsintown',
        sourceKey: lookup.key,
        state: 'active',
        ok: true,
        failCount: 0,
        nextCheckAt: nextCheckAt(hours),
      });
    } catch (err) {
      result.failed++;
      const failCount = row.failCount + 1;
      console.error(`crawl failed for ${row.name} (${failCount}):`, err);
      outcomes.push({
        artistId: row.artistId,
        source: 'bandsintown',
        state: row.state === 'discovered' ? 'discovered' : 'active',
        ok: false,
        failCount,
        nextCheckAt: nextCheckAt(backoffHours(failCount)),
      });
    }
  }

  await recordCrawlOutcomes(db, outcomes);
  result.frontier_added = await addFrontierArtists(db, frontier.slice(0, FRONTIER_PER_RUN));
  return result;
}

/**
 * Support acts become artists in their own right, queued at the lowest priority.
 * This is the path from the artists a client happened to ask about to the whole
 * touring circuit, and it costs no extra upstream call — the names arrive inside
 * the events we already fetched.
 */
async function addFrontierArtists(db: DB, names: string[]): Promise<number> {
  const queue: { artistId: string; source: string; state: string; nextCheckAt: string }[] = [];
  let added = 0;
  for (const name of names) {
    const artist = await ensureArtistByName(db, name);
    if (!artist) continue;
    if (artist.created) added++;
    queue.push({
      artistId: artist.id,
      source: 'bandsintown',
      state: artist.created ? 'discovered' : 'active',
      // Due now, but behind every artist that has never been checked (whose
      // next_check_at is still the 1970 default) — a support act we've only seen
      // a name for is the cheapest thing in the queue to defer.
      nextCheckAt: nowIso(),
    });
  }
  await enqueueArtistSources(db, queue);
  return added;
}

/** Put every artist not already queued onto the crawl queue for a source. */
export async function backfillCrawlQueue(env: Env, source = 'bandsintown'): Promise<{ queued: number }> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ id: artists.id, bandsintownId: artists.bandsintownId, bandsintownName: artists.bandsintownName })
    .from(artists);
  await enqueueArtistSources(
    db,
    rows.map((r) => ({
      artistId: r.id,
      source,
      sourceKey: r.bandsintownId ? `id_${r.bandsintownId}` : r.bandsintownName,
    })),
  );
  return { queued: rows.length };
}

// --- Ingestion orchestrators ------------------------------------------------

export async function discover(env: Env, lat: number, lng: number, radius: number) {
  const db = getDb(env.DB);
  const cell = `${lat.toFixed(1)},${lng.toFixed(1)},${Math.round(radius)}`;
  const log = await db
    .select({ fetchedAt: discoveryLog.fetchedAt })
    .from(discoveryLog)
    .where(eq(discoveryLog.cell, cell))
    .get();
  if (log && Date.now() - new Date(log.fetchedAt).getTime() < 6 * 3600_000) {
    return { skipped: true, reason: 'recently fetched', ingested: 0 };
  }

  const tmEvents = await tmEventsNear(env, lat, lng, radius);
  const inputs: EventInput[] = [];
  for (const e of tmEvents) {
    const artistId = await upsertTmArtist(db, e._embedded?.attractions?.[0]);
    if (!artistId) continue;
    const input = tmToEventInput(e, artistId);
    if (input) inputs.push(input);
  }
  const newIds = await persist(db, inputs);
  await db
    .insert(discoveryLog)
    .values({ cell, fetchedAt: nowIso() })
    .onConflictDoUpdate({ target: discoveryLog.cell, set: { fetchedAt: sql`excluded.fetched_at` } });
  return { ingested: newIds.length, scanned: tmEvents.length };
}

export async function refreshArtists(env: Env, incoming: IncomingArtist[]) {
  const db = getDb(env.DB);
  const newIds: string[] = [];
  // Someone is looking at these artists right now, which is what earns them the
  // crawl's short interval (see `tierFor`).
  const touched: string[] = [];
  for (const a of incoming.slice(0, 25)) {
    if (!a?.name) continue;
    try {
      const row = await ensureArtist(db, a);
      if (!row) continue;

      // Resolve the Ticketmaster attraction, reconciling with any existing row
      // that already owns that ticketmaster_id (e.g. one created by discovery),
      // so we neither collide on the unique key nor ingest onto a duplicate.
      let targetId: string = row.id;
      let tmId = row.ticketmaster_id;
      if (!tmId) {
        tmId = await tmResolveAttractionId(env, row.name);
        if (tmId) {
          const existing = await db
            .select({ id: artists.id })
            .from(artists)
            .where(eq(artists.ticketmasterId, tmId))
            .get();
          if (existing && existing.id !== row.id) targetId = existing.id;
          else await db.update(artists).set({ ticketmasterId: tmId }).where(eq(artists.id, row.id));
        }
      }

      const inputs: EventInput[] = [];
      if (tmId) {
        const tmEvents = await tmEventsForAttraction(env, tmId);
        inputs.push(...tmEvents.flatMap((e) => tmToEventInput(e, targetId) ?? []));
      }
      const bitArtist: BitArtist = {
        id: targetId,
        name: row.name,
        bandsintown_name: row.bandsintown_name,
        bandsintown_id: row.bandsintown_id,
      };
      const bitRaw = await bitFetchEvents(env, bitArtist);
      if (bitRaw.length) {
        await rememberBitIdentity(db, targetId, bitRaw[0]);
        inputs.push(...bitToEventInputs(bitArtist, bitRaw));
      }
      newIds.push(...(await persist(db, inputs)));
      touched.push(targetId);
    } catch (err) {
      console.error(`refresh failed for ${a.name}: ${err}`);
    }
  }
  await touchArtistsRequested(db, touched);
  // We just fetched their Bandsintown dates, so the crawl needn't repeat that
  // immediately — one hot interval from now is soon enough.
  await enqueueArtistSources(
    db,
    touched.map((artistId) => ({
      artistId,
      source: 'bandsintown',
      nextCheckAt: nextCheckAt(TIER_HOURS.hot),
    })),
  );
  return { ingested: newIds.length };
}

// --- Spotify ----------------------------------------------------------------

let spotifyToken: { value: string; expiresAt: number } | null = null;

async function spotifyAccessToken(env: Env): Promise<string> {
  if (spotifyToken && Date.now() < spotifyToken.expiresAt - 60_000) return spotifyToken.value;
  const id = env.SPOTIFY_CLIENT_ID;
  const secret = env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify credentials not configured');
  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
  const json = await res.json<any>();
  spotifyToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return spotifyToken.value;
}

async function spotifyGet(env: Env, path: string): Promise<any> {
  const token = await spotifyAccessToken(env);
  const res = await fetchWithTimeout(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify ${path.split('?')[0]}: ${res.status}`);
  return res.json<any>();
}

export async function searchArtists(env: Env, query: string) {
  // Spotify caps search `limit` at 10 for apps in development mode.
  const json = await spotifyGet(env, `/search?type=artist&limit=10&q=${encodeURIComponent(query)}`);
  return (json.artists?.items ?? []).map((a: any) => ({
    spotify_id: a.id,
    name: a.name,
    image_url: a.images?.[0]?.url ?? null,
    genres: a.genres ?? [],
    popularity: a.popularity ?? 0,
  }));
}

/** Spotify profile: high-res image + profile link. Resolves the id (stored or
 *  by name) and backfills id/image into D1. Dev-mode apps only expose
 *  id/name/images/external_urls (no followers/genres/top-tracks). */
async function spotifyProfile(
  env: Env,
  db: DB,
  row: { id: string; name: string; spotify_id: string | null; image_url: string | null },
): Promise<{ image: string | null; url: string | null } | null> {
  let sid: string | null = row.spotify_id;
  if (!sid) {
    const found = await spotifyGet(env, `/search?type=artist&limit=1&q=${encodeURIComponent(row.name)}`);
    sid = found.artists?.items?.[0]?.id ?? null;
    if (sid) {
      await db.update(artists).set({ spotifyId: sid }).where(eq(artists.id, row.id)).catch(() => {});
    }
  }
  if (!sid) return null;
  const artist = await spotifyGet(env, `/artists/${sid}`);
  const image = artist.images?.[0]?.url ?? null;
  if (!row.image_url && image) {
    await db.update(artists).set({ imageUrl: image }).where(eq(artists.id, row.id)).catch(() => {});
  }
  return { image, url: artist.external_urls?.spotify ?? null };
}

// --- Deezer (open API, no key) ----------------------------------------------

/** Top tracks + fan count from Deezer's open API. Each track carries a 30s
 *  preview mp3 and a link to the full track. */
async function deezerTopTracks(name: string): Promise<{ tracks: any[]; fans: number | null }> {
  const search = await fetchWithTimeout(`https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`).then((r) =>
    r.json<any>(),
  );
  const artist = search.data?.[0];
  if (!artist?.id) return { tracks: [], fans: null };
  const top = await fetchWithTimeout(`https://api.deezer.com/artist/${artist.id}/top?limit=5`).then((r) => r.json<any>());
  const tracks = (top.data ?? []).map((t: any) => ({
    id: String(t.id),
    name: t.title,
    album: t.album?.title ?? null,
    image_url: t.album?.cover_medium ?? t.album?.cover ?? null,
    preview_url: t.preview || null,
    url: t.link ?? null,
  }));
  return { tracks, fans: typeof artist.nb_fan === 'number' ? artist.nb_fan : null };
}

// --- Wikipedia --------------------------------------------------------------

/** A short artist bio from Wikipedia (CC BY-SA — shown with attribution). */
async function wikipediaBio(name: string): Promise<{ text: string; url: string | null } | null> {
  const headers = { 'User-Agent': 'Marquee/1.0 (concert discovery app)', accept: 'application/json' };
  const summary = async (title: string) => {
    const r = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers,
    });
    if (!r.ok) return null;
    const j = await r.json<any>();
    if (!j.extract || j.type === 'disambiguation') return null;
    return { text: j.extract as string, url: j.content_urls?.desktop?.page ?? null };
  };
  let bio = await summary(name);
  if (!bio) {
    const s = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(
        `${name} band OR musician`,
      )}`,
      { headers },
    ).then((r) => r.json<any>());
    const hit = s.query?.search?.[0]?.title;
    if (hit) bio = await summary(hit);
  }
  return bio;
}

// --- Lineup (support acts) --------------------------------------------------

/** Supporting acts for a show, from the Ticketmaster event's attractions
 *  (everything but the headliner). Empty for non-TM events or shows with no
 *  additional acts listed. */
export async function eventLineup(env: Env, eventId: string) {
  const db = getDb(env.DB);
  const ev = await db
    .select({ source: events.source, sourceEventId: events.sourceEventId, headliner: artists.name })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .where(eq(events.id, eventId))
    .get();
  if (!ev || ev.source !== 'ticketmaster' || !env.TICKETMASTER_API_KEY) return { support: [] };

  const json = await tmFetch(env, `events/${ev.sourceEventId}.json`, {});
  const attractions = json._embedded?.attractions ?? [];
  const seen = new Set<string>([ev.headliner.toLowerCase()]);
  const support: { name: string; image_url: string | null }[] = [];
  for (const a of attractions) {
    const name = a?.name;
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    support.push({ name, image_url: bestTmImage(a.images) });
  }
  return { support: support.slice(0, 6) };
}

// --- Buzz (Bluesky) ---------------------------------------------------------

/** Real posts about a show from Bluesky's open search API (no key). Tries the
 *  artist + venue first (show-specific), then falls back to the artist alone. */
async function blueskyPosts(artist: string, venue: string | null): Promise<any[]> {
  const search = async (q: string) => {
    const r = await fetchWithTimeout(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=12&sort=top`,
      { headers: { accept: 'application/json' } },
    );
    if (!r.ok) return [];
    const j = await r.json<any>();
    return Array.isArray(j.posts) ? j.posts : [];
  };

  let raw = venue ? await search(`"${artist}" ${venue}`) : [];
  if (raw.length < 3) raw = await search(`"${artist}"`);

  return raw
    .filter((p: any) => p?.record?.text && p.author?.handle)
    .slice(0, 6)
    .map((p: any) => ({
      id: p.uri as string,
      author: (p.author.displayName || p.author.handle) as string,
      handle: p.author.handle as string,
      avatar: p.author.avatar ?? null,
      text: p.record.text as string,
      image: blueskyEmbedImage(p.embed),
      likes: p.likeCount ?? 0,
      replies: p.replyCount ?? 0,
      reposts: p.repostCount ?? 0,
      created_at: p.record.createdAt ?? null,
      url: `https://bsky.app/profile/${p.author.handle}/post/${String(p.uri).split('/').pop()}`,
    }));
}

/** A thumbnail from a Bluesky post's attached media (image, quote, video, or
 *  link card), if any. */
function blueskyEmbedImage(embed: any): string | null {
  if (!embed) return null;
  return (
    embed.images?.[0]?.thumb ?? // images
    embed.thumbnail ?? // video
    embed.external?.thumb ?? // link card
    embed.media?.images?.[0]?.thumb ?? // recordWithMedia
    embed.media?.external?.thumb ??
    null
  );
}

/** Discussion about a specific show: real Bluesky posts (best-effort). */
export async function eventBuzz(env: Env, eventId: string) {
  const db = getDb(env.DB);
  const ev = await db
    .select({ artist: artists.name, venue: venues.name })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, eventId))
    .get();
  if (!ev) return { posts: [] };
  const posts = await blueskyPosts(ev.artist, ev.venue).catch(() => []);
  return { posts };
}

// --- Aggregate --------------------------------------------------------------

/** Aggregate public info for an artist: Spotify image + profile link, Deezer
 *  top tracks + fan count, and a Wikipedia bio. Each source is best-effort so a
 *  failure in one still returns the others. */
export async function artistInfo(env: Env, artistId: string) {
  const db = getDb(env.DB);
  const row = await db
    .select({ id: artists.id, name: artists.name, spotify_id: artists.spotifyId, image_url: artists.imageUrl })
    .from(artists)
    .where(eq(artists.id, artistId))
    .get();
  if (!row) return null;

  const [spotify, deezer, bio] = await Promise.all([
    (env.SPOTIFY_CLIENT_ID ? spotifyProfile(env, db, row) : Promise.resolve(null)).catch(() => null),
    deezerTopTracks(row.name).catch(() => ({ tracks: [], fans: null })),
    wikipediaBio(row.name).catch(() => null),
  ]);

  return {
    spotify_url: spotify?.url ?? null,
    image_url: spotify?.image ?? row.image_url ?? null,
    followers: deezer.fans,
    bio: bio?.text ?? null,
    bio_url: bio?.url ?? null,
    top_tracks: deezer.tracks,
  };
}
