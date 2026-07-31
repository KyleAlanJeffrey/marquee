import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { admin } from './routes/admin';
import type { AppEnv, Env } from './env';
import { artists } from './routes/artists';
import { events } from './routes/events';
import { feed } from './routes/feed';
import { me } from './routes/me';
import { search } from './routes/search';
import { venues } from './routes/venues';
import { cityPage } from './cities';
import { submitFresh } from './indexnow';
import { landingPage } from './landing';
import { injectSeo, pageSeo, robotsTxt, robotsTxtOffBrand, sitemapChild, sitemapIndex } from './seo';
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
api.route('/me', me); // who the bearer token says this is
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

// The show list changes as events are ingested and expire.
const SITEMAP_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
};

/**
 * IndexNow's ownership check: the crawler fetches `/<key>.txt` and expects the key
 * back. Anything else that looks like a key file falls through to the assets, so
 * this can't shadow a real file.
 */
// Note the regex holds no `{n,m}` quantifier: Hono ends a `:param{…}` pattern at
// the first `}`, so a quantifier there truncates the route and it silently never
// matches. Shape checks belong in the handler.
app.get('/:file{[A-Za-z0-9-]+\\.txt}', async (c, next) => {
  const key = c.env.INDEXNOW_KEY;
  if (!key || c.req.param('file') !== `${key}.txt`) return next();
  return c.text(key, 200, { 'Cache-Control': 'public, max-age=86400' });
});

app.get('/sitemap.xml', async (c) =>
  c.body(await sitemapIndex(c.env, siteOrigin(c)), 200, SITEMAP_HEADERS),
);

/**
 * The children the index points at: `/sitemap-pages.xml`, `/sitemap-events-3.xml`.
 * One document per 5,000 URLs, because a single one silently truncated at 5,000 and
 * left two thirds of the catalogue unlisted.
 */
app.get('/:file{sitemap-[a-z0-9-]+\\.xml}', async (c) => {
  const name = c.req.param('file').replace(/^sitemap-/, '').replace(/\.xml$/, '');
  const xml = await sitemapChild(c.env, siteOrigin(c), name);
  if (!xml) return c.notFound();
  return c.body(xml, 200, SITEMAP_HEADERS);
});

/**
 * The pages the Worker renders itself, as real HTML rather than the SPA shell.
 * Registered before the asset handler so they win over the export's SPA fallback.
 *
 * Cheap to regenerate and never personalised, so the edge holds them and serves
 * the stale copy while it refreshes.
 */
const PAGE_CACHE = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400';

/**
 * The landing page, at the address that actually collects links.
 *
 * `/` used to be the app's feed: every inbound link, every share and every crawl
 * arrived at a spinner and nine words of chrome, while the page with a thousand
 * words of listings sat at `/concerts` earning its own way from nothing. So they
 * swapped — the feed is `/explore` now, and this is the front door.
 */
app.get('/', async (c) =>
  c.html(await landingPage(c.env, siteOrigin(c)), 200, { 'Cache-Control': PAGE_CACHE }),
);

/** Where the landing page used to live. Its links and its indexing belong to `/`. */
app.get('/concerts', (c) => c.redirect('/', 301));

app.get('/concerts/:slug', async (c) => {
  const found = await cityPage(c.env, siteOrigin(c), c.req.param('slug'));
  // A slug no town answers to is a 404, not the SPA shell with a 200. Soft 404s
  // are the fastest way to teach a crawler that made-up URLs on this site work.
  if (!found) return c.notFound();
  // A spelling we no longer publish — `/concerts/london-gb` — is a URL already in
  // sitemaps and IndexNow submissions. Send it to the one we do, permanently, so the
  // ranking follows rather than splitting.
  if (found.kind === 'moved') {
    return c.redirect(`/concerts/${found.slug}`, 301);
  }
  return c.html(found.html, 200, { 'Cache-Control': PAGE_CACHE });
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
