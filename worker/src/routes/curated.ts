import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { callerFrom, ensureUser } from '../auth';
import { nowIso } from '../data';
import { getDb, type DB } from '../db';
import type { AppEnv } from '../env';
import { artists, events, listItems, lists, venues } from '../schema';
import { curatedListBody, curatedListPatch, listItemBody } from '../schemas';

/**
 * Curated lists — phase E of docs/social.md, deliberately built last.
 *
 * A list is a shelf: artists, venues and events arranged on purpose. Items are
 * stored as (kind, id) references and resolved to names on read, so a list
 * survives re-clustering and enrichment the same way everything else does — by
 * looking things up late. A reference whose row has vanished drops out of the
 * rendered list rather than 500ing it.
 *
 * Public lists appear on the owner's profile; private ones are a scratchpad.
 * There is no moderation surface yet because there is no free text visible to
 * strangers except the title and description — when reactions and comments
 * arrive, lists join the reportable kinds and deletion becomes a tombstone.
 */
export const curated = new Hono<AppEnv>();

const LISTS_PER_USER = 50;
const ITEMS_PER_LIST = 200;

type RefKind = 'artist' | 'venue' | 'event';

/** Resolve items of one kind to whatever renders them. */
async function resolveRefs(db: DB, kind: RefKind, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; imageUrl: string | null; detail: string | null }>();
  if (kind === 'artist') {
    const rows = await db
      .select({ id: artists.id, name: artists.name, imageUrl: artists.imageUrl })
      .from(artists)
      .where(inArray(artists.id, ids));
    return new Map(rows.map((r) => [r.id, { name: r.name, imageUrl: r.imageUrl, detail: null }]));
  }
  if (kind === 'venue') {
    const rows = await db
      .select({ id: venues.id, name: venues.name, city: venues.city })
      .from(venues)
      .where(inArray(venues.id, ids));
    return new Map(rows.map((r) => [r.id, { name: r.name, imageUrl: null, detail: r.city }]));
  }
  const rows = await db
    .select({ id: events.id, name: events.name, startsAt: events.startsAt })
    .from(events)
    .where(inArray(events.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, imageUrl: null, detail: r.startsAt }]));
}

/** The list row, if the caller may see it. Owners see private; others don't. */
async function visibleList(db: DB, id: string, userId: string | null) {
  const row = await db.select().from(lists).where(eq(lists.id, id)).get();
  if (!row) return null;
  if (row.visibility !== 'public' && row.userId !== userId) return null;
  return row;
}

/** Create. Bounded per user — a shelf, not a database. */
curated.post('/', zValidator('json', curatedListBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const owned =
    (await db.select({ n: sql<number>`count(*)` }).from(lists).where(eq(lists.userId, userId)).get())?.n ?? 0;
  if (owned >= LISTS_PER_USER) return c.json({ error: 'list limit reached' }, 429);

  await ensureUser(db, userId);
  const body = c.req.valid('json');
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.insert(lists).values({
    id,
    userId,
    title: body.title,
    description: body.description || null,
    visibility: body.visibility,
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ ok: true, id });
});

/** One list with its items resolved, in shelf order. */
curated.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  const list = await visibleList(db, c.req.param('id'), userId);
  if (!list) return c.json({ error: 'not found' }, 404);

  const rows = await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, list.id))
    .orderBy(asc(listItems.position));

  const byKind: Record<RefKind, string[]> = { artist: [], venue: [], event: [] };
  for (const r of rows) byKind[r.refKind as RefKind].push(r.refId);
  const [artistRefs, venueRefs, eventRefs] = await Promise.all([
    resolveRefs(db, 'artist', byKind.artist),
    resolveRefs(db, 'venue', byKind.venue),
    resolveRefs(db, 'event', byKind.event),
  ]);
  const resolved = { artist: artistRefs, venue: venueRefs, event: eventRefs };

  return c.json({
    list: {
      id: list.id,
      title: list.title,
      description: list.description,
      visibility: list.visibility,
      ownerId: list.userId,
      updatedAt: list.updatedAt,
    },
    items: rows
      .map((r) => {
        const ref = resolved[r.refKind as RefKind].get(r.refId);
        // A vanished row drops out silently — the reference is stale, not the list.
        return ref
          ? { refKind: r.refKind, refId: r.refId, note: r.note, name: ref.name, imageUrl: ref.imageUrl, detail: ref.detail }
          : null;
      })
      .filter(Boolean),
    isOwner: userId === list.userId,
  });
});

/** Rename, redescribe, or flip visibility. Owner only. */
curated.put('/:id', zValidator('json', curatedListPatch), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const body = c.req.valid('json');
  const changed = await db
    .update(lists)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      updatedAt: nowIso(),
    })
    .where(and(eq(lists.id, c.req.param('id')), eq(lists.userId, userId)));
  return (changed as unknown as { meta?: { changes?: number } })?.meta?.changes
    ? c.json({ ok: true })
    : c.json({ error: 'not found' }, 404);
});

/** Delete, items and all. Hard — see the migration for when this changes. */
curated.delete('/:id', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  await db.batch([
    db.delete(listItems).where(
      and(eq(listItems.listId, id), sql`exists (select 1 from lists where id = ${id} and user_id = ${userId})`),
    ),
    db.delete(lists).where(and(eq(lists.id, id), eq(lists.userId, userId))),
  ]);
  return c.json({ ok: true });
});

/** Put something on the shelf. Owner only; the ref must actually exist. */
curated.post('/:id/items', zValidator('json', listItemBody), async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);

  const db = getDb(c.env.DB);
  const list = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, c.req.param('id')), eq(lists.userId, userId)))
    .get();
  if (!list) return c.json({ error: 'not found' }, 404);

  const body = c.req.valid('json');
  const resolved = await resolveRefs(db, body.refKind, [body.refId]);
  if (!resolved.has(body.refId)) return c.json({ error: `no such ${body.refKind}` }, 422);

  const stats = await db
    .select({ n: sql<number>`count(*)`, top: sql<number>`coalesce(max(position), 0)` })
    .from(listItems)
    .where(eq(listItems.listId, list.id))
    .get();
  if ((stats?.n ?? 0) >= ITEMS_PER_LIST) return c.json({ error: 'list is full' }, 429);

  await db
    .insert(listItems)
    .values({
      listId: list.id,
      refKind: body.refKind,
      refId: body.refId,
      position: (stats?.top ?? 0) + 1,
      note: body.note || null,
      createdAt: nowIso(),
    })
    // Re-adding is a no-op, not an error — the second tap of a laggy button.
    .onConflictDoNothing();
  await db.update(lists).set({ updatedAt: nowIso() }).where(eq(lists.id, list.id));
  return c.json({ ok: true });
});

/** Take something off the shelf. Idempotent. */
curated.delete('/:id/items/:kind/:refId', async (c) => {
  const { userId } = await callerFrom(c.env, c.req.header('authorization'));
  if (!userId) return c.json({ error: 'sign in required' }, 401);
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  await db
    .delete(listItems)
    .where(
      and(
        eq(listItems.listId, id),
        eq(listItems.refKind, c.req.param('kind')),
        eq(listItems.refId, c.req.param('refId')),
        sql`exists (select 1 from lists where id = ${id} and user_id = ${userId})`,
      ),
    );
  return c.json({ ok: true });
});

/**
 * Somebody's lists, for their profile: public ones for everyone, the private
 * ones too when they're yours. Item counts ride along so the shelf reads as
 * full or empty before it's opened.
 */
export async function listsOf(db: DB, ownerId: string, viewerId: string | null) {
  const rows = await db
    .select({
      id: lists.id,
      title: lists.title,
      description: lists.description,
      visibility: lists.visibility,
      updatedAt: lists.updatedAt,
      itemCount: sql<number>`(select count(*) from list_items where list_id = ${lists.id})`,
    })
    .from(lists)
    .where(
      viewerId === ownerId
        ? eq(lists.userId, ownerId)
        : and(eq(lists.userId, ownerId), eq(lists.visibility, 'public')),
    )
    .orderBy(desc(lists.updatedAt))
    .limit(50);
  return rows;
}
