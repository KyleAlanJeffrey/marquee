import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { and, between, eq, gte, lte, sql } from 'drizzle-orm';

import { getDb, type DB } from './db';
import { artists, discoveryLog, events, venues } from './schema';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TICKETMASTER_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  BANDSINTOWN_APP_ID?: string;
};

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';

// --- helpers ----------------------------------------------------------------

export const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 19) + 'Z';

function parseGenres(text: unknown): string[] {
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

type VenueRow = {
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
    venue: r.v_name ? { id: r.v_id, name: r.v_name, city: r.v_city, region: r.v_region } : null,
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
    .orderBy(events.startsAt)
    .limit(limit)
    .offset(offset);
  const items = rows.map((r) => ({ ...r, artist_genres: parseGenres(r.artist_genres) }));
  return { items, nextCursor: rows.length === limit ? offset + limit : null };
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

// --- Persistence ------------------------------------------------------------

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

async function upsertTmArtist(db: DB, attraction: any): Promise<string | null> {
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
      imageUrl: attraction.images?.[0]?.url ?? null,
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

// --- Ticketmaster -----------------------------------------------------------

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
  const res = await fetch(`${TM_BASE}/${path}?${qs}`);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    return tmFetch(env, path, params);
  }
  if (!res.ok) throw new Error(`Ticketmaster ${path}: ${res.status}`);
  return res.json();
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

// --- Bandsintown ------------------------------------------------------------

async function bitEventsForArtist(
  env: Env,
  artist: { id: string; name: string; bandsintown_name: string | null },
): Promise<EventInput[]> {
  if (!env.BANDSINTOWN_APP_ID) return [];
  const name = artist.bandsintown_name ?? artist.name;
  const res = await fetch(
    `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${env.BANDSINTOWN_APP_ID}&date=upcoming`,
  );
  if (!res.ok) return [];
  const events = await res.json();
  if (!Array.isArray(events)) return [];
  return events.flatMap((e: any) => {
    if (!e.datetime || !e.id) return [];
    const { lat, lng } = wkt(e.venue?.longitude, e.venue?.latitude);
    return [
      {
        source: 'bandsintown',
        source_event_id: String(e.id),
        name: e.title || `${artist.name} @ ${e.venue?.name ?? 'TBA'}`,
        starts_at: new Date(e.datetime).toISOString().slice(0, 19) + 'Z',
        ticket_url: e.offers?.[0]?.url ?? e.url ?? null,
        price_from: null,
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

// --- Public operations ------------------------------------------------------

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

type IncomingArtist = {
  artistId?: string | null;
  spotifyId?: string | null;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
};

type ArtistIdentity = { id: string; name: string; ticketmaster_id: string | null; bandsintown_name: string | null };

async function ensureArtist(db: DB, a: IncomingArtist): Promise<ArtistIdentity | null> {
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

export async function refreshArtists(env: Env, incoming: IncomingArtist[]) {
  const db = getDb(env.DB);
  const newIds: string[] = [];
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
      inputs.push(
        ...(await bitEventsForArtist(env, { id: targetId, name: row.name, bandsintown_name: row.bandsintown_name })),
      );
      newIds.push(...(await persist(db, inputs)));
    } catch (err) {
      console.error(`refresh failed for ${a.name}: ${err}`);
    }
  }
  return { ingested: newIds.length };
}

// --- Spotify search ---------------------------------------------------------

let spotifyToken: { value: string; expiresAt: number } | null = null;

async function spotifyAccessToken(env: Env): Promise<string> {
  if (spotifyToken && Date.now() < spotifyToken.expiresAt - 60_000) return spotifyToken.value;
  const id = env.SPOTIFY_CLIENT_ID;
  const secret = env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify credentials not configured');
  const res = await fetch('https://accounts.spotify.com/api/token', {
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
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
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

/** Top tracks + fan count from Deezer's open API (no key required). Each track
 *  carries a 30s preview mp3 and a link to the full track. */
async function deezerTopTracks(name: string): Promise<{ tracks: any[]; fans: number | null }> {
  const search = await fetch(`https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`).then((r) =>
    r.json<any>(),
  );
  const artist = search.data?.[0];
  if (!artist?.id) return { tracks: [], fans: null };
  const top = await fetch(`https://api.deezer.com/artist/${artist.id}/top?limit=5`).then((r) => r.json<any>());
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

/** A short artist bio from Wikipedia (CC BY-SA — shown with attribution). */
async function wikipediaBio(name: string): Promise<{ text: string; url: string | null } | null> {
  const headers = { 'User-Agent': 'Marquee/1.0 (concert discovery app)', accept: 'application/json' };
  const summary = async (title: string) => {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers });
    if (!r.ok) return null;
    const j = await r.json<any>();
    if (!j.extract || j.type === 'disambiguation') return null;
    return { text: j.extract as string, url: j.content_urls?.desktop?.page ?? null };
  };
  let bio = await summary(name);
  if (!bio) {
    const s = await fetch(
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
