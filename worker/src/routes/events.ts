import { Hono } from 'hono';

import { eventById } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';

export const events = new Hono<AppEnv>();

events.get('/:id', async (c) => {
  const event = await eventById(getDb(c.env.DB), c.req.param('id'));
  return event ? c.json(event) : c.json({ error: 'not found' }, 404);
});
