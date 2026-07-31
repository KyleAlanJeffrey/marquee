import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser } from '../auth';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { userLists } from '../schema';
import { listsBody } from '../schemas';

/**
 * The four lists a person owns, so they survive the device.
 *
 * The device is still the source the app *reads* from — that is what makes it open
 * instantly and work offline — and this is the copy that means a lost phone is not
 * a lost history. Two routes, because there are only two questions: what does the
 * server have, and here is what I have.
 *
 * Storage is a JSON document per list; see `0010_user_lists.sql` for why, and for
 * the point at which that stops being the right answer.
 */
export const lists = new Hono<AppEnv>();

/** The list names, which are also the `kind` column's allowed values. */
const KINDS = ['follows', 'venues', 'saved', 'attendances'] as const;
type Kind = (typeof KINDS)[number];

/** An empty response has all four keys, so a client never branches on absence. */
const EMPTY: Record<Kind, unknown[]> = { follows: [], venues: [], saved: [], attendances: [] };

/**
 * Read every list back.
 *
 * A row whose JSON won't parse is returned as an empty list rather than a 500. It
 * should be impossible — the only writer is the route below, which validates first
 * — but the alternative is one corrupt row making the whole account unreadable,
 * and this data has no other copy on the server to fall back to.
 */
async function readLists(db: DB, userId: string): Promise<Record<Kind, unknown[]>> {
  const rows = await db
    .select({ kind: userLists.kind, payload: userLists.payload })
    .from(userLists)
    .where(and(eq(userLists.userId, userId), inArray(userLists.kind, [...KINDS])));

  const out: Record<Kind, unknown[]> = { ...EMPTY };
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload);
      if (Array.isArray(parsed)) out[row.kind as Kind] = parsed;
      else console.warn(`user_lists ${row.kind} for ${userId} was not an array`);
    } catch (err) {
      console.warn(`user_lists ${row.kind} for ${userId} did not parse:`, err);
    }
  }
  return out;
}

lists.get('/', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  // 401 rather than empty lists: "you have nothing saved" and "we don't know who
  // you are" are different answers, and a client that merges the first into its
  // local copy would conclude the server had deleted everything.
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  return c.json({ lists: await readLists(getDb(c.env.DB), userId) });
});

/**
 * Replace whichever lists the body names, and hand back all four.
 *
 * Returning the full set is what makes one round trip enough on sign-in: the client
 * pushes its merged copy and adopts the reply, so there is no second GET and no
 * window where the two disagree.
 *
 * `ensureUser` first, because the foreign key means a list cannot exist before its
 * owner's mirror row does, and the first thing a brand-new account does is push the
 * list it built before signing up.
 */
lists.put('/', zValidator('json', listsBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  await ensureUser(db, userId);

  const body = c.req.valid('json');
  const now = Date.now();
  const writes = KINDS.filter((kind) => body[kind] !== undefined).map((kind) =>
    db
      .insert(userLists)
      .values({ userId, kind, payload: JSON.stringify(body[kind]), updatedAt: now })
      .onConflictDoUpdate({
        target: [userLists.userId, userLists.kind],
        set: { payload: JSON.stringify(body[kind]), updatedAt: now },
      }),
  );
  // One batch, because D1 runs a batch as a single transaction. Awaiting the writes
  // one at a time committed each on its own, so a failure partway through left the
  // account holding some lists from this push and some from the last one — and the
  // client, seeing an error, has no way to know which. At most four statements, so
  // there is nothing to chunk.
  if (writes.length) await db.batch(writes as [(typeof writes)[number], ...typeof writes]);

  return c.json({ lists: await readLists(db, userId) });
});
