import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { followingEvents, nearbyEvents } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { discoverBody, followingBody, nearbyQuery, refreshArtistsBody } from '../schemas';
import { discover, refreshArtists } from '../sources';

export const feed = new Hono<AppEnv>();

// Read: upcoming shows near a point (bbox + haversine, cursor-paginated).
feed.get('/nearby', zValidator('query', nearbyQuery), async (c) => {
  const { lat, lng, radius, limit, offset } = c.req.valid('query');
  return c.json(await nearbyEvents(getDb(c.env.DB), lat, lng, radius, limit, offset));
});

// Read: upcoming shows for the artists and venues held on the device. POST because
// somebody's whole follow list has no business sitting in a request log.
feed.post('/following', zValidator('json', followingBody), async (c) => {
  const { artistIds, spotifyIds, venueIds, lat, lng, radiusMiles } = c.req.valid('json');
  const items = await followingEvents(getDb(c.env.DB), {
    artistIds,
    spotifyIds,
    venueIds,
    lat,
    lng,
    radiusMiles,
  });
  return c.json({ items });
});

// Client-driven ingestion: pull fresh shows for an area (server-throttled).
feed.post('/discover-events', zValidator('json', discoverBody), async (c) => {
  const { lat, lng, radius } = c.req.valid('json');
  // Either geographic source is enough to make the sweep worth running.
  if (!c.env.TICKETMASTER_API_KEY && !c.env.SEATGEEK_CLIENT_ID) {
    return c.json({ error: 'no discovery source configured', ingested: 0 }, 503);
  }
  try {
    return c.json(await discover(c.env, lat, lng, radius));
  } catch (err) {
    // Log the detail; don't hand upstream internals to an unauthenticated caller.
    console.error('discover-events failed:', err);
    return c.json({ error: 'discovery failed', ingested: 0 }, 500);
  }
});

// Client-driven ingestion: pull upcoming shows for a set of followed artists.
feed.post('/refresh-artist-events', zValidator('json', refreshArtistsBody), async (c) => {
  const { artists } = c.req.valid('json');
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 }, 503);
  try {
    return c.json(await refreshArtists(c.env, artists));
  } catch (err) {
    console.error('refresh-artist-events failed:', err);
    return c.json({ error: 'refresh failed', ingested: 0 }, 500);
  }
});
