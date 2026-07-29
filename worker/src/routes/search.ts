import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { searchTowns } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { searchBody, townsQuery } from '../schemas';
import { searchArtists } from '../sources';

export const search = new Hono<AppEnv>();

// Towns with upcoming shows. Unlike artist search this is answered from our own
// data, so it needs no Spotify key.
search.get('/towns', zValidator('query', townsQuery), async (c) => {
  const { q, limit } = c.req.valid('query');
  try {
    return c.json({ towns: await searchTowns(getDb(c.env.DB), q, limit) });
  } catch (err) {
    console.error('towns failed:', err);
    return c.json({ towns: [], error: 'search failed' }, 500);
  }
});

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
