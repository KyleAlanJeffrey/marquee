import { eq, sql } from 'drizzle-orm';

import {
  ensureArtist,
  nowIso,
  persist,
  upsertTmArtist,
  type EventInput,
  type IncomingArtist,
  type VenueRow,
} from './data';
import { getDb, type DB } from './db';
import type { Env } from './env';
import { artists, discoveryLog, events, venues } from './schema';

// --- Ticketmaster -----------------------------------------------------------

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';

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
  const bitEvents = await res.json();
  if (!Array.isArray(bitEvents)) return [];
  return bitEvents.flatMap((e: any) => {
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

// --- Spotify ----------------------------------------------------------------

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

// --- Deezer (open API, no key) ----------------------------------------------

/** Top tracks + fan count from Deezer's open API. Each track carries a 30s
 *  preview mp3 and a link to the full track. */
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

// --- Wikipedia --------------------------------------------------------------

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

// --- Buzz (Bluesky) ---------------------------------------------------------

/** Real posts about a show from Bluesky's open search API (no key). Tries the
 *  artist + venue first (show-specific), then falls back to the artist alone. */
async function blueskyPosts(artist: string, venue: string | null): Promise<any[]> {
  const search = async (q: string) => {
    const r = await fetch(
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
      likes: p.likeCount ?? 0,
      replies: p.replyCount ?? 0,
      reposts: p.repostCount ?? 0,
      created_at: p.record.createdAt ?? null,
      url: `https://bsky.app/profile/${p.author.handle}/post/${String(p.uri).split('/').pop()}`,
    }));
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
