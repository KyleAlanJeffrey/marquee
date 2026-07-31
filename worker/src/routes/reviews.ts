import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser } from '../auth';
import { nowIso } from '../data';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { events, reports, reviews, userBlocks, users } from '../schema';
import { reportBody, reviewBody } from '../schemas';

/**
 * Public reviews — phase B of docs/social.md.
 *
 * Three rules from that document are enforced here rather than merely hoped
 * for:
 *
 * - **A review of a show that hasn't happened is refused outright.** It is
 *   either a mistake or a lie, and the aggregate scores are only worth having
 *   if neither kind gets in.
 * - **Nothing from the private log is read, prefilled or published.** A review
 *   arrives entirely in its own request body; the log's note never becomes a
 *   review body implicitly.
 * - **One review per person per show.** The second write is an edit — stamped
 *   `edited_at` — not a second opinion.
 *
 * Moderation is part of the same feature, not a later one (guideline 1.2):
 * reports land here, hiding is the admin's verb, and blocks change what the
 * read paths serve in both directions.
 */
export const reviewRoutes = new Hono<AppEnv>();

/** More reviews than anyone writes honestly in a day; cheap spam brake. */
const REVIEWS_PER_DAY = 20;
const REVIEWS_PAGE = 50;

/** The author fields a review renders with — same shape a profile shows. */
const AUTHOR_FIELDS = {
  authorId: users.id,
  authorHandle: users.handle,
  authorName: users.displayName,
  authorAvatarUrl: users.avatarUrl,
};

/** True when either of the two has blocked the other. */
async function blockedEitherWay(db: DB, a: string, b: string): Promise<boolean> {
  return !!(await db
    .select({ one: sql`1` })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .get());
}

/**
 * Everyone the viewer is estranged from, either direction, as a subquery
 * condition. Written as `not exists` so the reviews query stays one round trip.
 */
const noBlockBetween = (viewerId: string) => sql`not exists (
  select 1 from user_blocks
  where (blocker_id = ${viewerId} and blocked_id = ${reviews.userId})
     or (blocker_id = ${reviews.userId} and blocked_id = ${viewerId})
)`;

/**
 * The reviews of one show, plus the caller's own regardless of visibility.
 *
 * `mine` rides separately so the composer can prefill an edit, and so an
 * author whose review was hidden by moderation still sees it themselves —
 * hidden means "not served to others", not gaslighting the person who wrote it.
 */
reviewRoutes.get('/events/:id/reviews', async (c) => {
  const db = getDb(c.env.DB);
  const eventId = c.req.param('id');
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));

  const publicRows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      venueRating: reviews.venueRating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      editedAt: reviews.editedAt,
      ...AUTHOR_FIELDS,
    })
    .from(reviews)
    .innerJoin(users, and(eq(users.id, reviews.userId), isNull(users.deletedAt)))
    .where(
      and(
        eq(reviews.eventId, eventId),
        eq(reviews.visibility, 'public'),
        isNull(reviews.deletedAt),
        ...(userId ? [noBlockBetween(userId)] : []),
      ),
    )
    .orderBy(desc(reviews.createdAt))
    .limit(REVIEWS_PAGE);

  const mine = userId
    ? ((await db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          venueRating: reviews.venueRating,
          body: reviews.body,
          visibility: reviews.visibility,
          createdAt: reviews.createdAt,
          editedAt: reviews.editedAt,
        })
        .from(reviews)
        .where(and(eq(reviews.eventId, eventId), eq(reviews.userId, userId), isNull(reviews.deletedAt)))
        .get()) ?? null)
    : null;

  return c.json({
    reviews: publicRows.filter((r) => r.authorId !== userId),
    mine,
    limit: REVIEWS_PAGE,
  });
});

/** Write or rewrite your review of a show that has actually happened. */
reviewRoutes.put('/events/:id/review', zValidator('json', reviewBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const eventId = c.req.param('id');
  const event = await db
    .select({ id: events.id, artistId: events.artistId, venueId: events.venueId, startsAt: events.startsAt })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) return c.json({ error: 'not found' }, 404);

  const now = nowIso();
  if (event.startsAt > now) {
    return c.json({ error: "this show hasn't happened yet" }, 422);
  }

  // The daily brake is for *new* reviews only. An edit doesn't add anything to
  // the pile — and counting it would lock somebody out of correcting their own
  // twentieth review, which punishes exactly the wrong behaviour.
  const existing = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.eventId, eventId)))
    .get();
  if (!existing) {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
    const written =
      (await db
        .select({ n: sql<number>`count(*)` })
        .from(reviews)
        .where(and(eq(reviews.userId, userId), gt(reviews.createdAt, dayAgo)))
        .get())?.n ?? 0;
    if (written >= REVIEWS_PER_DAY) {
      return c.json({ error: 'review limit reached for today' }, 429);
    }
  }

  await ensureUser(db, userId);
  const body = c.req.valid('json');
  await db
    .insert(reviews)
    .values({
      id: crypto.randomUUID(),
      userId,
      eventId,
      artistId: event.artistId,
      venueId: event.venueId,
      rating: body.rating ?? null,
      venueRating: body.venueRating ?? null,
      body: body.body || null,
      createdAt: now,
    })
    // The second write is an edit. Deliberately NOT touched: `visibility` — an
    // edit must not un-hide what moderation hid — and `created_at`, so editing
    // doesn't bump a review to the top of anything. A soft-deleted review
    // rewritten this way comes back, which is the author changing their mind.
    .onConflictDoUpdate({
      target: [reviews.userId, reviews.eventId],
      set: {
        rating: body.rating ?? null,
        venueRating: body.venueRating ?? null,
        body: body.body || null,
        artistId: event.artistId,
        venueId: event.venueId,
        editedAt: now,
        deletedAt: null,
      },
    });

  return c.json({ ok: true });
});

/** Take your review down. Soft — see the migration — and idempotent. */
reviewRoutes.delete('/events/:id/review', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  await db
    .update(reviews)
    .set({ deletedAt: nowIso() })
    .where(and(eq(reviews.eventId, c.req.param('id')), eq(reviews.userId, userId)));
  return c.json({ ok: true });
});

/**
 * Report a review. Anyone signed in can; what they say goes to the admin
 * queue verbatim. Duplicate reports are allowed on purpose — five people
 * reporting one review *is* the signal.
 */
reviewRoutes.post('/reviews/:id/report', zValidator('json', reportBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const target = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.id, c.req.param('id')), isNull(reviews.deletedAt)))
    .get();
  if (!target) return c.json({ error: 'not found' }, 404);

  await ensureUser(db, userId);
  await db.insert(reports).values({
    id: crypto.randomUUID(),
    reporterId: userId,
    targetKind: 'review',
    targetId: target.id,
    reason: c.req.valid('json').reason,
    createdAt: nowIso(),
  });
  return c.json({ ok: true });
});

export { blockedEitherWay };
