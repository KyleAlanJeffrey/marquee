import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Hono } from 'hono';

import { callerFrom, ensureUser } from '../auth';
import { eventsByIds, isoAt, nowIso, publishedVenueName, TBD_GRACE_MS } from '../data';
import { zoneFor } from '../timezone';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { artists, eventRsvps, events, personFollows, reports, reviewLikes, reviews, userBlocks, users, venues } from '../schema';
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
const noBlockBetween = (viewerId: string) => noBlockWith(viewerId, reviews.userId);

/** The same estrangement check against any author column — rsvps use it too. */
const noBlockWith = (viewerId: string, author: typeof reviews.userId | typeof eventRsvps.userId) => sql`not exists (
  select 1 from user_blocks
  where (blocker_id = ${viewerId} and blocked_id = ${author})
     or (blocker_id = ${author} and blocked_id = ${viewerId})
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

  // Counted live, never denormalised — a like is a row, count(*) is the truth
  // (0018). Most-liked first is "popular reviews" as soon as popular means
  // anything; newest-first is the tiebreak until it does.
  const likeCount = sql<number>`(select count(*) from review_likes where review_id = ${reviews.id})`;
  const publicRows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      venueRating: reviews.venueRating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      editedAt: reviews.editedAt,
      likeCount,
      likedByMe: sql<number>`exists (select 1 from review_likes where review_id = ${reviews.id} and user_id = ${userId ?? ''})`,
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
    .orderBy(desc(likeCount), desc(reviews.createdAt))
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
    reviews: publicRows
      .filter((r) => r.authorId !== userId)
      .map((r) => ({ ...r, likedByMe: !!r.likedByMe })),
    mine,
    limit: REVIEWS_PAGE,
  });
});

/**
 * Like / unlike someone's review — the cheapest verb in the social layer.
 *
 * Both directions are idempotent by construction: the like is a row keyed
 * (review_id, user_id), so a doubled PUT inserts nothing and a doubled DELETE
 * deletes nothing, and either way the response carries the count that is now
 * true. Hidden, deleted and estranged-author reviews all answer 404 — the
 * same "not served to you" the read path already enforces, and a block plus
 * a like from the same person would be a strange thing to store.
 */
const likeTarget = async (db: DB, reviewId: string, userId: string) => {
  const row = await db
    .select({ id: reviews.id, authorId: reviews.userId })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.visibility, 'public'), isNull(reviews.deletedAt)))
    .get();
  if (!row || (row.authorId !== userId && (await blockedEitherWay(db, userId, row.authorId)))) return null;
  return row;
};

const likeCountOf = async (db: DB, reviewId: string): Promise<number> =>
  (
    await db
      .select({ n: sql<number>`count(*)` })
      .from(reviewLikes)
      .where(eq(reviewLikes.reviewId, reviewId))
      .get()
  )?.n ?? 0;

reviewRoutes.put('/reviews/:id/like', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const reviewId = c.req.param('id');
  if (!(await likeTarget(db, reviewId, userId))) return c.json({ error: 'not found' }, 404);
  // Same as every other first write: the caller's mirror row may not exist
  // yet (fresh account racing its own POST /me), and the like's foreign key
  // needs it to.
  await ensureUser(db, userId);
  await db
    .insert(reviewLikes)
    .values({ reviewId, userId, createdAt: nowIso() })
    .onConflictDoNothing();
  return c.json({ liked: true, likeCount: await likeCountOf(db, reviewId) });
});

reviewRoutes.delete('/reviews/:id/like', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const reviewId = c.req.param('id');
  if (!(await likeTarget(db, reviewId, userId))) return c.json({ error: 'not found' }, 404);
  await db.delete(reviewLikes).where(and(eq(reviewLikes.reviewId, reviewId), eq(reviewLikes.userId, userId)));
  return c.json({ liked: false, likeCount: await likeCountOf(db, reviewId) });
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
 * night was like; this says a night is going to matter. The mirror-image rule
 * to reviews applies: a show that has already started takes no RSVP, because
 * "went" is what the log is for.
 *
 * RSVPs are **named** (2026-08-06, reversing the launch-era "counts name
 * nobody" rule): the whole point of saying you're going is that people can see
 * you're going — "I want to see what other people are going to" was the ask,
 * and an integer answers it for nobody. An answer is public the same way a
 * public review is; the people list caps out rather than paginating (a name
 * wall, not a directory), the viewer's follows float to the top because those
 * are the names that change a decision, and blocks hide the estranged in both
 * directions exactly as they do for reviews.
 */
const RSVP_PEOPLE_MAX = 30;

reviewRoutes.get('/events/:id/rsvps', async (c) => {
  const db = getDb(c.env.DB);
  const eventId = c.req.param('id');
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));

  // The same visibility the people list applies — deleted accounts and
  // blocked pairs — or "1 GOING" can sit over an empty name wall and read
  // as a bug.
  const rows = await db
    .select({ status: eventRsvps.status, n: sql<number>`count(*)` })
    .from(eventRsvps)
    .innerJoin(users, and(eq(users.id, eventRsvps.userId), isNull(users.deletedAt)))
    .where(and(eq(eventRsvps.eventId, eventId), userId ? noBlockWith(userId, eventRsvps.userId) : undefined))
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

  // 0/1 in SQL so it can drive the sort; the client reads it as a boolean-ish.
  const followedByMe = userId
    ? sql<number>`exists (select 1 from person_follows
        where follower_id = ${userId} and followee_id = ${users.id})`
    : sql<number>`0`;
  const people = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: eventRsvps.status,
      followedByMe,
    })
    .from(eventRsvps)
    .innerJoin(users, and(eq(users.id, eventRsvps.userId), isNull(users.deletedAt)))
    .where(and(eq(eventRsvps.eventId, eventId), userId ? noBlockWith(userId, eventRsvps.userId) : undefined))
    // Going before interested (commitment outranks curiosity), people you
    // follow before strangers, then whoever answered most recently. The
    // follow term only exists for signed-in viewers: anonymous callers'
    // constant `0` would reach SQLite as an ORDER BY *column position*.
    .orderBy(
      ...[
        sql`case ${eventRsvps.status} when 'going' then 0 else 1 end`,
        ...(userId ? [desc(followedByMe)] : []),
        desc(eventRsvps.createdAt),
      ],
    )
    .limit(RSVP_PEOPLE_MAX);

  return c.json({ counts, mine, people, people_limit: RSVP_PEOPLE_MAX });
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

/**
 * `?before=<createdAt>|<id>` pages into older items. Compound, because
 * created_at is second-precision and two items can share a second — a
 * timestamp-only cursor would skip whichever one landed on the boundary.
 * Only a cursor these routes themselves minted is accepted; anything else is
 * a 400, not a silently-wrong window.
 */
function parseCursor(raw: string | undefined): { beforeAt: string | null; beforeId: string | null } | null {
  const before = raw?.trim() || null;
  if (!before) return { beforeAt: null, beforeId: null };
  const parts = before.split('|');
  if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parts[0]) || !parts[1]) {
    return null;
  }
  return { beforeAt: parts[0], beforeId: parts[1] };
}

/**
 * One page of the activity stream: public reviews and RSVPs, merged newest
 * first. Two indexed queries and a JS merge rather than a UNION — the shapes
 * differ enough that the union's null-padding costs more clarity than the
 * merge costs cycles at FEED_PAGE rows.
 *
 * The RSVP half's item id is synthesised (`r:<user>:<event>` — the table's key
 * is composite) and both halves order and cursor on (createdAt, id) with their
 * own id expression, so the compound cursor stays exact across the merge.
 * RSVPs only stream for shows still to come: "going to" a show that already
 * happened is stale plans, and the review stream is the record of the night.
 *
 * `followerId` scopes to the caller's follow graph (`/me/feed`); without it
 * the stream is everyone (`/activity`) — the cold-start answer for a network
 * where nobody follows anybody yet, block-filtered when the viewer is known.
 */
async function activityPage(
  db: DB,
  opts: { followerId?: string; viewerId: string | null; beforeAt: string | null; beforeId: string | null },
) {
  const { followerId, viewerId, beforeAt, beforeId } = opts;

  const olderThan = (createdAt: typeof reviews.createdAt | typeof eventRsvps.createdAt, idExpr: unknown) =>
    beforeAt
      ? or(
          lt(createdAt, beforeAt),
          beforeId ? and(eq(createdAt, beforeAt), sql`${idExpr} < ${beforeId}`) : undefined,
        )
      : undefined;

  const reviewQuery = db
    .select({
      type: sql<string>`'review'`,
      id: reviews.id,
      eventId: reviews.eventId,
      eventName: events.name,
      startsAt: events.startsAt,
      rating: reviews.rating,
      venueRating: reviews.venueRating,
      body: reviews.body,
      status: sql<string | null>`null`,
      createdAt: reviews.createdAt,
      ...AUTHOR_FIELDS,
    })
    .from(reviews)
    .innerJoin(users, and(eq(users.id, reviews.userId), isNull(users.deletedAt)))
    .innerJoin(events, eq(events.id, reviews.eventId))
    .where(
      and(
        eq(reviews.visibility, 'public'),
        isNull(reviews.deletedAt),
        followerId
          ? sql`exists (select 1 from person_follows
              where follower_id = ${followerId} and followee_id = ${reviews.userId})`
          : undefined,
        !followerId && viewerId ? noBlockBetween(viewerId) : undefined,
        olderThan(reviews.createdAt, reviews.id),
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    // One past the page from each source: "exactly FEED_PAGE" is how an
    // exhausted well and a full one look identical, and the difference is
    // whether the client gets a cursor to an empty page.
    .limit(FEED_PAGE + 1);

  const rsvpId = sql<string>`'r:' || ${eventRsvps.userId} || ':' || ${eventRsvps.eventId}`;
  const rsvpQuery = db
    .select({
      type: sql<string>`'rsvp'`,
      id: rsvpId,
      eventId: eventRsvps.eventId,
      eventName: events.name,
      startsAt: events.startsAt,
      rating: sql<number | null>`null`,
      venueRating: sql<number | null>`null`,
      body: sql<string | null>`null`,
      status: eventRsvps.status,
      createdAt: eventRsvps.createdAt,
      ...AUTHOR_FIELDS,
    })
    .from(eventRsvps)
    .innerJoin(users, and(eq(users.id, eventRsvps.userId), isNull(users.deletedAt)))
    .innerJoin(events, eq(events.id, eventRsvps.eventId))
    .where(
      and(
        // "Still to come" honours the same grace the RSVP write gate gives a
        // time-unknown show: it can accept a "going" until midnight at the
        // venue, so it keeps streaming until then too.
        sql`${events.startsAt} > (case when ${events.timeUnknown}
          then ${isoAt(Date.now() - TBD_GRACE_MS)} else ${nowIso()} end)`,
        followerId
          ? sql`exists (select 1 from person_follows
              where follower_id = ${followerId} and followee_id = ${eventRsvps.userId})`
          : undefined,
        !followerId && viewerId ? noBlockWith(viewerId, eventRsvps.userId) : undefined,
        olderThan(eventRsvps.createdAt, rsvpId),
      ),
    )
    .orderBy(desc(eventRsvps.createdAt), desc(rsvpId))
    .limit(FEED_PAGE + 1);

  const [reviewItems, rsvpItems] = await Promise.all([reviewQuery, rsvpQuery]);

  const merged = [...reviewItems, ...rsvpItems]
    .sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
    )
    .slice(0, FEED_PAGE);
  // More exists only when something was genuinely cut off: a source overflowed
  // its page+1 window, or the merge dropped rows. A dataset of exactly one
  // page ends here with no cursor instead of promising an empty page.
  const hasMore =
    reviewItems.length > FEED_PAGE || rsvpItems.length > FEED_PAGE || reviewItems.length + rsvpItems.length > FEED_PAGE;
  const last = merged[merged.length - 1];
  return {
    items: merged,
    limit: FEED_PAGE,
    nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
  };
}

/**
 * The going-RSVPs whose night has now been and gone — the shows the client
 * turns into log entries ("I said I was going, so I went").
 *
 * A separate route because `/me/rsvps` deliberately answers only what's still
 * to come: a past answer isn't a plan any more, so it drops out there and
 * becomes invisible everywhere in the app. This is where it resurfaces, once,
 * as history.
 *
 * Only `going`. "Interested" is a maybe, and a maybe is not an attendance —
 * inventing one would put shows in somebody's history they never went to.
 *
 * The response carries everything a log row needs, because the client writes
 * that row from this payload alone.
 */
reviewRoutes.get('/me/rsvps/past', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const canon = alias(venues, 'canon');
  const rows = await db
    .select({
      event_id: events.id,
      event_name: events.name,
      starts_at: events.startsAt,
      artist_id: artists.id,
      artist_name: artists.name,
      artist_image_url: artists.imageUrl,
      venue_id: canon.id,
      venue_name: canon.name,
      venue_city: canon.city,
      venue_region: canon.region,
      venue_country: canon.country,
    })
    .from(eventRsvps)
    .innerJoin(events, eq(events.id, eventRsvps.eventId))
    .innerJoin(artists, eq(artists.id, events.artistId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(
      and(
        eq(eventRsvps.userId, userId),
        eq(eventRsvps.status, 'going'),
        // Started, by the same clock the RSVP gate closes on: a time-unknown
        // show isn't over until midnight at the venue, so it isn't history
        // until then either.
        sql`${events.startsAt} <= (case when ${events.timeUnknown}
          then ${isoAt(Date.now() - TBD_GRACE_MS)} else ${nowIso()} end)`,
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(PAST_RSVP_MAX);

  return c.json({
    items: rows.map((r) => ({
      ...r,
      venue_name: publishedVenueName(r.venue_name),
      venue_timezone: zoneFor(r.venue_region, r.venue_country),
    })),
  });
});

/** A backlog this size is somebody's whole year; more can wait for next time. */
const PAST_RSVP_MAX = 50;

reviewRoutes.get('/me/feed', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const cursor = parseCursor(c.req.query('before'));
  if (!cursor) return c.json({ error: 'bad cursor' }, 400);

  const db = getDb(c.env.DB);
  return c.json(await activityPage(db, { followerId: userId, viewerId: userId, ...cursor }));
});

/**
 * The whole room's recent activity, viewer optional. What makes the Activity
 * tab's "Everyone" scope work before anyone has followed anyone — the same
 * reason Letterboxd's Home leads with "Popular this week" rather than an
 * empty friends feed.
 */
reviewRoutes.get('/activity', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  const cursor = parseCursor(c.req.query('before'));
  if (!cursor) return c.json({ error: 'bad cursor' }, 400);

  const db = getDb(c.env.DB);
  return c.json(await activityPage(db, { viewerId: userId, ...cursor }));
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
