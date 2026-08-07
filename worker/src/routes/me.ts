import { zValidator } from '@hono/zod-validator';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, deleteAccount, ensureUser, findUser, syncProfileFromClerk } from '../auth';
import { getDb } from '../db';
import { artists, users } from '../schema';
import type { AppEnv } from '../env';
import { favoritesBody, prefsBody } from '../schemas';
import { spotifySuggestions } from '../spotify-me';

/**
 * Who am I, according to the server.
 *
 * The client already knows who it is signed in as — Clerk tells it — so this
 * endpoint is not how the app learns that. It exists for the two things the
 * client cannot answer itself: whether this Worker actually accepts the token
 * (the whole auth path, end to end, in one call), and what our own mirror row
 * says.
 *
 * That makes it the thing to hit first when the keys land, and the thing to check
 * first when a write starts 401ing.
 */
export const me = new Hono<AppEnv>();

me.get('/', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  // 200 with `signed_in: false`, not 401. Being signed out is a normal state of
  // this app rather than a failure, and the client asks this question on every
  // cold start — an error status would light up as a fault in logs and in
  // whatever error reporting gets added later.
  if (!userId) {
    return c.json({ signed_in: false, user: null });
  }
  return c.json({
    signed_in: true,
    user: (await findUser(getDb(c.env.DB), userId)) ?? { id: userId, handle: null },
  });
});

/**
 * Create or refresh the mirror row from Clerk itself.
 *
 * Takes no body at all. It used to accept the display name and avatar from the
 * client — bounded trust, the identity still came from the token — but a profile
 * is public the moment other people can open it, so every field now comes from
 * Clerk's Backend API, keyed by the verified token's subject and nothing else
 * (`syncProfileFromClerk` for the reasoning and the cost). The client calls this
 * once when a session appears; there is nothing in the request left to lie about.
 */
me.post('/', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  try {
    await syncProfileFromClerk(c.env, db, userId);
  } catch (err) {
    // Clerk's API being down is not this account being broken. The token already
    // verified, so the row still gets claimed — just without fresher profile
    // fields than whatever it already held. The client retries the sync on its
    // next launch either way, and a stale display name beats a failed sign-in.
    console.warn('profile sync from Clerk failed:', err);
    await ensureUser(db, userId);
  }
  return c.json({ ok: true, user: await findUser(db, userId) });
});

/**
 * Delete the account — the store-required workflow, end to end: lists and graph
 * edges deleted, the mirror row tombstoned and cleared, the Clerk identity
 * removed (`deleteAccount` for the ordering and why a partial failure is
 * retryable). The session token that authorized this is dead moments later,
 * which is the point.
 */
me.delete('/', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  await deleteAccount(c.env, getDb(c.env.DB), userId);
  return c.json({ ok: true, deleted: true });
});

/**
 * Claim a row without touching the profile — what a write path calls before it
 * inserts something that references this user.
 */
me.post('/ensure', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  await ensureUser(getDb(c.env.DB), userId);
  return c.json({ ok: true });
});

/**
 * Search radius and the reminders switch.
 *
 * On the account because nothing lives on the device any more. A partial update, so
 * flipping the reminders switch does not have to restate the radius — and `undefined`
 * has to mean "leave it" rather than "clear it", which is why the set object is built
 * conditionally instead of spread wholesale.
 */
/**
 * The profile's four favorites — the acts the profile leads with.
 *
 * The whole list arrives each time (it is at most four items; a patch protocol
 * would be more code than the data). Ids are deduplicated preserving order and
 * checked against the artists table, so a stale or invented id can't wedge a
 * broken tile onto a public profile — unknown ids just drop out.
 */
me.put('/favorites', zValidator('json', favoritesBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  await ensureUser(db, userId);
  const requested = [...new Set(c.req.valid('json').artistIds)];
  const known = requested.length
    ? new Set(
        (
          await db.select({ id: artists.id }).from(artists).where(inArray(artists.id, requested))
        ).map((r) => r.id),
      )
    : new Set<string>();
  const kept = requested.filter((id) => known.has(id));
  await db
    .update(users)
    .set({ favoriteArtists: kept.length ? JSON.stringify(kept) : null })
    .where(eq(users.id, userId));
  return c.json({ ok: true, artistIds: kept });
});

me.put('/prefs', zValidator('json', prefsBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  await ensureUser(db, userId);
  const body = c.req.valid('json');
  await db
    .update(users)
    .set({
      ...(body.radiusMiles !== undefined ? { radiusMiles: body.radiusMiles } : {}),
      ...(body.remindersEnabled !== undefined ? { remindersEnabled: body.remindersEnabled ? 1 : 0 } : {}),
    })
    .where(eq(users.id, userId));
  return c.json({ ok: true, user: await findUser(db, userId) });
});

/**
 * Acts from your own Spotify that are playing somewhere — the artists you follow
 * there and the ones you actually listen to, matched against the catalogue.
 *
 * `linked: false` is a 200, not a 401 or a 404. Not having connected Spotify is a
 * normal state, and it's also the answer for anyone the Spotify app hasn't
 * allowlisted while it's in development mode: they can never complete the
 * authorize step, so there is nothing to report and nothing to apologise for.
 * The client hides its entry point on that flag alone.
 *
 * Signed out is the same shape for the same reason — the screen asks before it
 * knows, and a 401 here would light up as a fault rather than a state.
 */
me.get('/spotify/suggestions', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ linked: false, items: [] });
  return c.json(await spotifySuggestions(c.env, getDb(c.env.DB), userId));
});
