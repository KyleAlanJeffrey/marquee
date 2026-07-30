import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { eventById, eventsByIds } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { eventIdsBody } from '../schemas';
import { eventBuzz, eventLineup } from '../sources';

export const events = new Hono<AppEnv>();

/**
 * Current rows for a client's saved list. A POST because the ids are a list the
 * device owns, not an addressable resource — and a saved list in a query string
 * would end up in logs.
 */
events.post('/by-ids', zValidator('json', eventIdsBody), async (c) => {
  const { ids } = c.req.valid('json');
  return c.json({ items: await eventsByIds(getDb(c.env.DB), ids) });
});

events.get('/:id', async (c) => {
  const event = await eventById(getDb(c.env.DB), c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
});

// Supporting acts for the show (Ticketmaster attractions, best-effort).
events.get('/:id/lineup', async (c) => {
  try {
    return c.json(await eventLineup(c.env, c.req.param('id')));
  } catch (err) {
    console.error(err);
    return c.json({ support: [] });
  }
});

// Real discussion about the show (Bluesky, best-effort).
events.get('/:id/buzz', async (c) => {
  try {
    return c.json(await eventBuzz(c.env, c.req.param('id')));
  } catch (err) {
    console.error(err);
    return c.json({ posts: [] });
  }
});
