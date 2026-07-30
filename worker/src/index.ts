import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { admin } from './routes/admin';
import type { AppEnv, Env } from './env';
import { artists } from './routes/artists';
import { events } from './routes/events';
import { feed } from './routes/feed';
import { search } from './routes/search';
import { venues } from './routes/venues';
import { landingPage } from './landing';
import { injectSeo, pageSeo, robotsTxt, robotsTxtOffBrand, sitemapXml } from './seo';
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

/**
 * The origin every public URL should be written with — see `PRIMARY_HOST`.
 * Falls back to the requested origin so local dev stays self-consistent.
 */
const siteOrigin = (c: { env: Env; req: { url: string } }) =>
  c.env.PRIMARY_HOST ? `https://${c.env.PRIMARY_HOST}` : new URL(c.req.url).origin;

/** Whether this request came in on some host other than the canonical one. */
const offBrandHost = (c: { env: Env; req: { header: (k: string) => string | undefined } }) => {
  const primary = c.env.PRIMARY_HOST;
  if (!primary) return false;
  const host = (c.req.header('host') ?? '').split(':')[0].toLowerCase();
  return host !== primary.toLowerCase() && host !== `www.${primary.toLowerCase()}`;
};

/**
 * Keep the `*.workers.dev` copy of the site out of the index.
 *
 * Not a redirect: the deploy URL is what the repair script and native builds talk
 * to, and a 301 on a POST silently drops the body. A header does the whole job —
 * canonicals already point at the real domain, and this makes the duplicate
 * unindexable rather than merely un-preferred.
 */
app.use('*', async (c, next) => {
  await next();
  if (offBrandHost(c) && c.res.headers.get('content-type')?.includes('text/html')) {
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
});

// --- SEO --------------------------------------------------------------------

app.get('/robots.txt', (c) =>
  c.text(offBrandHost(c) ? robotsTxtOffBrand() : robotsTxt(siteOrigin(c)), 200, {
    'Cache-Control': 'public, max-age=86400',
  }),
);

app.get('/sitemap.xml', async (c) => {
  const xml = await sitemapXml(c.env, siteOrigin(c));
  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    // The show list changes as events are ingested and expire.
    'Cache-Control': 'public, max-age=3600',
  });
});

/**
 * The one page on the site that is real HTML rather than the SPA shell. Registered
 * before the asset handler so it wins over the export's SPA fallback.
 */
app.get('/concerts', async (c) => {
  const html = await landingPage(c.env, siteOrigin(c));
  return c.html(html, 200, {
    // Cheap to regenerate and never personalised, so let the edge hold it and
    // serve the stale copy while it refreshes.
    'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400',
  });
});

// Static assets. Every HTML response is the same client-rendered shell, so its
// <head> gets rewritten for the requested route before it goes out (seo.ts).
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const url = new URL(c.req.url);
  if (c.req.method !== 'GET' || !res.headers.get('content-type')?.includes('text/html')) return res;

  // Metadata is written with the canonical origin, whichever host served this.
  const canonicalUrl = new URL(url.pathname + url.search, siteOrigin(c));
  const seo = await pageSeo(c.env, url.pathname, canonicalUrl.origin);
  return seo ? injectSeo(res, canonicalUrl, seo) : res;
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
