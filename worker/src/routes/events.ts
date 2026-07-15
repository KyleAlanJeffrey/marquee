import { Hono } from 'hono';

import { eventById } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { eventBuzz } from '../sources';

export const events = new Hono<AppEnv>();

events.get('/:id', async (c) => {
  const event = await eventById(getDb(c.env.DB), c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
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
