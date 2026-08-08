import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';

import type { AppEnv, Env } from './env';
import { artists } from './routes/artists';
import { events } from './routes/events';
import { feed } from './routes/feed';
import { lists } from './routes/lists';
import { me } from './routes/me';
import { people } from './routes/people';
import { reviewRoutes } from './routes/reviews';
import { search } from './routes/search';
import { venues } from './routes/venues';
import { curated } from './routes/curated';
import { clerkSignedInHint } from './auth';
import { cityPage } from './cities';
import { artistImage } from './images';
import { landingPage } from './landing';
import { privacyPage } from './policy';
import { injectSeo, pageSeo, robotsTxt, robotsTxtOffBrand, sitemapChild, sitemapIndex } from './seo';

// The Worker runs first for every request (run_worker_first). It handles the
// API under /api/* and hands everything else to the static assets (the Expo web
// build), which include an SPA fallback for client-routed deep links.
const api = new Hono<AppEnv>().basePath('/api');

// The hot reads — /nearby, /following, /venues/nearby, /events/by-ids — are all
// POST with a JSON body, which always triggers a CORS preflight. Without a
// max-age the browser re-asks before every one of them, doubling the round trips on
// exactly the endpoints that can least afford it. A day is the Chromium cap.
api.use('*', cors({ maxAge: 86400 }));
api.get('/', (c) => c.json({ ok: true, service: 'marquee' }));

api.route('/', feed); // /nearby, /discover-events, /refresh-artist-events
api.route('/', search); // /search-artists
api.route('/artists', artists);
api.route('/venues', venues);
api.route('/events', events);
api.route('/me', me); // who the bearer token says this is
api.route('/me/lists', lists); // the four on-device lists, kept for this account
api.route('/users', people); // public profiles + the person graph (docs/social.md phase A)
api.route('/', reviewRoutes); // public reviews + reports (phase B): /events/:id/review(s), /reviews/:id/report
api.route('/curated-lists', curated); // curated lists (phase E)
// /api/admin/* lives on the jobs Worker now (worker/src/jobs.ts), with the cron.

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
 * The image mirror: an artist's image from our R2 instead of a hotlink, mirrored
 * on first demand and redirecting to the upstream URL on any miss or failure —
 * this route can serve worse than the hotlink did, never nothing.
 */
app.get('/img/artist/:id', async (c) => {
  const resp = await artistImage(c.env, c.req.param('id'));
  return resp ?? c.notFound();
});

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
 * Cheap to regenerate and never personalised, so the edge holds a copy.
 *
 * Who honours which directive, because they are not the same audience:
 * `max-age=300` is the reader's own browser, `s-maxage=1800` is the stored TTL
 * at the edge (see `cachedPage` — the Cache API is what makes it real), and
 * `stale-while-revalidate` is browsers only. The Workers Cache API does not
 * serve stale and refresh behind your back; `match` returns fresh entries or
 * nothing, so the first request after 30 minutes re-renders and pays for it.
 * Serving stale from the edge would mean tracking freshness ourselves.
 */
const PAGE_CACHE = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400';

/**
 * Where a rendered page is keyed in the edge cache.
 *
 * The canonical origin plus the path, and deliberately **not** the query string:
 * none of these three pages reads one, so keying on the full URL would mint a
 * separate entry for every `?utm_source=…` a share adds and miss on all of them.
 *
 * Plus the deployment id, because nothing else tells the cache a deploy just
 * made its contents wrong. Without it, changing the copy on a page and shipping
 * it means the *old* copy keeps going out until `s-maxage` expires — half an
 * hour of serving text you already fixed, with no way to force it: the key
 * ignores the query string, so a cache-buster can't reach past it either. The
 * id changes on every deploy, so each one starts a clean namespace and the
 * entries it orphans expire on their own.
 */
const pageCacheKey = (c: Context<AppEnv>) => {
  const url = new URL(new URL(c.req.url).pathname, siteOrigin(c));
  // A query param on the key, not the path: it must not collide with a real URL.
  if (c.env.CF_VERSION?.id) url.searchParams.set('__v', c.env.CF_VERSION.id);
  return new Request(url.toString(), { method: 'GET' });
};

/**
 * Serve a rendered page through the edge cache.
 *
 * `PAGE_CACHE` was already on these responses and was doing nothing: Cloudflare
 * does not cache a Worker's HTML by default, whatever `s-maxage` says, so every
 * hit paid the full render. Measured before this: `/` 1.93–3.32s and five D1
 * queries, `/concerts/:slug` 2.09–2.24s and four — one of which, `allTowns`,
 * reads 158,625 rows on its own — and neither response carried a
 * `cf-cache-status` header at all, while static assets showed `HIT`.
 *
 * The Cache API is the part that was missing. `s-maxage=1800` now actually
 * means something: it's the stored TTL, while browsers keep their own copy for
 * `max-age=300`.
 *
 * Off-brand hosts (the `*.workers.dev` deploy URL) neither read nor write it.
 * Their HTML differs — canonicals are written from the requested origin, and
 * the noindex middleware above stamps them — so sharing entries with the real
 * domain would leak one into the other in whichever direction raced first.
 *
 * `X-Marquee-Cache` is here to make the thing verifiable from outside; the
 * whole finding was that a caching header can lie about caching happening.
 */
async function cachedPage(
  c: Context<AppEnv>,
  // A renderer may answer with a `Response` instead of HTML — a 404 for a slug
  // no town claims, a 301 to a spelling we still publish. Those are returned
  // untouched and never stored: the cache is for pages, and a redirect held for
  // half an hour is a redirect that outlives the rename that caused it.
  render: () => string | Response | Promise<string | Response>,
  // `browserCache` replaces the Cache-Control the *reader* sees — the copy in
  // the edge cache keeps PAGE_CACHE, so the edge TTL doesn't change. It exists
  // for `/`, which forks on a session cookie and so must not sit in a browser
  // for four hours; see the route. Set on the hit path too, and not as a
  // nicety: serving from `caches.default` is exactly when Cloudflare rewrites
  // the stored max-age=300 to the zone's 14400 (measured, both hosts), so a
  // hit that didn't restate its Cache-Control would undo this.
  opts?: { browserCache?: string },
) {
  const shareable = !offBrandHost(c);
  const key = shareable ? pageCacheKey(c) : null;

  if (key) {
    // Before the renderer, which is the entire point: a hit on `/concerts/:slug`
    // skips four D1 queries, one of which reads 158,625 rows.
    const hit = await caches.default.match(key);
    // Copied rather than returned as-is: a response handed back by the cache
    // has immutable headers, and the middleware above still wants to stamp it.
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('X-Marquee-Cache', 'HIT');
      if (opts?.browserCache) res.headers.set('Cache-Control', opts.browserCache);
      return res;
    }
  }

  const rendered = await render();
  if (rendered instanceof Response) return rendered;

  const res = c.html(rendered, 200, {
    'Cache-Control': PAGE_CACHE,
    'X-Marquee-Cache': shareable ? 'MISS' : 'BYPASS',
  });
  if (key) {
    // The clone goes to the cache and the original to the reader, so filling
    // the cache never delays the response that missed. Cloned before the
    // browser-facing header goes on: the stored copy's s-maxage is the edge TTL.
    c.executionCtx.waitUntil(caches.default.put(key, res.clone()));
  }
  if (opts?.browserCache) res.headers.set('Cache-Control', opts.browserCache);
  return res;
}

/**
 * The landing page, at the address that actually collects links.
 *
 * `/` used to be the app's feed: every inbound link, every share and every crawl
 * arrived at a spinner and nine words of chrome, while the page with a thousand
 * words of listings sat at `/concerts` earning its own way from nothing. So they
 * swapped — the feed is `/explore` now, and this is the front door.
 *
 * The front door forks on identity: a visitor with a Clerk session cookie has
 * an account, and an account-holder standing at `/` wants the app, not the
 * pitch for it — which is also where Clerk's own after-auth default delivers
 * people, so without this a completed sign-in could dead-end on the marketing
 * page. The redirect is never cached (`no-store`), and the page itself tells
 * browsers to revalidate (`max-age=0` — costs one edge round-trip, ~0.3s warm)
 * because the alternative was measured at four hours of a locally-cached
 * marketing page that no sign-in could get past. Crawlers carry no cookie and
 * see none of this.
 */
app.get('/', (c) => {
  if (clerkSignedInHint(c.req.header('Cookie'))) {
    c.header('Cache-Control', 'no-store');
    return c.redirect('/explore', 302);
  }
  return cachedPage(c, () => landingPage(c.env, siteOrigin(c)), {
    browserCache: 'public, max-age=0, must-revalidate',
  });
});

/** Where the landing page used to live. Its links and its indexing belong to `/`. */
app.get('/concerts', (c) => c.redirect('/', 301));

// The privacy policy and published contact — the URL three store forms ask for.
app.get('/privacy', (c) => cachedPage(c, () => privacyPage(siteOrigin(c))));

app.get('/concerts/:slug', (c) =>
  cachedPage(c, async () => {
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
    return found.html;
  }),
);

/**
 * A filename with a content hash in it — `entry-<32 hex>.js`,
 * `Anybody_400Regular.<32 hex>.ttf`. The hash *is* the cache key: change the
 * bytes and you change the URL, so the old one can never be wrong.
 *
 * Deliberately strict about the 32 hex digits. Everything unhashed —
 * `favicon.ico`, `og-image.png`, `manifest.json` — must not match, because for
 * those the URL outlives the content and `immutable` would strand a stale copy
 * in every browser that ever loaded it.
 */
const HASHED_ASSET = /[.-][0-9a-f]{32}\.[a-z0-9]+$/i;

/**
 * A year, and `immutable` so browsers don't even revalidate.
 *
 * The export was going out as `public, max-age=0, must-revalidate` on
 * content-hashed filenames — a conditional request on every load, for a
 * 749 KB bundle and six fonts, to be told nothing changed.
 */
const IMMUTABLE_ASSET = 'public, max-age=31536000, immutable';

// Static assets. Every HTML response is the same client-rendered shell, so its
// <head> gets rewritten for the requested route before it goes out (seo.ts).
app.all('*', async (c) => {
  const url = new URL(c.req.url);

  // Expo writes scoped-package asset paths with a literal `@`, and the asset
  // server answers those with a 307 to the percent-encoded spelling. The six
  // font `<link rel=preload>` tags in the export all point at the literal form,
  // so each one paid a redirect before it could begin downloading — measured at
  // 0.37s for the 307 and 0.49s for the round trip that followed. Ask for the
  // spelling the asset server actually serves.
  const assetReq = url.pathname.includes('@')
    ? new Request(new URL(url.pathname.replace(/@/g, '%40') + url.search, url.origin), c.req.raw)
    : c.req.raw;

  const res = await c.env.ASSETS.fetch(assetReq);

  if (c.req.method === 'GET' && res.ok && HASHED_ASSET.test(url.pathname)) {
    const cached = new Response(res.body, res);
    cached.headers.set('Cache-Control', IMMUTABLE_ASSET);
    return cached;
  }

  if (c.req.method !== 'GET' || !res.headers.get('content-type')?.includes('text/html')) return res;

  // Metadata is written with the canonical origin, whichever host served this.
  const canonicalUrl = new URL(url.pathname + url.search, siteOrigin(c));
  const seo = await pageSeo(c.env, url.pathname, canonicalUrl.origin);
  return seo ? injectSeo(res, canonicalUrl, seo) : res;
});

// The cron crawl and IndexNow submissions live on the jobs Worker
// (worker/src/jobs.ts) — this one only serves requests.
export default { fetch: app.fetch };
