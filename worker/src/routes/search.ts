import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import type { AppEnv } from '../env';
import { searchBody } from '../schemas';
import { searchArtists } from '../sources';

export const search = new Hono<AppEnv>();

// Spotify catalog search for artists to follow.
search.post('/search-artists', zValidator('json', searchBody), async (c) => {
  const { query } = c.req.valid('json');
  if (!c.env.SPOTIFY_CLIENT_ID) return c.json({ artists: [], error: 'Spotify not configured' });
  try {
    return c.json({ artists: await searchArtists(c.env, query) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
