import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  artistById,
  artistEvents,
  discover,
  eventById,
  nearbyEvents,
  refreshArtists,
  searchArtists,
  type Env,
} from './lib';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/', (c) => c.json({ ok: true, service: 'marquee-worker' }));

// --- Reads ------------------------------------------------------------------

app.get('/nearby', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  const radius = Number(c.req.query('radius') ?? 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }
  return c.json(await nearbyEvents(c.env.DB, lat, lng, Number.isFinite(radius) ? radius : 50));
});

app.get('/artists/:id', async (c) => {
  const artist = await artistById(c.env.DB, c.req.param('id'));
  return artist ? c.json(artist) : c.json({ error: 'not found' }, 404);
});

app.get('/artists/:id/events', async (c) => {
  return c.json(await artistEvents(c.env.DB, c.req.param('id')));
});

app.get('/events/:id', async (c) => {
  const event = await eventById(c.env.DB, c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
});

// --- Spotify search ---------------------------------------------------------

app.post('/search-artists', async (c) => {
  const { query } = await c.req.json().catch(() => ({}));
  if (!query || typeof query !== 'string') return c.json({ error: 'query is required' }, 400);
  if (!c.env.SPOTIFY_CLIENT_ID) return c.json({ artists: [], error: 'Spotify not configured' });
  try {
    return c.json({ artists: await searchArtists(c.env, query.trim()) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// --- Ingestion (client-driven) ---------------------------------------------

app.post('/discover-events', async (c) => {
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

app.post('/refresh-artist-events', async (c) => {
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

export default app;
