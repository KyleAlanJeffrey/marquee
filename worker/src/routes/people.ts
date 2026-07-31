import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser, syncProfileFromClerk } from '../auth';
import { nowIso } from '../data';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { events, personFollows, reviews, userBlocks, users } from '../schema';
import { blockedEitherWay } from './reviews';

/**
 * Public profiles and the person graph — phase A of docs/social.md.
 *
 * A profile is the first thing on this server that shows one account's data to a
 * different account, so what it exposes is chosen field by field rather than by
 * returning the row: identity (handle, display name, avatar), when they joined,
 * and the two follow counts. Nothing from `user_lists` — the log, the follows,
 * the saved shows were all written under a "visible to nobody else" promise, and
 * publishing any of it (even as a count) is phase B's per-entry opt-in, not a
 * side effect of profiles existing.
 *
 * URLs take a handle or a Clerk user id. Handles are null for everyone today —
 * the instance has usernames disabled — so ids are what make profiles reachable
 * at all until the handle policy (Kyle's, see docs/social.md) is decided. When
 * that lands, the same route starts answering to handles with no code change.
 */
export const people = new Hono<AppEnv>();

/** What a profile shows of a user — also the shape of a follower-list entry. */
const PUBLIC_FIELDS = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
};

/**
 * Resolve a URL key to a live account: a handle (case-folded, matching the
 * partial unique index) or a Clerk id.
 *
 * For an id-shaped key (`user_…`) the id lookup runs first. Clerk does not
 * reserve that prefix in usernames, so with handle-first a username crafted to
 * equal somebody's Clerk id would shadow their profile URL — id-first makes an
 * existing account's id URL unshadowable, and a handle that merely *looks* like
 * an id still resolves when no such id exists.
 *
 * Tombstoned accounts don't resolve: a deleted user's profile is a 404, not a
 * ghost page.
 */
async function findByKey(db: DB, key: string) {
  const alive = isNull(users.deletedAt);
  const byHandle = () =>
    db
      .select(PUBLIC_FIELDS)
      .from(users)
      .where(and(sql`lower(${users.handle}) = lower(${key})`, alive))
      .get();
  const byId = () =>
    db
      .select(PUBLIC_FIELDS)
      .from(users)
      .where(and(eq(users.id, key), alive))
      .get();

  const [first, second] = key.startsWith('user_') ? [byId, byHandle] : [byHandle, byId];
  return (await first()) ?? (await second()) ?? null;
}

people.get('/:key', async (c) => {
  const db = getDb(c.env.DB);
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  let person = await findByKey(db, c.req.param('key'));

  // Your own profile self-heals. The mirror row is normally written by the
  // client calling `POST /me` after sign-in, but that call rides a freshly
  // minted session and can lose the race with Clerk's own handshake — which
  // left a real signed-up account staring at "this profile doesn't exist".
  // A signed-in caller asking for themselves *is* proof the account exists,
  // so answer by syncing rather than by 404ing.
  if (!person && userId && c.req.param('key') === userId) {
    try {
      await syncProfileFromClerk(c.env, db, userId);
    } catch (err) {
      // Clerk being unreachable shouldn't turn "who am I" into a 500 — the
      // token already proved the account, so claim the bare row and render a
      // nameless profile until a later sync fills it in.
      console.warn('own-profile self-heal could not reach Clerk:', err);
      await ensureUser(db, userId);
    }
    person = await findByKey(db, userId);
  }
  if (!person) return c.json({ error: 'not found' }, 404);

  // Joined against `users` exactly as the lists below are, so the number on the
  // profile is the length of the list behind it — a tombstoned account must not
  // linger in the count after it has dropped out of the list.
  const countWhere = async (cond: ReturnType<typeof eq>, otherSide: typeof personFollows.followerId) =>
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(personFollows)
        .innerJoin(users, and(eq(users.id, otherSide), isNull(users.deletedAt)))
        .where(cond)
        .get()
    )?.n ?? 0;

  // Whether *you* follow them only exists when there is a you. Anonymous readers
  // get null, and the client renders the follow button from it either way.
  const viewerFollows =
    userId && userId !== person.id
      ? !!(await db
          .select({ one: sql`1` })
          .from(personFollows)
          .where(and(eq(personFollows.followerId, userId), eq(personFollows.followeeId, person.id)))
          .get())
      : false;

  // Whether *you* blocked them — the block/unblock button's state. Being
  // blocked by them is deliberately not surfaced: announcing it is how blocks
  // start arguments.
  const viewerBlocked =
    userId && userId !== person.id
      ? !!(await db
          .select({ one: sql`1` })
          .from(userBlocks)
          .where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, person.id)))
          .get())
      : false;

  return c.json({
    user: person,
    counts: {
      followers: await countWhere(eq(personFollows.followeeId, person.id), personFollows.followerId),
      following: await countWhere(eq(personFollows.followerId, person.id), personFollows.followeeId),
    },
    viewer: userId
      ? { following: viewerFollows, isSelf: userId === person.id, blocked: viewerBlocked }
      : null,
  });
});

/**
 * Their public reviews — the profile's content, and the reason profiles exist.
 * Estranged pairs (a block in either direction) see nothing rather than a
 * filtered subset: guideline 1.2's block has to mean the person is gone.
 */
people.get('/:key/reviews', async (c) => {
  const db = getDb(c.env.DB);
  const person = await findByKey(db, c.req.param('key'));
  if (!person) return c.json({ error: 'not found' }, 404);

  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (userId && userId !== person.id && (await blockedEitherWay(db, userId, person.id))) {
    return c.json({ reviews: [], limit: PROFILE_REVIEWS_MAX });
  }

  const rows = await db
    .select({
      id: reviews.id,
      eventId: reviews.eventId,
      eventName: events.name,
      startsAt: events.startsAt,
      rating: reviews.rating,
      venueRating: reviews.venueRating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      editedAt: reviews.editedAt,
    })
    .from(reviews)
    .innerJoin(events, eq(events.id, reviews.eventId))
    .where(and(eq(reviews.userId, person.id), eq(reviews.visibility, 'public'), isNull(reviews.deletedAt)))
    .orderBy(desc(reviews.createdAt))
    .limit(PROFILE_REVIEWS_MAX);

  return c.json({ reviews: rows, limit: PROFILE_REVIEWS_MAX });
});

const PROFILE_REVIEWS_MAX = 50;

/**
 * Block. Severs the relationship whole: existing follows go in both
 * directions, and the read paths stop serving either party's reviews to the
 * other. One tap has to do all of it — nobody blocks somebody and then wants
 * to keep appearing in their feed.
 */
people.post('/:key/block', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const person = await findByKey(db, c.req.param('key'));
  if (!person) return c.json({ error: 'not found' }, 404);
  if (person.id === userId) return c.json({ error: 'cannot block yourself' }, 400);

  await ensureUser(db, userId);
  await db.batch([
    db.insert(userBlocks).values({ blockerId: userId, blockedId: person.id, createdAt: nowIso() }).onConflictDoNothing(),
    db.delete(personFollows).where(and(eq(personFollows.followerId, userId), eq(personFollows.followeeId, person.id))),
    db.delete(personFollows).where(and(eq(personFollows.followerId, person.id), eq(personFollows.followeeId, userId))),
  ]);
  return c.json({ ok: true, blocked: true });
});

/** Unblock. Follows do not come back — they were severed, not suspended. */
people.delete('/:key/block', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const person = await findByKey(db, c.req.param('key'));
  if (!person) return c.json({ error: 'not found' }, 404);

  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, person.id)));
  return c.json({ ok: true, blocked: false });
});

/**
 * Both directions of the graph, shaped identically so the client renders one
 * list either way. Joined against `users` so a tombstoned account drops out of
 * everybody's lists the moment it is deleted, rather than lingering as a name
 * that 404s when tapped.
 *
 * Capped, newest first, no cursor yet — pagination earns its keep somewhere
 * around the follower counts this app does not have. The cap is stated in the
 * response so a client can tell "exactly 100" from "100 of more".
 */
const FOLLOW_LIST_MAX = 100;

function followList(direction: 'followers' | 'following') {
  return async (c: Parameters<Parameters<typeof people.get>[1]>[0]) => {
    const db = getDb(c.env.DB);
    const person = await findByKey(db, c.req.param('key'));
    if (!person) return c.json({ error: 'not found' }, 404);

    const [theirSide, otherSide] =
      direction === 'followers'
        ? [personFollows.followeeId, personFollows.followerId]
        : [personFollows.followerId, personFollows.followeeId];

    const rows = await db
      .select({ ...PUBLIC_FIELDS, followedAt: personFollows.createdAt })
      .from(personFollows)
      .innerJoin(users, and(eq(users.id, otherSide), isNull(users.deletedAt)))
      .where(eq(theirSide, person.id))
      .orderBy(desc(personFollows.createdAt))
      .limit(FOLLOW_LIST_MAX);

    return c.json({ people: rows, limit: FOLLOW_LIST_MAX });
  };
}

people.get('/:key/followers', followList('followers'));
people.get('/:key/following', followList('following'));

/**
 * Follow — one direction, no acceptance step, like Letterboxd. Idempotent: the
 * second tap of a laggy button is the same follow, not an error. Self-follow is
 * refused here *and* by the table's CHECK constraint; the route's 400 is just
 * the polite version of what the insert would throw anyway.
 */
people.post('/:key/follow', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const person = await findByKey(db, c.req.param('key'));
  if (!person) return c.json({ error: 'not found' }, 404);
  if (person.id === userId) return c.json({ error: 'cannot follow yourself' }, 400);
  // A block in either direction closes the relationship to new follows too —
  // otherwise blocking somebody only lasts until they tap Follow again.
  if (await blockedEitherWay(db, userId, person.id)) {
    return c.json({ error: 'not available' }, 403);
  }

  // The follower may be writing for the first time; the followee necessarily
  // exists, because findByKey just read their row.
  await ensureUser(db, userId);
  await db
    .insert(personFollows)
    .values({ followerId: userId, followeeId: person.id, createdAt: new Date().toISOString().slice(0, 19) + 'Z' })
    .onConflictDoNothing();
  return c.json({ ok: true, following: true });
});

/** Unfollow. Also idempotent — unfollowing somebody you don't follow is a no-op. */
people.delete('/:key/follow', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const person = await findByKey(db, c.req.param('key'));
  if (!person) return c.json({ error: 'not found' }, 404);

  await db
    .delete(personFollows)
    .where(and(eq(personFollows.followerId, userId), eq(personFollows.followeeId, person.id)));
  return c.json({ ok: true, following: false });
});
