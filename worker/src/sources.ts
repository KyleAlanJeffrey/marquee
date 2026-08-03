import { eq, sql } from 'drizzle-orm';

import {
  artistsWithUpcoming,
  bestTmImage,
  dueArtistSources,
  enqueueArtistSources,
  ensureArtist,
  ensureArtistByName,
  ensureArtistsByName,
  finishRun,
  isoAt,
  nowIso,
  persist,
  deferArtistSources,
  recordCrawlOutcomes,
  startRun,
  touchArtistsRequested,
  upsertTmArtist,
  venueStats,
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
import { cleanVenueName, dashBillingVenueName, guessUtcOffsetHours, nameCarriesAct } from './dedupe';
import { utcMsFromLocal, zoneFor } from './timezone';
import { fetchVenueEnrichment, type VenueEnrichment } from './venue-info';
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
  // No `dateTime` means the set time isn't announced (`timeTBA`/`noSpecificTime`)
  // — Ticketmaster still publishes the local date and the venue's zone, so the
  // show goes in pinned to noon at the venue with `time_unknown` set, same as a
  // SeatGeek `time_tbd` listing. Without even a date there's nothing to anchor.
  let startsAt = e.dates?.start?.dateTime;
  const timeUnknown = !startsAt;
  if (!startsAt) startsAt = tmNoonUtc(e);
  if (!startsAt) return null;
  const min = e.priceRanges?.[0]?.min;
  return {
    source: 'ticketmaster',
    source_event_id: e.id,
    name: e.name,
    starts_at: startsAt,
    time_unknown: timeUnknown,
    ticket_url: e.url ?? null,
    price_from: typeof min === 'number' ? min : null,
    artist_id: artistId,
    venue: tmVenue(e),
  };
}

/** Noon at the venue on the published local date — see `sgNoonUtc` for why noon. */
function tmNoonUtc(e: any): string | null {
  const date = typeof e?.dates?.start?.localDate === 'string' ? e.dates.start.localDate.trim() : '';
  const zone = typeof e?.dates?.timezone === 'string' ? e.dates.timezone.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !zone) return null;
  const naive = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(naive)) return null;
  const ms = utcMsFromLocal(naive, zone);
  return ms === null ? null : isoAt(ms);
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

/** Nothing about the current artist is wrong — the key we call with is. */
class BitConfigError extends Error {}

/**
 * Try each key in turn until Bandsintown recognises one. Their name lookup
 * answers on their spelling only ("MJ Lenderman and the Wind" → NotFound), so
 * the crawl passes several candidates (see `lookupKeys`) and remembers which one
 * worked. Keys are already encoded here, not by the caller.
 */
async function bitFetchByKeys(
  env: Env,
  keys: string[],
  maxAttempts = 3,
  // `past` is the same endpoint with the window reversed, and it is how the
  // catalogue gets a history at all — see `fetchArtistHistory`.
  date: 'upcoming' | 'past' = 'upcoming',
): Promise<BitLookup> {
  if (!env.BANDSINTOWN_APP_ID) return { events: [], key: null, found: false };
  let found: string | null = null;
  for (const key of keys.slice(0, maxAttempts)) {
    const res = await fetchWithTimeout(
      `https://rest.bandsintown.com/artists/${encodeURIComponent(key)}/events` +
        `?app_id=${encodeURIComponent(env.BANDSINTOWN_APP_ID)}&date=${date}`,
    );
    // 403 is what the open tier returns for an unusable app_id, which is a
    // configuration problem rather than a fact about this artist.
    if (res.status === 403) throw new BitConfigError('bandsintown rejected the app_id (403)');
    // A rate limit or a server error says nothing about this artist either. It
    // has to raise, or the caller would file a `not_found` and then sit on it for
    // NOT_FOUND_HOURS — and trying the remaining keys would only add load.
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`bandsintown ${res.status} for ${key}`);
    }
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

/**
 * The venue name Bandsintown should have sent. Two repairs, in order of trust:
 * a billing stays untouched (the junk path owns it — cleaning "THE WORD ALIVE -
 * ...TOUR" down to the band's name would *rescue* junk into a plausible-looking
 * room), and otherwise any tour-shaped dash segment is stripped, recovering
 * "York Barbican" from "YORK BARBICAN - A Happy Christmas Tour 2026" — unless
 * what's left carries the act, which is a billing by another route.
 */
export function bitVenueName(
  rawName: unknown,
  city: unknown,
  artistName: string,
): string {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
  const name = trimmed || 'Unknown venue';
  if (dashBillingVenueName(name, typeof city === 'string' ? city : null, artistName)) return name;
  const cleaned = cleanVenueName(name);
  if (cleaned && !nameCarriesAct(cleaned, artistName)) return cleaned;
  return name;
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
    // Computed once, used for both the venue row and the fallback event title —
    // "Artist @ ROOM - Tour 2026" would put the tour right back in the title.
    const venueName = e.venue ? bitVenueName(e.venue.name, e.venue.city, artist.name) : null;
    return [
      {
        source: 'bandsintown',
        source_event_id: String(e.id),
        name: e.title || `${artist.name} @ ${venueName ?? 'TBA'}`,
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
              name: venueName!,
              // "MGMT DJ SET - San Francisco" filed as the venue: the billing
              // class only separates from real dash-named rooms with the
              // listing's own artist and city in hand, so it's judged here
              // rather than by a string rule downstream.
              junk_name: dashBillingVenueName(e.venue.name, e.venue.city, artist.name) || undefined,
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
 * The artist photo riding in a Bandsintown payload, if it's a real one.
 *
 * Bandsintown answers "no photo" with a URL anyway — a stock silhouette at
 * `photos.bandsintown.com/artist<Size>.jpg` (Lessa, measured 2026-08-03,
 * wears `artistLarge.jpg`). Storing that would put the same grey figure on
 * thousands of acts, which is worse than the app's own fallback art, so the
 * stock paths are treated as null. Real photos live under sized directories
 * (`/large/12345.jpeg`) and pass.
 */
export function bitImageUrl(artist: unknown): string | null {
  const url =
    typeof (artist as { image_url?: unknown })?.image_url === 'string'
      ? ((artist as { image_url: string }).image_url ?? '').trim()
      : '';
  if (!/^https:\/\//.test(url)) return null;
  if (/photos\.bandsintown\.com\/artist[A-Za-z]*\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) return null;
  return url;
}

/**
 * Learn an artist's Bandsintown id (and MusicBrainz id) from an event payload,
 * so the next lookup is by id instead of by name. Every event embeds the artist
 * it was fetched for, so this costs no extra request — and since 2026-08-03 the
 * same free ride fills in a missing artist photo: 2,152 of the 2,208
 * Bandsintown-linked artists in production had no image because this function
 * was already holding one and not writing it. Fill-if-null only — a Spotify or
 * Ticketmaster image is sharper and must never be displaced by a crawl.
 */
async function rememberBitIdentity(db: DB, artistId: string, raw: any): Promise<void> {
  const a = raw?.artist;
  if (!a?.id) return;
  const set: Record<string, unknown> = { bandsintownId: String(a.id) };
  if (typeof a.name === 'string' && a.name) set.bandsintownName = a.name;
  if (typeof a.mbid === 'string' && a.mbid) set.mbid = a.mbid;
  const image = bitImageUrl(a);
  if (image) set.imageUrl = sql`coalesce(${artists.imageUrl}, ${image})`;
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
 * How far back a history fetch will accept a date, and how many it will keep.
 *
 * Both loosen the live crawl's guards deliberately, and only for this call — see
 * `SanitizeLimits` in data.ts. Twenty years is generous against a source whose own
 * data stops around 2014, which is the point: it accepts everything real and still
 * rejects an epoch-zero or "0202" mis-parse. 500 is above the busiest artist
 * measured (308 past shows) so a working band's history doesn't arrive with holes.
 */
const HISTORY_YEARS_BEHIND = 20;
const HISTORY_MAX_EVENTS = 500;

export type ArtistHistory = {
  artist_id: string;
  /** False when this answer came from the stored stamp instead of upstream. */
  fetched: boolean;
  /**
   * Whether Bandsintown recognised the artist at all, as opposed to having no dates.
   * Null when this call didn't ask — the stored stamp doesn't record the outcome, and
   * a guess here would read as fact.
   */
  found: boolean | null;
  /** Newly written rows. Zero on a second call is success, not failure. */
  ingested: number;
  /** Past events on file for this artist afterwards, however they got there. */
  past_on_file: number;
  fetched_at: string | null;
};

/**
 * Fetch one artist's past shows, once.
 *
 * This is the thing that gives the catalogue a history. Every source we ingest sells
 * tickets, so the table only ever knew about shows that hadn't happened yet — 623 past
 * events out of 22,675, nothing before 2026-07-12. An app for logging what you have
 * seen cannot run on 19 days.
 *
 * **Pulled, not pushed.** Backfilling all 3,771 artists eagerly is ~500k rows against
 * a cron budget already tight on CPU and subrequests. Instead the first person to care
 * about an artist pays for one request, and `past_events_fetched_at` means the second
 * person pays nothing. That is also the only sensible prioritisation available: the
 * artists worth having history for are the ones somebody asked about.
 *
 * Stamped even when nothing comes back, because "Bandsintown doesn't know them" is an
 * answer worth remembering rather than re-asking on every page view. `force` is the
 * escape hatch for when a later crawl has learned a better name to ask under.
 */
export async function fetchArtistHistory(
  env: Env,
  artistId: string,
  opts: { force?: boolean } = {},
): Promise<ArtistHistory | null> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      id: artists.id,
      name: artists.name,
      bandsintownName: artists.bandsintownName,
      bandsintownId: artists.bandsintownId,
      fetchedAt: artists.pastEventsFetchedAt,
    })
    .from(artists)
    .where(eq(artists.id, artistId))
    .get();
  if (!row) return null;

  const countPast = async () =>
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(events)
        .where(sql`${events.artistId} = ${row.id} and ${events.startsAt} < ${nowIso()}`)
        .get()
    )?.n ?? 0;

  const cached = (fetchedAt: string) => ({
    artist_id: row.id,
    fetched: false,
    // Not `true`. Whether Bandsintown recognised them is only known by the call that
    // asked, and that outcome isn't stored — so claiming it here would be inventing
    // an answer. Null means "didn't ask this time", which is the truth.
    found: null,
    ingested: 0,
    fetched_at: fetchedAt,
  });

  // Already asked. History doesn't change, so there is nothing to gain by asking again.
  if (row.fetchedAt && !opts.force) {
    return { ...cached(row.fetchedAt), past_on_file: await countPast() };
  }

  /*
   * Claim the fetch before making it, so two requests for the same artist don't both
   * go upstream.
   *
   * The read above and the write below are separate statements, so without this a
   * second caller arriving in between saw `fetchedAt` still null and made the same
   * third-party request. Stamping first and checking what the update touched turns the
   * check into the claim: `where past_events_fetched_at is null` means exactly one
   * caller can win it. `force` skips the guard because that is what it is for.
   */
  const claimedAt = nowIso();
  const claim = await db
    .update(artists)
    .set({ pastEventsFetchedAt: claimedAt })
    .where(
      opts.force
        ? eq(artists.id, row.id)
        : sql`${artists.id} = ${row.id} and ${artists.pastEventsFetchedAt} is null`,
    );
  // D1 reports how many rows the statement changed. Nothing changed means somebody
  // else claimed it first, so this caller reads their result instead of duplicating it.
  const claimed = (claim as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 1;
  if (!claimed && !opts.force) {
    // Somebody else won the claim between our read and our write. Report *their*
    // stamp — `claimedAt` is our losing attempt's clock, and handing it back would
    // date the fetch to a call that never went upstream.
    const winner = await db
      .select({ fetchedAt: artists.pastEventsFetchedAt })
      .from(artists)
      .where(eq(artists.id, row.id))
      .get();
    return { ...cached(winner?.fetchedAt ?? claimedAt), past_on_file: await countPast() };
  }

  const keys = lookupKeys({
    name: row.name,
    bandsintownId: row.bandsintownId,
    bandsintownName: row.bandsintownName,
  });
  const lookup = await bitFetchByKeys(env, keys, 3, 'past');

  let ingested = 0;
  if (lookup.events.length > 0) {
    await rememberBitIdentity(db, row.id, lookup.events[0]);
    const inputs = bitToEventInputs({ ...row, bandsintown_name: row.bandsintownName }, lookup.events);
    ingested = (
      await persist(db, inputs, {
        maxYearsBehind: HISTORY_YEARS_BEHIND,
        maxEventsPerArtist: HISTORY_MAX_EVENTS,
      })
    ).length;
  }

  return {
    artist_id: row.id,
    fetched: true,
    found: lookup.found,
    ingested,
    past_on_file: await countPast(),
    // The stamp went down before the request, not after — see the claim above.
    fetched_at: claimedAt,
  };
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
  const run = await startRun(db, 'bandsintown', 'backfill');
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
  let failed = 0;
  for (const row of rows) {
    try {
      const ids = await ingestBitArtist(env, db, row);
      if (ids.length) per.push({ name: row.name, ingested: ids.length });
      total += ids.length;
    } catch (err) {
      failed++;
      console.error(`bandsintown backfill failed for ${row.name}: ${err}`);
    }
  }
  await finishRun(db, run, { scanned: rows.length, inserted: total, failed });
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
  const db = getDb(env.DB);
  // Logged even when it can't run: "the crawl is misconfigured" and "the crawl
  // isn't running" are different problems and used to look the same.
  const run = await startRun(db, 'bandsintown', 'crawl');
  if (!env.BANDSINTOWN_APP_ID) {
    const skipped = 'BANDSINTOWN_APP_ID not set';
    await finishRun(db, run, { note: skipped });
    return { ...result, skipped };
  }

  const due = await dueArtistSources(db, 'bandsintown', limit);
  if (due.length === 0) {
    await finishRun(db, run, { note: 'nothing due' });
    return result;
  }

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
      if (err instanceof BitConfigError) {
        // Every remaining artist would fail the same way, and backing them all
        // off would empty the queue for hours over one bad credential. Stop, keep
        // what already succeeded, and say why.
        console.error('crawl aborted:', err);
        result.skipped = err.message;
        break;
      }
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
  await finishRun(db, run, {
    scanned: result.checked,
    inserted: result.ingested,
    failed: result.failed,
    note: result.skipped ?? null,
  });
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

// --- SeatGeek ---------------------------------------------------------------

/**
 * SeatGeek is a geographic source, like Ticketmaster and unlike Bandsintown: it
 * searches by lat/lon and radius, so it fills in the venues Ticketmaster's
 * catalogue misses rather than the artists Bandsintown knows about. Its first SF
 * page is mostly small rooms — Kilowatt Bar, the Castro Theatre — which is exactly
 * the gap phase 4 was opened to close.
 *
 * Two things it publishes that nothing else here does: a true UTC timestamp
 * (`datetime_utc`) and the venue's IANA zone, so its show times need no inference
 * at all.
 */
const SG_BASE = 'https://api.seatgeek.com/2';
const SG_MAX_RETRIES = 3;
/** The API's own ceiling — asking for 200 quietly returns 100. */
const SG_PER_PAGE = 100;
/**
 * Pages per sweep. A dense metro has ~600 concerts inside 25 miles, but this
 * shares a Worker invocation (and its subrequest budget) with the Ticketmaster
 * pass, and shows are returned soonest-first, so three pages takes the part of
 * the tail that matters and leaves the rest to the next sweep.
 */
const SG_MAX_PAGES = 3;
/**
 * Performer names kept as the lineup. Festival bills run long — Outside Lands
 * lists 76 — and the whole list is neither useful on a card nor worth the bytes.
 * The crawl's frontier expansion promotes these to artist rows at its own pace.
 */
const SG_LINEUP_MAX = 12;

/** SeatGeek stamps some `*_local` fields with a `Z` they don't mean. */
const stripZ = (s: string) => s.replace(/[Zz]$/, '');

/**
 * A show's start as real UTC. `datetime_utc` is UTC by name but carries no zone
 * suffix, so parsing it as-is would read it as the *reader's* local time — seven
 * hours out for a California venue, and wrong in a way that looks plausible.
 */
export function sgUtc(e: any): string | null {
  const utc = typeof e?.datetime_utc === 'string' ? e.datetime_utc.trim() : '';
  if (utc) {
    const t = Date.parse(HAS_ZONE.test(utc) ? utc : `${utc.replace(' ', 'T')}Z`);
    if (!Number.isNaN(t)) return isoAt(t);
  }
  // No UTC field: the local time plus the venue's own IANA zone is as good, and
  // better than anything we could infer from a longitude.
  const local = typeof e?.datetime_local === 'string' ? stripZ(e.datetime_local.trim()) : '';
  const zone = typeof e?.venue?.timezone === 'string' ? e.venue.timezone.trim() : '';
  if (!local || !zone) return null;
  const naive = Date.parse(`${local.replace(' ', 'T')}Z`);
  if (Number.isNaN(naive)) return null;
  const ms = utcMsFromLocal(naive, zone);
  return ms === null ? null : isoAt(ms);
}

/**
 * Noon at the venue on the show's local date, for `time_tbd` listings whose
 * clock time is a filler. The local *date* is still real; noon keeps the row on
 * that calendar day in every zone and sits maximally far from both midnights,
 * which is what lets `TBD_SHOW_MATCH_HOURS` treat "same local day" as a window.
 */
export function sgNoonUtc(e: any): string | null {
  const local = typeof e?.datetime_local === 'string' ? stripZ(e.datetime_local.trim()) : '';
  const zone = typeof e?.venue?.timezone === 'string' ? e.venue.timezone.trim() : '';
  const date = local.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !zone) return null;
  const naive = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(naive)) return null;
  const ms = utcMsFromLocal(naive, zone);
  return ms === null ? null : isoAt(ms);
}

function sgVenue(e: any): VenueRow | null {
  const v = e?.venue;
  if (!v?.id) return null;
  const { lat, lng } = wkt(v.location?.lon, v.location?.lat);
  return {
    source: 'seatgeek',
    source_venue_id: String(v.id),
    name: v.name_v2 || v.name || 'Unknown venue',
    city: v.city ?? null,
    region: v.state ?? null,
    country: v.country ?? null,
    lat,
    lng,
  };
}

export type SgPerformer = { name: string; imageUrl: string | null };

/**
 * The billed acts, headliner first. SeatGeek marks one performer `primary`; the
 * rest keep their payload order, which is the running order often enough.
 */
export function sgPerformers(e: any): SgPerformer[] {
  const raw = Array.isArray(e?.performers) ? e.performers : [];
  const seen = new Set<string>();
  const out: SgPerformer[] = [];
  for (const p of [...raw].sort((a, b) => Number(b?.primary === true) - Number(a?.primary === true))) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const folded = name.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push({ name, imageUrl: typeof p?.image === 'string' && p.image ? p.image : null });
    if (out.length >= SG_LINEUP_MAX) break;
  }
  return out;
}

/** `stats.lowest_price` is the cheapest live listing; 0 means "no listings". */
function sgPrice(e: any): number | null {
  const low = e?.stats?.lowest_price;
  return typeof low === 'number' && low > 0 ? low : null;
}

/**
 * Pure mapping, so it can be tested against a recorded payload. `artistIdFor`
 * takes a case-folded performer name and returns the artist row it resolved to —
 * resolution needs the database, mapping doesn't.
 *
 * `enddatetime_utc` is deliberately ignored. It looks like data and isn't: across
 * a recorded San Francisco page, 45 of 49 events ended exactly 90 minutes after
 * they started and the other 4 exactly 60, so it's a template SeatGeek fills in
 * rather than a time anyone published. Carrying it would print a made-up "ends at"
 * on every show, and worse, fill that field on Ticketmaster rows that are honestly
 * empty today.
 */
export function sgToEventInputs(
  sgEvents: any[],
  artistIdFor: (foldedName: string) => string | undefined,
): EventInput[] {
  return sgEvents.flatMap((e: any) => {
    // `date_tbd` means there is nothing to anchor the show to; skipped.
    // `time_tbd` means only the set time isn't announced — SeatGeek fills the
    // slot with 03:30 local, so the timestamp is a template, not a fact. The
    // show still exists and is buyable, so it goes in pinned to noon at the
    // venue with `time_unknown` set. `mergeShow` never lets that placeholder
    // displace a real time, and the flag clears the moment one is published.
    if (!e?.id || e.date_tbd === true) return [];
    const timeUnknown = e.time_tbd === true;
    const startsAt = timeUnknown ? sgNoonUtc(e) : sgUtc(e);
    if (!startsAt) return [];
    const performers = sgPerformers(e);
    const headliner = performers[0];
    if (!headliner) return [];
    const artistId = artistIdFor(headliner.name.toLowerCase());
    if (!artistId) return [];
    return [
      {
        source: 'seatgeek',
        source_event_id: String(e.id),
        name: e.title || e.short_title || `${headliner.name} @ ${e.venue?.name ?? 'TBA'}`,
        starts_at: startsAt,
        time_unknown: timeUnknown,
        ticket_url: typeof e.url === 'string' && e.url ? e.url : null,
        price_from: sgPrice(e),
        lineup: performers.length > 1 ? performers.map((p) => p.name) : null,
        artist_id: artistId,
        venue: sgVenue(e),
      },
    ];
  });
}

async function sgFetch(env: Env, path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, client_id: env.SEATGEEK_CLIENT_ID! });
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(`${SG_BASE}/${path}?${qs}`);
    if ((res.status === 429 || res.status >= 500) && attempt < SG_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    // A bad client_id is a 401 that would otherwise look like "no shows here".
    if (!res.ok) throw new Error(`SeatGeek ${path}: ${res.status}`);
    return res.json();
  }
}

/** Upcoming concerts near a point, soonest first, over at most `SG_MAX_PAGES`. */
async function sgEventsNear(env: Env, lat: number, lng: number, radiusMiles: number): Promise<any[]> {
  const range = `${Math.min(Math.max(Math.round(radiusMiles), 1), 150)}mi`;
  const out: any[] = [];
  for (let page = 1; page <= SG_MAX_PAGES; page++) {
    const json = await sgFetch(env, 'events', {
      lat: String(lat),
      lon: String(lng),
      range,
      'taxonomies.name': 'concert',
      'datetime_utc.gte': nowIso().slice(0, 19),
      sort: 'datetime_utc.asc',
      per_page: String(SG_PER_PAGE),
      page: String(page),
    });
    const batch = Array.isArray(json?.events) ? json.events : [];
    out.push(...batch);
    // Short page means we've reached the end of the listing.
    if (batch.length < SG_PER_PAGE) break;
  }
  return out;
}

/**
 * One SeatGeek sweep of an area, persisted. Kept separate from the Ticketmaster
 * pass in `discover` so `/api/admin/stats` can attribute what each source added —
 * and because persisting them in two calls still merges duplicates: the second
 * pass finds the first pass's rows in D1 and folds into them.
 */
export async function ingestSeatGeek(
  env: Env,
  lat: number,
  lng: number,
  radius: number,
): Promise<{ scanned: number; ingested: number; artists_created: number; skipped?: string }> {
  const db = getDb(env.DB);
  if (!env.SEATGEEK_CLIENT_ID) return { scanned: 0, ingested: 0, artists_created: 0, skipped: 'SEATGEEK_CLIENT_ID not set' };

  const run = await startRun(db, 'seatgeek', 'discover');
  try {
    const sgEvents = await sgEventsNear(env, lat, lng, radius);
    // Headliners only: support acts live in `lineup`, and the crawl's frontier
    // expansion promotes them to artist rows at a rate D1's write quota can take.
    const headliners = sgEvents.flatMap((e) => sgPerformers(e).slice(0, 1));
    const { ids, created } = await ensureArtistsByName(db, headliners);
    const inputs = sgToEventInputs(sgEvents, (folded) => ids.get(folded));
    const newIds = await persist(db, inputs);
    await finishRun(db, run, {
      scanned: sgEvents.length,
      inserted: newIds.length,
      note: `${created} new artist(s)`,
    });
    return { scanned: sgEvents.length, ingested: newIds.length, artists_created: created };
  } catch (err) {
    await finishRun(db, run, { failed: 1, note: String(err).slice(0, 200) });
    throw err;
  }
}

// --- Ingestion orchestrators ------------------------------------------------

/**
 * Sweep an area for shows. Both geographic sources are asked — Ticketmaster for
 * the ticketed catalogue, SeatGeek for the clubs it doesn't list — and the
 * six-hour throttle covers the pair, since they cost one round trip each to the
 * same question.
 */
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

  // Each source is isolated: one upstream being down must not discard what the
  // other already ingested, in either direction.
  const failed: string[] = [];
  let attempted = 0;

  let tmScanned = 0;
  let tmIngested = 0;
  if (env.TICKETMASTER_API_KEY) {
    attempted++;
    const run = await startRun(db, 'ticketmaster', 'discover');
    try {
      const tmEvents = await tmEventsNear(env, lat, lng, radius);
      const inputs: EventInput[] = [];
      for (const e of tmEvents) {
        const artistId = await upsertTmArtist(db, e._embedded?.attractions?.[0]);
        if (!artistId) continue;
        const input = tmToEventInput(e, artistId);
        if (input) inputs.push(input);
      }
      tmScanned = tmEvents.length;
      tmIngested = (await persist(db, inputs)).length;
      await finishRun(db, run, { scanned: tmScanned, inserted: tmIngested });
    } catch (err) {
      console.error('ticketmaster discover failed:', err);
      await finishRun(db, run, { scanned: tmScanned, failed: 1, note: String(err).slice(0, 200) });
      failed.push('ticketmaster');
    }
  }

  let sg = { scanned: 0, ingested: 0, artists_created: 0 } as Awaited<ReturnType<typeof ingestSeatGeek>>;
  if (env.SEATGEEK_CLIENT_ID) {
    attempted++;
    try {
      sg = await ingestSeatGeek(env, lat, lng, radius);
    } catch (err) {
      console.error('seatgeek discover failed:', err);
      failed.push('seatgeek');
    }
  }

  // Every source down is an outage, not an empty area — surface it as an error so
  // the caller can retry, rather than reporting a successful sweep of nothing.
  if (attempted > 0 && failed.length === attempted) {
    throw new Error(`discover failed for every source: ${failed.join(', ')}`);
  }
  // Only throttle the area when the whole sweep worked. A partial failure marked
  // "fetched" would lock the missing source out for six hours; re-running the
  // source that did succeed costs a request and inserts nothing. `attempted`
  // matters too: with no source configured there is nothing to throttle, and
  // recording the cell would suppress the first real sweep after a key arrives.
  if (attempted > 0 && failed.length === 0) {
    await db
      .insert(discoveryLog)
      .values({ cell, fetchedAt: nowIso() })
      .onConflictDoUpdate({ target: discoveryLog.cell, set: { fetchedAt: sql`excluded.fetched_at` } });
  }
  return {
    ingested: tmIngested + sg.ingested,
    scanned: tmScanned + sg.scanned,
    ...(failed.length ? { failed } : {}),
    by_source: {
      ticketmaster: { scanned: tmScanned, ingested: tmIngested },
      seatgeek: { scanned: sg.scanned, ingested: sg.ingested, artists_created: sg.artists_created },
    },
  };
}

export async function refreshArtists(env: Env, incoming: IncomingArtist[]) {
  const db = getDb(env.DB);
  const run = await startRun(db, 'ticketmaster+bandsintown', 'refresh-artists');
  const newIds: string[] = [];
  let failed = 0;
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
      failed++;
      console.error(`refresh failed for ${a.name}: ${err}`);
    }
  }
  await touchArtistsRequested(db, touched);
  // We just fetched their Bandsintown dates, so the crawl needn't repeat that
  // immediately — one hot interval from now is soon enough. `enqueue` only
  // inserts, so already-queued artists are deferred separately or the crawl would
  // spend its next batch re-fetching what this request just fetched.
  const soon = nextCheckAt(TIER_HOURS.hot);
  await enqueueArtistSources(
    db,
    touched.map((artistId) => ({ artistId, source: 'bandsintown', nextCheckAt: soon })),
  );
  await deferArtistSources(db, touched, 'bandsintown', soon);
  await finishRun(db, run, { scanned: touched.length, inserted: newIds.length, failed });
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

// --- Venues -----------------------------------------------------------------

/**
 * Everything the venue page needs beyond its calendar: the derived stats, plus a
 * description and photo if Wikipedia has them.
 *
 * The stats always come back. The Wikipedia half is fetched at most once per venue
 * and then read from the row, keyed on `enrichment_checked_at` — which records the
 * *attempt*, because most venues have no article and without it every view would
 * re-ask about a club Wikipedia has never heard of.
 *
 * Writing the cache is deliberately not awaited by the caller's critical path
 * beyond the update itself, and a failed write is swallowed: a page that renders
 * with a description it will fetch again next time is strictly better than a page
 * that 500s because D1 was busy.
 */
/**
 * How long a "Wikipedia had nothing" answer stays believed. Articles get written —
 * a room that had none the day we asked may well have one next month — so an empty
 * result is re-asked on this cadence, paid for by whoever views the page next.
 */
const ENRICHMENT_EMPTY_RECHECK_MS = 30 * 86_400_000;
/**
 * And how long a *found* description does. Much longer, because an article that
 * exists mostly just gets edited, not deleted — this exists so a renamed or
 * corrected article is eventually picked up, not to keep prose fresh.
 */
const ENRICHMENT_FOUND_RECHECK_MS = 180 * 86_400_000;

/**
 * Exported for the spec. `checkedAt` written once and never revisited meant a
 * venue that had no article the day we asked could never gain one.
 */
export function shouldRecheckEnrichment(
  checkedAt: string | null,
  description: string | null,
  now: number,
): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  // An unparseable stamp reads as "never checked" — re-asking is the cheap error.
  if (Number.isNaN(at)) return true;
  return now - at > (description ? ENRICHMENT_FOUND_RECHECK_MS : ENRICHMENT_EMPTY_RECHECK_MS);
}

export async function venueInfo(env: Env, venueId: string) {
  const db = getDb(env.DB);
  // Resolve the cluster head first, by primary key, then read it by primary key.
  // Two indexed lookups rather than one `coalesce(canonical_venue_id, id) = ?`,
  // which isn't sargable and scans the whole venues table.
  const head =
    (
      await db
        .select({ head: sql<string>`coalesce(${venues.canonicalVenueId}, ${venues.id})` })
        .from(venues)
        .where(eq(venues.id, venueId))
        .get()
    )?.head ?? null;
  if (!head) return null;

  const row = await db
    .select({
      id: venues.id,
      name: venues.name,
      city: venues.city,
      lat: venues.lat,
      lng: venues.lng,
      description: venues.description,
      descriptionUrl: venues.descriptionUrl,
      photoUrl: venues.photoUrl,
      photoCredit: venues.photoCredit,
      photoLicense: venues.photoLicense,
      photoLicenseUrl: venues.photoLicenseUrl,
      checkedAt: venues.enrichmentCheckedAt,
    })
    .from(venues)
    // The head owns the description, as it owns the name and the coordinates.
    .where(eq(venues.id, head))
    .get();
  if (!row) return null;

  const stats = await venueStats(db, row.id);

  let enrichment: VenueEnrichment = {
    description: row.description,
    descriptionUrl: row.descriptionUrl,
    photoUrl: row.photoUrl,
    photoCredit: row.photoCredit,
    photoLicense: row.photoLicense,
    photoLicenseUrl: row.photoLicenseUrl,
  };
  if (shouldRecheckEnrichment(row.checkedAt, row.description, Date.now())) {
    const fresh = await fetchVenueEnrichment(row);
    // A re-check that comes back empty over a row that has prose keeps the prose.
    // `fetchVenueEnrichment` answers EMPTY for "no article" and for "Wikipedia was
    // unreachable" alike, and a transient failure must not delete a description
    // people have been reading for six months. The stamp still advances either
    // way, so a failure doesn't turn into a fetch per page view.
    if (fresh.description || !row.description) enrichment = fresh;
    try {
      await db
        .update(venues)
        .set({ ...enrichment, enrichmentCheckedAt: nowIso() })
        .where(eq(venues.id, row.id));
    } catch (err) {
      console.warn(`venueInfo: could not cache enrichment for ${row.id}`, err);
    }
  }

  return {
    description: enrichment.description,
    description_url: enrichment.descriptionUrl,
    // The comment used to promise this and the guard didn't keep it: a photo went
    // out on the licence alone, which renders as "PHOTO · CC BY-SA 4.0" — a credit
    // line with nobody in it. Stricter than CC strictly requires (attribution is of
    // the author "if supplied"), and deliberately so: an image is decoration and a
    // licence question on a public site is not. Costs nothing measurable — all four
    // enriched venues in production carry a credit.
    photo: enrichment.photoUrl && enrichment.photoLicense && enrichment.photoCredit
      ? {
          url: enrichment.photoUrl,
          credit: enrichment.photoCredit,
          license: enrichment.photoLicense,
          license_url: enrichment.photoLicenseUrl,
        }
      : null,
    stats,
  };
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
