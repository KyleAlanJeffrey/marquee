import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser, findUser, syncProfile } from '../auth';
import { getDb } from '../db';
import { users } from '../schema';
import type { AppEnv } from '../env';
import { prefsBody, profileBody } from '../schemas';

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
 * Create or refresh the mirror row from what Clerk told the client.
 *
 * Trusting the client for the display name and avatar is deliberate and bounded:
 * the *identity* is not taken from the body — `userId` comes from the verified
 * token and nothing else — so the worst a tampered request can do is put a silly
 * name on its own account. The alternative is a Clerk API call inside a request
 * the person is waiting on, to fetch data the client is already holding.
 *
 * The handle is not accepted here for exactly that reason: it is public, it goes
 * in URLs, and it is the one field where a lie affects somebody else. It stays
 * Clerk's, read back from the token's claims or the Backend API when the profile
 * screen is built.
 */
me.post('/', zValidator('json', profileBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const body = c.req.valid('json');
  await syncProfile(db, userId, body);
  return c.json({ ok: true, user: await findUser(db, userId) });
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
