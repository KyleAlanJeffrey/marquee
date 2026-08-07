import { Hono } from 'hono';

import { admin } from './routes/admin';
import type { JobsAppEnv, JobsEnv } from './env';
import { submitFresh } from './indexnow';
import { crawlBandsintown } from './sources';

/**
 * The jobs Worker (`marquee-jobs`) — everything that isn't serving the site.
 *
 * The website Worker used to carry all of this too, which meant the 15-minute
 * crawl spent the same CPU and subrequest budgets as page requests, and a bad
 * deploy of ingestion code could take the site down with it. The two halves
 * also change at different speeds. So: same repo, same D1, two Workers — this
 * one owns the Cron Trigger, IndexNow submissions, and the admin endpoints.
 *
 * Admin keeps its `/api/admin/*` paths so the operator scripts only change
 * origin, not shape.
 */
const app = new Hono<JobsAppEnv>().basePath('/api');

app.get('/', (c) => c.json({ ok: true, service: 'marquee-jobs' }));
app.route('/admin', admin);

/**
 * The artist crawl (see `crawlBandsintown`). Cron is the only way coverage stops
 * tracking traffic: before this, an artist nobody opened was never re-checked.
 * The batch is small because a scheduled Worker shares the same subrequest and
 * CPU budget as a request, and the queue is drained a little at a time.
 */
/**
 * Which tick of the day re-runs ANALYZE. 09:00 UTC is early morning in the US
 * and the middle of the working day in Europe — the crawl is the only thing
 * else awake either way, and the statement measured 197ms on the production
 * catalogue, so the hour is a preference rather than a constraint. The cron
 * fires every 15 minutes, so the minute window picks exactly one of them.
 */
const ANALYZE_HOUR_UTC = 9;

/**
 * Refresh the query planner's statistics.
 *
 * SQLite plans with `sqlite_stat1` or, without it, with guesses. Production ran
 * for months on the guesses and they were wrong where it hurt most: on the
 * /api/nearby predicate the planner drove from the date index and read 93,049
 * rows in 277ms, where the geo bounding box reads 6,634 in 6.5ms for the same
 * answer (measured 2026-08-07; migration 0022 has the details). ANALYZE alone
 * flipped it, with no query change.
 *
 * It runs daily because statistics are a snapshot and the crawl writes
 * continuously — a catalogue that doubles under stale stats can talk the
 * planner back into the bad plan. Failure is logged, never thrown: out-of-date
 * statistics are a slow site, but a scheduled handler that dies here would
 * abandon the crawl, which is a site that stops learning about shows.
 */
async function refreshPlannerStats(env: JobsEnv, scheduledTime: number) {
  const at = new Date(scheduledTime);
  if (at.getUTCHours() !== ANALYZE_HOUR_UTC || at.getUTCMinutes() >= 15) return;
  try {
    const started = Date.now();
    await env.DB.prepare('ANALYZE').run();
    console.log('analyze: ok in', Date.now() - started, 'ms');
  } catch (err) {
    console.warn('analyze failed:', err);
  }
}

const scheduled: ExportedHandlerScheduledHandler<JobsEnv> = async (event, env) => {
  // Read before the crawl, so "created since" names exactly what this run wrote.
  const since = new Date().toISOString().slice(0, 19) + 'Z';
  let failure: unknown = null;
  try {
    console.log('crawl:', JSON.stringify(await crawlBandsintown(env)));
  } catch (err) {
    console.error('crawl failed:', err);
    failure = err;
  }

  // Announce whatever it managed to write, even if it then fell over — the shows
  // are in the database either way, and this is the only fast path to being
  // indexed. A failed ping must never fail the crawl.
  try {
    const result = await submitFresh(env, since);
    if (result) console.log('indexnow:', JSON.stringify(result));
  } catch (err) {
    console.warn('indexnow failed:', err);
  }

  // After the crawl, so the statistics describe the catalogue including
  // whatever this run just wrote.
  await refreshPlannerStats(env, event.scheduledTime);

  // Re-thrown rather than swallowed: a scheduled handler that returns normally is
  // recorded as a successful invocation, and a crawl that never works would look
  // like a crawl that runs.
  if (failure) throw failure;
};

export default { fetch: app.fetch, scheduled };
