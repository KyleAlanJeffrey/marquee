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
const scheduled: ExportedHandlerScheduledHandler<JobsEnv> = async (_event, env) => {
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

  // Re-thrown rather than swallowed: a scheduled handler that returns normally is
  // recorded as a successful invocation, and a crawl that never works would look
  // like a crawl that runs.
  if (failure) throw failure;
};

export default { fetch: app.fetch, scheduled };
