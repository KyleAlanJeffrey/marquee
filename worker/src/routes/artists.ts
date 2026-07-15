import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { artistById, artistEvents, ensureArtistRecord } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { ensureBody } from '../schemas';
import { artistInfo } from '../sources';

export const artists = new Hono<AppEnv>();

artists.get('/:id', async (c) => {
  const artist = await artistById(getDb(c.env.DB), c.req.param('id'));
  return artist ? c.json(artist) : c.json({ error: 'not found' }, 404);
});

artists.get('/:id/events', async (c) => {
  return c.json(await artistEvents(getDb(c.env.DB), c.req.param('id')));
});

artists.get('/:id/info', async (c) => {
  const empty = { spotify_url: null, image_url: null, followers: null, bio: null, bio_url: null, top_tracks: [] };
  try {
    const data = await artistInfo(c.env, c.req.param('id'));
    return data ? c.json(data) : c.json({ error: 'not found' }, 404);
  } catch (err) {
    console.error(err);
    return c.json(empty);
  }
});

// Resolve/create an artist (e.g. from a Spotify search hit) so we can open
// their page even before any of their shows have been ingested.
artists.post('/ensure', zValidator('json', ensureBody), async (c) => {
  const b = c.req.valid('json');
  const artist = await ensureArtistRecord(c.env, {
    artistId: b.artistId ?? null,
    spotifyId: b.spotifyId ?? null,
    name: b.name ?? '',
    imageUrl: b.imageUrl ?? null,
    genres: b.genres,
  });
  return artist ? c.json(artist) : c.json({ error: 'could not resolve artist' }, 400);
});
