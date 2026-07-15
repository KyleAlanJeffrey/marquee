import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  artistById,
  artistEvents,
  artistInfo,
  discover,
  ensureArtistRecord,
  eventById,
  nearbyEvents,
  refreshArtists,
  refreshVenue,
  searchArtists,
  venueById,
  venueEvents,
  type Env,
} from './lib';

// The Worker runs first for every request (run_worker_first). It handles the
// API under /api/* and hands everything else to the static assets (the Expo web
// build), which include an SPA fallback for client-routed deep links.
const api = new Hono<{ Bindings: Env }>().basePath('/api');

api.use('*', cors());

api.get('/', (c) => c.json({ ok: true, service: 'marquee' }));

// --- Reads ------------------------------------------------------------------

api.get('/nearby', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  const radius = Number(c.req.query('radius') ?? 50);
  const limit = Math.min(Number(c.req.query('limit') ?? 400) || 400, 400);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }
  return c.json(await nearbyEvents(c.env.DB, lat, lng, Number.isFinite(radius) ? radius : 50, limit, offset));
});

api.get('/artists/:id', async (c) => {
  const artist = await artistById(c.env.DB, c.req.param('id'));
  return artist ? c.json(artist) : c.json({ error: 'not found' }, 404);
});

api.get('/artists/:id/events', async (c) => {
  return c.json(await artistEvents(c.env.DB, c.req.param('id')));
});

api.get('/artists/:id/info', async (c) => {
  const empty = {
    spotify_url: null,
    image_url: null,
    followers: null,
    bio: null,
    bio_url: null,
    top_tracks: [],
  };
  try {
    const data = await artistInfo(c.env, c.req.param('id'));
    return data ? c.json(data) : c.json({ error: 'not found' }, 404);
  } catch (err) {
    console.error(err);
    return c.json(empty);
  }
});

api.get('/events/:id', async (c) => {
  const event = await eventById(c.env.DB, c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
});

api.get('/venues/:id', async (c) => {
  const venue = await venueById(c.env.DB, c.req.param('id'));
  return venue ? c.json(venue) : c.json({ error: 'not found' }, 404);
});

api.get('/venues/:id/events', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 50);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  return c.json(await venueEvents(c.env.DB, c.req.param('id'), limit, offset));
});

api.post('/venues/:id/refresh', async (c) => {
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ ingested: 0 });
  try {
    return c.json(await refreshVenue(c.env, c.req.param('id')));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err), ingested: 0 }, 500);
  }
});

// --- Spotify search ---------------------------------------------------------

api.post('/search-artists', async (c) => {
  const { query } = await c.req.json().catch(() => ({}));
  if (!query || typeof query !== 'string') return c.json({ error: 'query is required' }, 400);
  if (!c.env.SPOTIFY_CLIENT_ID) return c.json({ artists: [], error: 'Spotify not configured' });
  try {
    return c.json({ artists: await searchArtists(c.env, query.trim()) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Resolve/create an artist (e.g. from a Spotify search hit) so we can open
// their page even before any of their shows have been ingested.
api.post('/artists/ensure', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b?.spotifyId && !b?.artistId) return c.json({ error: 'spotifyId or artistId required' }, 400);
  if (!b?.name && !b?.artistId) return c.json({ error: 'name required' }, 400);
  const artist = await ensureArtistRecord(c.env, {
    artistId: b.artistId ?? null,
    spotifyId: b.spotifyId ?? null,
    name: b.name,
    imageUrl: b.imageUrl ?? null,
    genres: Array.isArray(b.genres) ? b.genres : [],
  });
  return artist ? c.json(artist) : c.json({ error: 'could not resolve artist' }, 400);
});

// --- Ingestion (client-driven) ---------------------------------------------

api.post('/discover-events', async (c) => {
  const { lat, lng, radius = 50 } = await c.req.json().catch(() => ({}));
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 });
  try {
    return c.json(await discover(c.env, lat, lng, radius));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});

api.post('/refresh-artist-events', async (c) => {
  const { artists } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(artists) || artists.length === 0) return c.json({ error: 'artists array required', ingested: 0 }, 400);
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 });
  try {
    return c.json(await refreshArtists(c.env, artists));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});

// Root app: API first, then static assets for everything else.
const app = new Hono<{ Bindings: Env }>();
app.route('/', api);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
