import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { nearbyVenues, venueById, venueEvents } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { nearbyVenuesQuery, pageQuery } from '../schemas';
import { refreshVenue } from '../sources';

export const venues = new Hono<AppEnv>();

// Registered before `/:id`, which would otherwise match "nearby" as a venue id.
venues.get('/nearby', zValidator('query', nearbyVenuesQuery), async (c) => {
  const { lat, lng, radius, limit } = c.req.valid('query');
  return c.json({ items: await nearbyVenues(getDb(c.env.DB), lat, lng, radius, limit) });
});

venues.get('/:id', async (c) => {
  const venue = await venueById(getDb(c.env.DB), c.req.param('id'));
  return venue ? c.json(venue) : c.json({ error: 'not found' }, 404);
});

venues.get('/:id/events', zValidator('query', pageQuery), async (c) => {
  const { limit, offset } = c.req.valid('query');
  return c.json(await venueEvents(getDb(c.env.DB), c.req.param('id'), limit, offset));
});

venues.post('/:id/refresh', async (c) => {
  if (!c.env.TICKETMASTER_API_KEY) return c.json({ error: 'Ticketmaster not configured', ingested: 0 }, 503);
  try {
    return c.json(await refreshVenue(c.env, c.req.param('id')));
  } catch (err) {
    console.error('venue refresh failed:', err);
    return c.json({ error: 'refresh failed', ingested: 0 }, 500);
  }
});
