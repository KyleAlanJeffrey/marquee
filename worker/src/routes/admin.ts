import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

import { crawlQueueStats, ingestStats, repairDuplicates } from '../data';
import { getDb } from '../db';
import type { AppEnv, Env } from '../env';
import { artists, events } from '../schema';
import { backfillBandsintown, backfillCrawlQueue, crawlBandsintown, ingestSeatGeek } from '../sources';

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
  seatgeek: Boolean(env.SEATGEEK_CLIENT_ID),
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
    ok = false;
  }
  return c.json(
    { ok, configured, events_by_source: counts, silent_sources: silent, crawl_queue: queue },
    ok ? 200 : 500,
  );
});

/**
 * What ingestion has actually been doing: runs per source, what they produced,
 * when each source last inserted anything, and upcoming events per town per
 * source. A source that keeps succeeding while inserting nothing is exactly how
 * Bandsintown managed to contribute zero for weeks.
 */
admin.get('/stats', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  const n = Number(new URL(c.req.url).searchParams.get('days'));
  const days = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 90) : 7;
  try {
    const stats = await ingestStats(getDb(c.env.DB), days);
    // Called out rather than left to be spotted in the table.
    const silent = stats.runs.filter((r) => r.runs > 0 && !r.inserted).map((r) => `${r.source}/${r.kind}`);
    return c.json({ ...stats, yielding_nothing: silent });
  } catch (err) {
    console.error('stats failed:', err);
    return c.json({ error: 'stats failed' }, 500);
  }
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

/**
 * Sweep one area with SeatGeek alone, ignoring the six-hour cell throttle that
 * `/api/discover-events` applies — the only way to check a fresh key or a new
 * metro without waiting the window out.
 */
admin.post('/discover-seatgeek', async (c) => {
  if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401);
  if (!c.env.SEATGEEK_CLIENT_ID) return c.json({ error: 'SeatGeek not configured' }, 503);
  const url = new URL(c.req.url);
  // An absent parameter takes the default; one that was supplied and isn't a
  // number is an error, not a default. `Number('')` is 0, so `?lat=` would
  // otherwise sweep the Gulf of Guinea and report success.
  const num = (key: string, fallback: number): number | null => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const lat = num('lat', 37.7749);
  const lng = num('lng', -122.4194);
  const rawRadius = num('radius', 25);
  if (lat === null || lng === null || rawRadius === null) {
    return c.json({ error: 'lat, lng and radius must be numbers' }, 400);
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: 'lat/lng out of range' }, 400);
  const radius = Math.min(Math.max(rawRadius, 1), 150);
  try {
    return c.json(await ingestSeatGeek(c.env, lat, lng, radius));
  } catch (err) {
    console.error('discover-seatgeek failed:', err);
    return c.json({ error: 'discovery failed' }, 500);
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
    // `?after=<artist id>` resumes a scan that hit its ceiling; the response's
    // `next_artist_id` is what to pass back.
    const after = new URL(c.req.url).searchParams.get('after')?.trim() || undefined;
    return c.json(await repairDuplicates(getDb(c.env.DB), { afterArtistId: after }));
  } catch (err) {
    console.error('repair-duplicates failed:', err);
    return c.json({ error: 'repair failed' }, 500);
  }
});
