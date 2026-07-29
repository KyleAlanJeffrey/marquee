import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import type { AppEnv } from '../env';
import { searchBody } from '../schemas';
import { searchArtists } from '../sources';

export const search = new Hono<AppEnv>();

// Spotify catalog search for artists to follow.
search.post('/search-artists', zValidator('json', searchBody), async (c) => {
  const { query } = c.req.valid('json');
  // Both halves are needed: the client-credentials token call uses the secret.
  if (!c.env.SPOTIFY_CLIENT_ID || !c.env.SPOTIFY_CLIENT_SECRET) {
    return c.json({ artists: [], error: 'Spotify not configured' }, 503);
  }
  try {
    return c.json({ artists: await searchArtists(c.env, query) });
  } catch (err) {
    console.error('search-artists failed:', err);
    return c.json({ artists: [], error: 'search failed' }, 500);
  }
});
