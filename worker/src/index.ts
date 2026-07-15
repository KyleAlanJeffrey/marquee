import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

import { getDb } from './db';
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

// --- Request schemas --------------------------------------------------------

const artistRef = z.object({
  artistId: z.string().nullish(),
  spotifyId: z.string().nullish(),
  name: z.string().optional(),
  imageUrl: z.string().nullish(),
  genres: z.array(z.string()).optional().default([]),
});

const schemas = {
  nearby: z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
    radius: z.coerce.number().positive().max(1000).optional().default(50),
    limit: z.coerce.number().int().positive().max(400).optional().default(400),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
  page: z.object({
    limit: z.coerce.number().int().positive().max(50).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
  search: z.object({ query: z.string().trim().min(1) }),
  ensure: artistRef.refine((b) => b.spotifyId || b.artistId, {
    message: 'spotifyId or artistId is required',
  }),
  discover: z.object({
    lat: z.number(),
    lng: z.number(),
    radius: z.number().positive().max(1000).optional().default(50),
  }),
  refreshArtists: z.object({
    artists: z.array(artistRef.extend({ name: z.string().min(1) })).min(1),
  }),
};

api.get('/', (c) => c.json({ ok: true, service: 'marquee' }));

// --- Reads ------------------------------------------------------------------

api.get('/nearby', zValidator('query', schemas.nearby), async (c) => {
  const { lat, lng, radius, limit, offset } = c.req.valid('query');
  return c.json(await nearbyEvents(getDb(c.env.DB), lat, lng, radius, limit, offset));
});

api.get('/artists/:id', async (c) => {
  const artist = await artistById(getDb(c.env.DB), c.req.param('id'));
  return artist ? c.json(artist) : c.json({ error: 'not found' }, 404);
});

api.get('/artists/:id/events', async (c) => {
  return c.json(await artistEvents(getDb(c.env.DB), c.req.param('id')));
});

api.get('/artists/:id/info', async (c) => {
  const empty = { spotify_url: null, image_url: null, followers: null, bio: null, bio_url: null, top_tracks: [] };
  try {
    const data = await artistInfo(c.env, c.req.param('id'));
    return data ? c.json(data) : c.json({ error: 'not found' }, 404);
  } catch (err) {
    console.error(err);
    return c.json(empty);
  }
});

api.get('/events/:id', async (c) => {
  const event = await eventById(getDb(c.env.DB), c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
});

api.get('/venues/:id', async (c) => {
  const venue = await venueById(getDb(c.env.DB), c.req.param('id'));
  return venue ? c.json(venue) : c.json({ error: 'not found' }, 404);
});

api.get('/venues/:id/events', zValidator('query', schemas.page), async (c) => {
  const { limit, offset } = c.req.valid('query');
  return c.json(await venueEvents(getDb(c.env.DB), c.req.param('id'), limit, offset));
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

api.post('/search-artists', zValidator('json', schemas.search), async (c) => {
  const { query } = c.req.valid('json');
  if (!c.env.SPOTIFY_CLIENT_ID) return c.json({ artists: [], error: 'Spotify not configured' });
  try {
    return c.json({ artists: await searchArtists(c.env, query) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Resolve/create an artist (e.g. from a Spotify search hit) so we can open
// their page even before any of their shows have been ingested.
api.post('/artists/ensure', zValidator('json', schemas.ensure), async (c) => {
  const b = c.req.valid('json');
  const artist = await ensureArtistRecord(c.env, {
    artistId: b.artistId ?? null,
    spotifyId: b.spotifyId ?? null,
    name: b.name ?? '',
    imageUrl: b.imageUrl ?? null,
    genres: b.genres,
  });
  return artist ? c.json(artist) : c.json({ error: 'could not resolve artist' }, 400);
});

// --- Ingestion (client-driven) ---------------------------------------------

api.post('/discover-events', zValidator('json', schemas.discover), async (c) => {
  const { lat, lng, radius } = c.req.valid('json');
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 });
  try {
    return c.json(await discover(c.env, lat, lng, radius));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});

api.post('/refresh-artist-events', zValidator('json', schemas.refreshArtists), async (c) => {
  const { artists } = c.req.valid('json');
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
