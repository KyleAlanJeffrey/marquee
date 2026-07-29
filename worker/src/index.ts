import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { admin } from './routes/admin';
import type { AppEnv, Env } from './env';
import { artists } from './routes/artists';
import { events } from './routes/events';
import { feed } from './routes/feed';
import { search } from './routes/search';
import { venues } from './routes/venues';
import { injectSeo, pageSeo, robotsTxt, sitemapXml } from './seo';
import { crawlBandsintown } from './sources';

// The Worker runs first for every request (run_worker_first). It handles the
// API under /api/* and hands everything else to the static assets (the Expo web
// build), which include an SPA fallback for client-routed deep links.
const api = new Hono<AppEnv>().basePath('/api');

api.use('*', cors());
api.get('/', (c) => c.json({ ok: true, service: 'marquee' }));

api.route('/', feed); // /nearby, /discover-events, /refresh-artist-events
api.route('/', search); // /search-artists
api.route('/artists', artists);
api.route('/venues', venues);
api.route('/events', events);
api.route('/admin', admin); // /health, /backfill-bandsintown

// Root app: API first, then static assets for everything else.
const app = new Hono<AppEnv>();
app.route('/', api);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

// --- SEO --------------------------------------------------------------------

app.get('/robots.txt', (c) =>
  c.text(robotsTxt(new URL(c.req.url).origin), 200, { 'Cache-Control': 'public, max-age=86400' }),
);

app.get('/sitemap.xml', async (c) => {
  const xml = await sitemapXml(c.env, new URL(c.req.url).origin);
  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    // The show list changes as events are ingested and expire.
    'Cache-Control': 'public, max-age=3600',
  });
});

// Static assets. Every HTML response is the same client-rendered shell, so its
// <head> gets rewritten for the requested route before it goes out (seo.ts).
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const url = new URL(c.req.url);
  if (c.req.method !== 'GET' || !res.headers.get('content-type')?.includes('text/html')) return res;

  const seo = await pageSeo(c.env, url.pathname, url.origin);
  return seo ? injectSeo(res, url, seo) : res;
});

/**
 * The artist crawl (see `crawlBandsintown`). Cron is the only way coverage stops
 * tracking traffic: before this, an artist nobody opened was never re-checked.
 * The batch is small because a scheduled Worker shares the same subrequest and
 * CPU budget as a request, and the queue is drained a little at a time.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env) => {
  try {
    console.log('crawl:', JSON.stringify(await crawlBandsintown(env)));
  } catch (err) {
    // Logged for the detail, then re-thrown: a scheduled handler that returns
    // normally is recorded as a successful invocation, and a crawl that never
    // works would look like a crawl that runs.
    console.error('crawl failed:', err);
    throw err;
  }
};

export default { fetch: app.fetch, scheduled };
