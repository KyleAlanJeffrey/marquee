import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

import { crawlQueueStats, repairDuplicates } from '../data';
import { getDb } from '../db';
import type { AppEnv, Env } from '../env';
import { artists, events } from '../schema';
import { backfillBandsintown, backfillCrawlQueue, crawlBandsintown } from '../sources';

export const admin = new Hono<AppEnv>();

const authorized = (c: { env: Env; req: { header: (k: string) => string | undefined } }) =>
  Boolean(c.env.ADMIN_TOKEN) && c.req.header('authorization') === `Bearer ${c.env.ADMIN_TOKEN}`;

/**
 * Which upstreams are actually usable. Ingestion silently no-ops on a missing
 * key (`if (!env.BANDSINTOWN_APP_ID) return []`), which is how Bandsintown
 * managed to contribute zero events without anyone noticing — so the
 * configuration is now something you can look at.
 */
const sourceConfig = (env: Env) => ({
  ticketmaster: Boolean(env.TICKETMASTER_API_KEY),
  bandsintown: Boolean(env.BANDSINTOWN_APP_ID),
  spotify: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
});

admin.get('/health', async (c) => {
  const configured = sourceConfig(c.env);
  const db = getDb(c.env.DB);
  let counts: Record<string, number> = {};
  let ok = true;
  try {
    const rows = await db
      .select({ source: events.source, n: sql<number>`count(*)` })
      .from(events)
      .groupBy(events.source);
    counts = Object.fromEntries(rows.map((r) => [r.source, r.n]));
  } catch (err) {
    console.error('health: event counts failed:', err);
    ok = false;
  }
  // A source that's configured but has never produced a row is the interesting
  // case — it looks healthy from the outside and isn't.
  const silent = Object.entries(configured)
    .filter(([name, on]) => on && name !== 'spotify' && !counts[name])
    .map(([name]) => name);
  // Queue depth answers the question the event counts can't: is the crawl
  // keeping up, or is everything permanently due?
  let queue: unknown = null;
  try {
    queue = await crawlQueueStats(db, 'bandsintown');
  } catch (err) {
    console.error('health: queue stats failed:', err);
  }
  return c.json(
    { ok, configured, events_by_source: counts, silent_sources: silent, crawl_queue: queue },
    ok ? 200 : 500,
  );
});

/**
 * Run one pass of the scheduled crawl by hand — the same code path the Cron
 * Trigger takes, so a broken schedule can be diagnosed without waiting for it.
 */
admin.post('/crawl', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  const n = Number(new URL(c.req.url).searchParams.get('limit'));
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 15;
  try {
    return c.json(await crawlBandsintown(c.env, limit));
  } catch (err) {
    console.error('crawl failed:', err);
    return c.json({ error: 'crawl failed' }, 500);
  }
});

/** Enqueue every artist that isn't on the crawl queue yet (idempotent). */
admin.post('/crawl-queue', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  try {
    return c.json(await backfillCrawlQueue(c.env));
  } catch (err) {
    console.error('crawl-queue failed:', err);
    return c.json({ error: 'enqueue failed' }, 500);
  }
});

/**
 * One-off Bandsintown backfill over artists already in D1 — the phase-1
 * measurement of what Bandsintown adds on top of Ticketmaster. The scheduled
 * crawl (phase 3) replaces it; until then it's paged by hand.
 */
admin.post('/backfill-bandsintown', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  if (!c.env.BANDSINTOWN_APP_ID) return c.json({ error: 'Bandsintown not configured' }, 503);

  const url = new URL(c.req.url);
  const num = (key: string, fallback: number, max: number) => {
    const n = Number(url.searchParams.get(key));
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
  };
  // Bounded per call: each artist is one upstream request, and a Worker request
  // has a wall-clock budget.
  const limit = Math.max(num('limit', 20, 50), 1);
  const offset = num('offset', 0, 1_000_000);

  try {
    const result = await backfillBandsintown(c.env, limit, offset);
    const total = await getDb(c.env.DB)
      .select({ n: sql<number>`count(*)` })
      .from(artists)
      .get();
    return c.json({ ...result, offset, next_offset: offset + limit, artists_total: total?.n ?? null });
  } catch (err) {
    console.error('backfill-bandsintown failed:', err);
    return c.json({ error: 'backfill failed' }, 500);
  }
});

/**
 * Cluster venues and collapse shows that were stored twice before ingestion knew
 * how to match across sources. Idempotent — run it after adding a source, or
 * after a backfill that predates the matcher.
 */
admin.post('/repair-duplicates', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  try {
    return c.json(await repairDuplicates(getDb(c.env.DB)));
  } catch (err) {
    console.error('repair-duplicates failed:', err);
    return c.json({ error: 'repair failed' }, 500);
  }
});
