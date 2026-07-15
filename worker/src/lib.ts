import type { D1Database, Fetcher } from '@cloudflare/workers-types';

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
  db: D1Database,
  lat: number,
  lng: number,
  radiusMiles: number,
  limit = 400,
  offset = 0,
) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const rows = await db
    .prepare(
      `SELECT e.id event_id, e.name event_name, e.starts_at, e.ticket_url, e.price_from,
              a.id artist_id, a.name artist_name, a.image_url artist_image_url,
              a.spotify_id artist_spotify_id, a.genres artist_genres,
              v.name venue_name, v.city venue_city, v.region venue_region,
              v.lat venue_lat, v.lng venue_lng
       FROM events e
       JOIN artists a ON a.id = e.artist_id
       JOIN venues v ON v.id = e.venue_id
       WHERE e.starts_at >= ?1 AND e.starts_at <= ?2
         AND v.lat BETWEEN ?3 AND ?4 AND v.lng BETWEEN ?5 AND ?6
       ORDER BY e.starts_at
       LIMIT ?7 OFFSET ?8`,
    )
    .bind(nowIso(), isoInDays(120), lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, limit, offset)
    .all();

  const items = (rows.results as any[])
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
  const nextCursor = rows.results.length === limit ? offset + limit : null;
  return { items, nextCursor };
}

export async function artistById(db: D1Database, id: string) {
  const r = await db
    .prepare(`SELECT id, name, spotify_id, image_url, genres FROM artists WHERE id = ?1`)
    .bind(id)
    .first<any>();
  if (!r) return null;
  return { ...r, genres: parseGenres(r.genres) };
}

export async function artistEvents(db: D1Database, id: string) {
  const rows = await db
    .prepare(
      `SELECT e.id event_id, e.name event_name, e.starts_at, e.ticket_url, e.price_from,
              v.id venue_id, v.name venue_name, v.city venue_city, v.region venue_region
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.artist_id = ?1 AND e.starts_at >= ?2
       ORDER BY e.starts_at`,
    )
    .bind(id, nowIso())
    .all();
  return rows.results;
}

export async function eventById(db: D1Database, id: string) {
  const r = await db
    .prepare(
      `SELECT e.id, e.name, e.starts_at, e.ticket_url, e.price_from, e.source,
              a.id a_id, a.name a_name, a.spotify_id a_spotify, a.image_url a_image, a.genres a_genres,
              v.id v_id, v.name v_name, v.city v_city, v.region v_region
       FROM events e
       JOIN artists a ON a.id = e.artist_id
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ?1`,
    )
    .bind(id)
    .first<any>();
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
export async function venueById(db: D1Database, id: string) {
  return db
    .prepare(`SELECT id, name, city, region, lat, lng FROM venues WHERE id = ?1`)
    .bind(id)
    .first<any>();
}

/** A page of a venue's upcoming shows. */
export async function venueEvents(db: D1Database, id: string, limit = 20, offset = 0) {
  const rows = await db
    .prepare(
      `SELECT e.id event_id, e.name event_name, e.starts_at, e.ticket_url, e.price_from,
              a.id artist_id, a.name artist_name, a.image_url artist_image_url, a.genres artist_genres
       FROM events e
       JOIN artists a ON a.id = e.artist_id
       WHERE e.venue_id = ?1 AND e.starts_at >= ?2
       ORDER BY e.starts_at
       LIMIT ?3 OFFSET ?4`,
    )
    .bind(id, nowIso(), limit, offset)
    .all();
  const items = (rows.results as any[]).map((r) => ({ ...r, artist_genres: parseGenres(r.artist_genres) }));
  return { items, nextCursor: rows.results.length === limit ? offset + limit : null };
}

/** Pull this venue's full upcoming lineup from Ticketmaster into D1. Only works
 *  for Ticketmaster venues (seed venues have no TM id). Returns new-event count. */
export async function refreshVenue(env: Env, venueId: string): Promise<{ ingested: number }> {
  const v = await env.DB.prepare(`SELECT source, source_venue_id FROM venues WHERE id = ?1`)
    .bind(venueId)
    .first<any>();
  if (!v || v.source !== 'ticketmaster') return { ingested: 0 };

  const json = await tmFetch(env, 'events.json', {
    venueId: v.source_venue_id,
    size: '100',
    sort: 'date,asc',
    classificationName: 'music',
  });
  const events = json._embedded?.events ?? [];
  const inputs: EventInput[] = [];
  for (const e of events) {
    const artistId = await upsertTmArtist(env.DB, e._embedded?.attractions?.[0]);
    if (!artistId) continue;
    const input = tmToEventInput(e, artistId);
    if (input) inputs.push(input);
  }
  return { ingested: (await persist(env.DB, inputs)).length };
}

// --- Persistence ------------------------------------------------------------

/** Upsert venues + insert unseen events; returns ids of newly inserted events. */
export async function persist(db: D1Database, inputs: EventInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];

  // Venues: upsert each, map (source:id) -> venue uuid.
  const venues = new Map<string, VenueRow>();
  for (const i of inputs) if (i.venue) venues.set(`${i.venue.source}:${i.venue.source_venue_id}`, i.venue);

  const venueIdByKey = new Map<string, string>();
  const venueKeys = [...venues.keys()];
  if (venueKeys.length) {
    const stmts = venueKeys.map((k) => {
      const v = venues.get(k)!;
      return db
        .prepare(
          `INSERT INTO venues (id, source, source_venue_id, name, city, region, country, lat, lng)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
           ON CONFLICT (source, source_venue_id) DO UPDATE SET
             name = excluded.name, city = excluded.city, region = excluded.region,
             country = excluded.country, lat = excluded.lat, lng = excluded.lng
           RETURNING id`,
        )
        .bind(uuid(), v.source, v.source_venue_id, v.name, v.city, v.region, v.country, v.lat, v.lng);
    });
    const res = await db.batch<any>(stmts);
    res.forEach((r, idx) => {
      const id = r.results?.[0]?.id;
      if (id) venueIdByKey.set(venueKeys[idx], id);
    });
  }

  // Events: insert-if-new, RETURNING only new rows.
  const stmts = inputs.map((i) =>
    db
      .prepare(
        `INSERT INTO events (id, artist_id, venue_id, name, starts_at, ticket_url, price_from, source, source_event_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT (source, source_event_id) DO NOTHING
         RETURNING id`,
      )
      .bind(
        uuid(),
        i.artist_id,
        i.venue ? venueIdByKey.get(`${i.venue.source}:${i.venue.source_venue_id}`) ?? null : null,
        i.name,
        i.starts_at,
        i.ticket_url,
        i.price_from,
        i.source,
        i.source_event_id,
      ),
  );
  const res = await db.batch<any>(stmts);
  const newIds: string[] = [];
  for (const r of res) if (r.results?.[0]?.id) newIds.push(r.results[0].id);
  return newIds;
}

async function upsertTmArtist(db: D1Database, attraction: any): Promise<string | null> {
  if (!attraction?.id || !attraction?.name) return null;
  const genres = (attraction.classifications ?? [])
    .map((c: any) => c.genre?.name)
    .filter((g: string) => g && g !== 'Undefined');
  const r = await db
    .prepare(
      `INSERT INTO artists (id, ticketmaster_id, name, image_url, genres)
       VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT (ticketmaster_id) DO UPDATE SET
         name = excluded.name, image_url = excluded.image_url, genres = excluded.genres
       RETURNING id`,
    )
    .bind(uuid(), attraction.id, attraction.name, attraction.images?.[0]?.url ?? null, JSON.stringify(genres))
    .first<any>();
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
  const cell = `${lat.toFixed(1)},${lng.toFixed(1)},${Math.round(radius)}`;
  const log = await env.DB.prepare(`SELECT fetched_at FROM discovery_log WHERE cell = ?1`).bind(cell).first<any>();
  if (log && Date.now() - new Date(log.fetched_at).getTime() < 6 * 3600_000) {
    return { skipped: true, reason: 'recently fetched', ingested: 0 };
  }

  const events = await tmEventsNear(env, lat, lng, radius);
  const inputs: EventInput[] = [];
  for (const e of events) {
    const artistId = await upsertTmArtist(env.DB, e._embedded?.attractions?.[0]);
    if (!artistId) continue;
    const input = tmToEventInput(e, artistId);
    if (input) inputs.push(input);
  }
  const newIds = await persist(env.DB, inputs);
  await env.DB.prepare(
    `INSERT INTO discovery_log (cell, fetched_at) VALUES (?1, ?2)
     ON CONFLICT (cell) DO UPDATE SET fetched_at = excluded.fetched_at`,
  )
    .bind(cell, nowIso())
    .run();
  return { ingested: newIds.length, scanned: events.length };
}

type IncomingArtist = {
  artistId?: string | null;
  spotifyId?: string | null;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
};

async function ensureArtist(db: D1Database, a: IncomingArtist) {
  if (a.artistId) {
    const r = await db
      .prepare(`SELECT id, name, ticketmaster_id, bandsintown_name FROM artists WHERE id = ?1`)
      .bind(a.artistId)
      .first<any>();
    if (r) return r;
  }
  if (a.spotifyId) {
    return db
      .prepare(
        `INSERT INTO artists (id, spotify_id, name, image_url, genres)
         VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT (spotify_id) DO UPDATE SET
           name = excluded.name, image_url = excluded.image_url, genres = excluded.genres
         RETURNING id, name, ticketmaster_id, bandsintown_name`,
      )
      .bind(uuid(), a.spotifyId, a.name, a.imageUrl ?? null, JSON.stringify(a.genres ?? []))
      .first<any>();
  }
  return null;
}

/** Upsert a single artist (typically from a Spotify search result) and return
 *  the full stored record. Fast — no external event fetch; the artist screen
 *  pulls the schedule on open. */
export async function ensureArtistRecord(env: Env, a: IncomingArtist) {
  const row = await ensureArtist(env.DB, a);
  if (!row) return null;
  return artistById(env.DB, row.id);
}

export async function refreshArtists(env: Env, artists: IncomingArtist[]) {
  const newIds: string[] = [];
  for (const a of artists.slice(0, 25)) {
    if (!a?.name) continue;
    try {
      const row = await ensureArtist(env.DB, a);
      if (!row) continue;

      // Resolve the Ticketmaster attraction, reconciling with any existing row
      // that already owns that ticketmaster_id (e.g. one created by discovery),
      // so we neither collide on the unique key nor ingest onto a duplicate.
      let targetId: string = row.id;
      let tmId = row.ticketmaster_id as string | null;
      if (!tmId) {
        tmId = await tmResolveAttractionId(env, row.name);
        if (tmId) {
          const existing = await env.DB.prepare(`SELECT id FROM artists WHERE ticketmaster_id = ?1`)
            .bind(tmId)
            .first<any>();
          if (existing && existing.id !== row.id) targetId = existing.id;
          else await env.DB.prepare(`UPDATE artists SET ticketmaster_id = ?1 WHERE id = ?2`).bind(tmId, row.id).run();
        }
      }

      const inputs: EventInput[] = [];
      if (tmId) {
        const events = await tmEventsForAttraction(env, tmId);
        inputs.push(...events.flatMap((e) => tmToEventInput(e, targetId) ?? []));
      }
      inputs.push(...(await bitEventsForArtist(env, { id: targetId, name: row.name, bandsintown_name: row.bandsintown_name })));
      newIds.push(...(await persist(env.DB, inputs)));
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
async function spotifyProfile(env: Env, row: any): Promise<{ image: string | null; url: string | null } | null> {
  let sid: string | null = row.spotify_id;
  if (!sid) {
    const found = await spotifyGet(env, `/search?type=artist&limit=1&q=${encodeURIComponent(row.name)}`);
    sid = found.artists?.items?.[0]?.id ?? null;
    if (sid) {
      await env.DB.prepare(`UPDATE artists SET spotify_id = ?1 WHERE id = ?2`).bind(sid, row.id).run().catch(() => {});
    }
  }
  if (!sid) return null;
  const artist = await spotifyGet(env, `/artists/${sid}`);
  const image = artist.images?.[0]?.url ?? null;
  if (!row.image_url && image) {
    await env.DB.prepare(`UPDATE artists SET image_url = ?1 WHERE id = ?2`).bind(image, row.id).run().catch(() => {});
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
  const row = await env.DB.prepare(`SELECT id, name, spotify_id, image_url FROM artists WHERE id = ?1`)
    .bind(artistId)
    .first<any>();
  if (!row) return null;

  const [spotify, deezer, bio] = await Promise.all([
    (env.SPOTIFY_CLIENT_ID ? spotifyProfile(env, row) : Promise.resolve(null)).catch(() => null),
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
