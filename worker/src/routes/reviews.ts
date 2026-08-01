import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser } from '../auth';
import { eventsByIds, isoAt, nowIso, TBD_GRACE_MS } from '../data';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { eventRsvps, events, personFollows, reports, reviews, userBlocks, users } from '../schema';
import { reportBody, reviewBody, rsvpBody } from '../schemas';

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
    .select({
      id: events.id,
      artistId: events.artistId,
      venueId: events.venueId,
      startsAt: events.startsAt,
      timeUnknown: events.timeUnknown,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) return c.json({ error: 'not found' }, 404);

  const now = nowIso();
  // A time-unknown show starts *sometime* on its local day — noon is only the
  // placeholder — so it isn't reviewable until midnight at the venue.
  const startedBy = event.timeUnknown
    ? isoAt(Date.parse(event.startsAt) + TBD_GRACE_MS)
    : event.startsAt;
  if (startedBy > now) {
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

// --- going / interested ------------------------------------------------------

/**
 * RSVPs: the forward-looking half of the social layer. A review says what a
 * night was like; this says a night is going to matter. Counts are public and
 * anonymous — "12 going" names nobody — and only the caller ever learns their
 * own answer. The mirror-image rule to reviews applies: a show that has
 * already started takes no RSVP, because "went" is what the log is for.
 */
reviewRoutes.get('/events/:id/rsvps', async (c) => {
  const db = getDb(c.env.DB);
  const eventId = c.req.param('id');
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));

  const rows = await db
    .select({ status: eventRsvps.status, n: sql<number>`count(*)` })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId))
    .groupBy(eventRsvps.status);
  const counts = { going: 0, interested: 0 };
  for (const r of rows) counts[r.status as keyof typeof counts] = r.n;

  const mine = userId
    ? ((await db
        .select({ status: eventRsvps.status })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)))
        .get())?.status ?? null)
    : null;

  return c.json({ counts, mine });
});

reviewRoutes.put('/events/:id/rsvp', zValidator('json', rsvpBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const eventId = c.req.param('id');
  const event = await db
    .select({ startsAt: events.startsAt, timeUnknown: events.timeUnknown })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) return c.json({ error: 'not found' }, 404);
  const now = nowIso();
  // Mirror of the review gate: an unannounced set time might be tonight at
  // 11pm, so "going" stays open until midnight at the venue.
  const startedBy = event.timeUnknown
    ? isoAt(Date.parse(event.startsAt) + TBD_GRACE_MS)
    : event.startsAt;
  if (startedBy <= now) {
    return c.json({ error: 'this show has already started — log it instead' }, 422);
  }

  await ensureUser(db, userId);
  const { status } = c.req.valid('json');
  await db
    .insert(eventRsvps)
    .values({ userId, eventId, status, createdAt: now })
    .onConflictDoUpdate({ target: [eventRsvps.userId, eventRsvps.eventId], set: { status } });
  return c.json({ ok: true, mine: status });
});

/** Changing your mind all the way: no answer at all. Idempotent. */
reviewRoutes.delete('/events/:id/rsvp', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  await db
    .delete(eventRsvps)
    .where(and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, c.req.param('id'))));
  return c.json({ ok: true, mine: null });
});

/**
 * The feed (phase D): recent public reviews by the people you follow, merged
 * and sorted. Fan-out-on-read — one indexed query — and deliberately not
 * materialised: at this graph size a join is fine, and the note the design doc
 * leaves is that a materialised feed earns its complexity somewhere around a
 * few hundred follows each, not before.
 *
 * No block filter needed on top: blocking severs the follow edge this query
 * walks, so an estranged pair can't appear in each other's feeds by
 * construction.
 */
const FEED_PAGE = 50;

/**
 * Everything the caller said they're going to or interested in that hasn't
 * happened yet — the forward-looking shelf on the My Shows tab. Rows come back
 * in the `/events/by-ids` shape so the client renders the same cards, with the
 * caller's own answer riding along. Answers on past shows simply drop out
 * (`eventsByIds` only returns what's still to come), which is the RSVP
 * lifecycle working as designed rather than data loss.
 */
reviewRoutes.get('/me/rsvps', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const mine = await db
    .select({ eventId: eventRsvps.eventId, status: eventRsvps.status })
    .from(eventRsvps)
    .where(eq(eventRsvps.userId, userId));
  const statusOf = new Map(mine.map((r) => [r.eventId, r.status]));
  const items = await eventsByIds(db, [...statusOf.keys()]);
  return c.json({ items: items.map((e) => ({ ...e, rsvp_status: statusOf.get(e.event_id) })) });
});

reviewRoutes.get('/me/feed', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  // `?before=<createdAt>|<id>` pages into older reviews. Compound, because
  // created_at is second-precision and two reviews can share a second — a
  // timestamp-only cursor would skip whichever one landed on the boundary.
  // Only the cursor this route itself minted is accepted; anything else is a
  // 400, not a silently-wrong window.
  const before = c.req.query('before')?.trim() || null;
  let beforeAt: string | null = null;
  let beforeId: string | null = null;
  if (before) {
    const parts = before.split('|');
    if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parts[0]) || !parts[1]) {
      return c.json({ error: 'bad cursor' }, 400);
    }
    [beforeAt, beforeId] = parts;
  }

  const db = getDb(c.env.DB);
  const items = await db
    .select({
      id: reviews.id,
      eventId: reviews.eventId,
      eventName: events.name,
      startsAt: events.startsAt,
      rating: reviews.rating,
      venueRating: reviews.venueRating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      ...AUTHOR_FIELDS,
    })
    .from(personFollows)
    .innerJoin(
      reviews,
      and(eq(reviews.userId, personFollows.followeeId), eq(reviews.visibility, 'public'), isNull(reviews.deletedAt)),
    )
    .innerJoin(users, and(eq(users.id, reviews.userId), isNull(users.deletedAt)))
    .innerJoin(events, eq(events.id, reviews.eventId))
    .where(
      and(
        eq(personFollows.followerId, userId),
        beforeAt
          ? or(
              lt(reviews.createdAt, beforeAt),
              beforeId ? and(eq(reviews.createdAt, beforeAt), lt(reviews.id, beforeId)) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(FEED_PAGE);

  const last = items[items.length - 1];
  return c.json({
    items,
    limit: FEED_PAGE,
    // Full page ⇒ probably more; the cursor is where this page ended.
    nextCursor: items.length === FEED_PAGE ? `${last.createdAt}|${last.id}` : null,
  });
});

/**
 * The roll-ups (phase C): what reviews say about an artist live, or about a
 * room, across every show. Computed on read for now — one indexed aggregate
 * per page at today's volume; the denormalised counters the design doc calls
 * for are the scale-up step, recorded in todo.md, and this endpoint's shape is
 * what they'd feed either way.
 *
 * The confidence floor lives in the client ("3 reviews" renders, "1 review"
 * doesn't headline a page), but the raw count always returns so the floor is
 * a display decision rather than hidden data.
 */
const ratingStats = async (db: DB, col: 'artist_id' | 'venue_id', id: string, ratingCol: 'rating' | 'venue_rating') =>
  (await db
    .select({
      count: sql<number>`count(*)`,
      average: sql<number | null>`round(avg(${sql.raw(ratingCol)}), 1)`,
    })
    .from(reviews)
    .where(
      and(
        sql`${sql.raw(col)} = ${id}`,
        sql`${sql.raw(ratingCol)} is not null`,
        eq(reviews.visibility, 'public'),
        isNull(reviews.deletedAt),
      ),
    )
    .get()) ?? { count: 0, average: null };

reviewRoutes.get('/artists/:id/review-stats', async (c) => {
  const db = getDb(c.env.DB);
  return c.json({ live: await ratingStats(db, 'artist_id', c.req.param('id'), 'rating') });
});

reviewRoutes.get('/venues/:id/review-stats', async (c) => {
  const db = getDb(c.env.DB);
  return c.json({ room: await ratingStats(db, 'venue_id', c.req.param('id'), 'venue_rating') });
});

export { blockedEitherWay };
