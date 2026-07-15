import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { nearbyEvents } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { discoverBody, nearbyQuery, refreshArtistsBody } from '../schemas';
import { discover, refreshArtists } from '../sources';

export const feed = new Hono<AppEnv>();

// Read: upcoming shows near a point (bbox + haversine, cursor-paginated).
feed.get('/nearby', zValidator('query', nearbyQuery), async (c) => {
  const { lat, lng, radius, limit, offset } = c.req.valid('query');
  return c.json(await nearbyEvents(getDb(c.env.DB), lat, lng, radius, limit, offset));
});

// Client-driven ingestion: pull fresh shows for an area (server-throttled).
feed.post('/discover-events', zValidator('json', discoverBody), async (c) => {
  const { lat, lng, radius } = c.req.valid('json');
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 });
  try {
    return c.json(await discover(c.env, lat, lng, radius));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});

// Client-driven ingestion: pull upcoming shows for a set of followed artists.
feed.post('/refresh-artist-events', zValidator('json', refreshArtistsBody), async (c) => {
  const { artists } = c.req.valid('json');
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 });
  try {
    return c.json(await refreshArtists(c.env, artists));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});
