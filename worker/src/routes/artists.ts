import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { artistById, artistEvents, artistPastEvents, ensureArtistRecord } from '../data';
import { getDb } from '../db';
import type { AppEnv } from '../env';
import { ensureBody } from '../schemas';
import { artistInfo, fetchArtistHistory } from '../sources';

export const artists = new Hono<AppEnv>();

artists.get('/:id', async (c) => {
  const artist = await artistById(getDb(c.env.DB), c.req.param('id'));
  return artist ? c.json(artist) : c.json({ error: 'not found' }, 404);
});

artists.get('/:id/events', async (c) => {
  return c.json(await artistEvents(getDb(c.env.DB), c.req.param('id')));
});

/**
 * The shows of theirs that have already happened — what "I saw them before" reads.
 *
 * A plain read, so it is fast and cacheable and returns nothing surprising if the
 * history has never been fetched. Filling it is the POST below.
 */
artists.get('/:id/past-events', async (c) => {
  return c.json(await artistPastEvents(getDb(c.env.DB), c.req.param('id')));
});

/**
 * Fetch this artist's history from upstream, once.
 *
 * A POST because it writes, and separate from the GET above so that opening an artist
 * page never costs an upstream request — the client asks for this only when somebody
 * actually wants to log a past show. Calling it repeatedly is cheap: the second call
 * reads the stamp and returns without going out.
 *
 * Not behind the write gate. It adds nothing personal, it only makes the shared
 * catalogue more complete, and requiring an account to *look* for a gig you went to
 * would put the sign-in wall in front of the one thing that makes signing in worth
 * anything.
 */
artists.post('/:id/history', async (c) => {
  try {
    const result = await fetchArtistHistory(c.env, c.req.param('id'));
    return result ? c.json(result) : c.json({ error: 'not found' }, 404);
  } catch (err) {
    // An upstream 429 or 5xx raises, and it says nothing about this artist. Answer
    // 503 so the client can offer a retry rather than caching a wrong "no history".
    console.error('artist history failed:', err);
    return c.json({ error: 'could not reach the history source' }, 503);
  }
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
