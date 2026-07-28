import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { getDb } from './db';
import type { Env } from './env';
import { artists, events, venues } from './schema';

// The web app is a client-rendered SPA: the HTML that Cloudflare serves for
// /event/<uuid> is the same empty shell for every event, so a crawler that
// doesn't run JavaScript sees no title, no description and no structured data.
//
// The Worker already runs in front of the assets (run_worker_first), so it can
// look the route up in D1 and rewrite the shell's <head> on the way out —
// real titles, descriptions, canonicals, social cards and schema.org JSON-LD
// with zero client cost. It also serves robots.txt and a live sitemap.
//
// Keep the copy here in sync with src/app/+html.tsx and
// src/components/page-meta.web.tsx (the client-side equivalents).

const NAME = 'Marquee';
const DEFAULT_TITLE = 'Marquee — Find concerts near you';
const DEFAULT_DESCRIPTION =
  'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show.';
const OG_IMAGE = '/og-image.png';

/** Routes the Expo export prerenders. Everything else is a dynamic detail page. */
const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  '/browse': {
    title: `Browse concerts near you · ${NAME}`,
    description: 'Every upcoming show inside your radius, filterable by genre — grid, list or map.',
  },
  '/map': {
    title: `Concert map · ${NAME}`,
    description: 'Every upcoming concert near you, plotted on a map by venue.',
  },
  '/search': {
    title: `Find artists · ${NAME}`,
    description:
      'Search millions of artists and follow the ones you love to track their upcoming tour dates near you.',
  },
  '/following': {
    title: `Artists you follow · ${NAME}`,
    description: "The artists you follow on Marquee, with their next show near you and a reminder before doors.",
  },
  '/settings': {
    title: `Profile · ${NAME}`,
    description: 'Your Marquee search radius, reminders and notification settings.',
  },
};

export type PageSeo = {
  title: string;
  description: string;
  /** Absolute or root-relative; falls back to the default social card. */
  image?: string | null;
  /** schema.org graph appended to <head>. */
  jsonLd?: unknown;
  /** Detail pages we couldn't resolve shouldn't be indexed. */
  noindex?: boolean;
};

// --- helpers ----------------------------------------------------------------

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function place(city: string | null, region: string | null): string {
  return [city, region].filter(Boolean).join(', ');
}

const absolute = (origin: string, url: string) => (/^https?:\/\//.test(url) ? url : origin + url);

/** JSON-LD is injected raw, so close off the one sequence that could break out. */
const ldJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- robots.txt -------------------------------------------------------------

export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    // expo-router's dev route listing ships with the export.
    'Disallow: /_sitemap',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

// --- sitemap.xml ------------------------------------------------------------

/** Static routes plus every upcoming event and the artists/venues behind them. */
export async function sitemapXml(env: Env, origin: string): Promise<string> {
  const db = getDb(env.DB);
  const upcoming = gte(events.startsAt, nowIso());
  const today = new Date().toISOString().slice(0, 10);

  // lastmod is when we last wrote the row, not "now" — a sitemap that claims
  // every URL changed today gets its lastmod ignored.
  const [eventRows, artistRows, venueRows] = await Promise.all([
    db
      .select({ id: events.id, updated: events.createdAt })
      .from(events)
      .where(upcoming)
      .orderBy(events.startsAt)
      .limit(5000),
    db
      .select({ id: events.artistId, updated: sql<string>`max(${events.createdAt})` })
      .from(events)
      .where(upcoming)
      .groupBy(events.artistId)
      .limit(5000),
    db
      .select({ id: events.venueId, updated: sql<string>`max(${events.createdAt})` })
      .from(events)
      .where(and(upcoming, isNotNull(events.venueId)))
      .groupBy(events.venueId)
      .limit(5000),
  ]);

  const urls: string[] = [];
  const add = (path: string, lastmod: string, changefreq: string, priority: string) =>
    urls.push(
      `  <url><loc>${xml(origin + path)}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
    );

  add('/', today, 'daily', '1.0');
  add('/browse', today, 'daily', '0.9');
  add('/map', today, 'daily', '0.8');
  add('/search', today, 'weekly', '0.6');

  const day = (iso: string | null) => (iso ?? '').slice(0, 10) || today;

  // Events go stale the moment they happen, so they get the highest churn.
  for (const e of eventRows) add(`/event/${e.id}`, day(e.updated), 'daily', '0.8');
  for (const a of artistRows) add(`/artist/${a.id}`, day(a.updated), 'weekly', '0.7');
  for (const v of venueRows) if (v.id) add(`/venue/${v.id}`, day(v.updated), 'weekly', '0.6');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join(
    '\n',
  )}\n</urlset>\n`;
}

// --- per-page metadata ------------------------------------------------------

async function eventSeo(env: Env, id: string, origin: string): Promise<PageSeo | null> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      name: events.name,
      startsAt: events.startsAt,
      ticketUrl: events.ticketUrl,
      priceFrom: events.priceFrom,
      artistName: artists.name,
      artistImage: artists.imageUrl,
      artistGenres: artists.genres,
      venueName: venues.name,
      venueCity: venues.city,
      venueRegion: venues.region,
      venueCountry: venues.country,
      venueLat: venues.lat,
      venueLng: venues.lng,
    })
    .from(events)
    .innerJoin(artists, eq(artists.id, events.artistId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, id))
    .get();
  if (!row) return null;

  const where = row.venueName ? [row.venueName, place(row.venueCity, row.venueRegion)].filter(Boolean).join(', ') : '';
  const when = formatDate(row.startsAt);
  const title = [`${row.name}${row.venueName ? ` at ${row.venueName}` : ''}`, when].filter(Boolean).join(' — ');

  const location = row.venueName
    ? {
        '@type': 'MusicVenue',
        name: row.venueName,
        address: {
          '@type': 'PostalAddress',
          addressLocality: row.venueCity ?? undefined,
          addressRegion: row.venueRegion ?? undefined,
          addressCountry: row.venueCountry ?? undefined,
        },
        ...(row.venueLat != null && row.venueLng != null
          ? { geo: { '@type': 'GeoCoordinates', latitude: row.venueLat, longitude: row.venueLng } }
          : null),
      }
    : undefined;

  return {
    title: `${title} · ${NAME}`,
    description:
      `${row.name} plays ${where || 'live'} on ${when}. ` +
      'Tickets, lineup and what people are saying about the show.',
    image: row.artistImage,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: row.name,
      url: `${origin}/event/${id}`,
      startDate: row.startsAt,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      image: row.artistImage ?? absolute(origin, OG_IMAGE),
      location,
      performer: { '@type': 'MusicGroup', name: row.artistName },
      ...(row.ticketUrl
        ? {
            offers: {
              '@type': 'Offer',
              url: row.ticketUrl,
              availability: 'https://schema.org/InStock',
              ...(row.priceFrom != null ? { price: row.priceFrom, priceCurrency: 'USD' } : null),
            },
          }
        : null),
    },
  };
}

async function artistSeo(env: Env, id: string, origin: string): Promise<PageSeo | null> {
  const db = getDb(env.DB);
  const row = await db
    .select({ name: artists.name, image: artists.imageUrl, genres: artists.genres })
    .from(artists)
    .where(eq(artists.id, id))
    .get();
  if (!row) return null;

  const genres: string[] = (() => {
    try {
      const v = JSON.parse(row.genres);
      return Array.isArray(v) ? v.slice(0, 3) : [];
    } catch {
      return [];
    }
  })();

  const shows = await db
    .select({ id: events.id, name: events.name, startsAt: events.startsAt, venueName: venues.name })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.artistId, id), gte(events.startsAt, nowIso())))
    .orderBy(events.startsAt)
    .limit(10);

  const next = shows[0];
  return {
    title: `${row.name} tour dates & tickets · ${NAME}`,
    description:
      `${row.name}${genres.length ? ` (${genres.join(', ')})` : ''} upcoming concerts, tour dates and tickets` +
      `${next ? ` — next up ${next.venueName ?? 'live'} on ${formatDate(next.startsAt)}` : ''}.`,
    image: row.image,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'MusicGroup',
      name: row.name,
      url: `${origin}/artist/${id}`,
      ...(row.image ? { image: row.image } : null),
      ...(genres.length ? { genre: genres } : null),
      event: shows.map((s) => ({
        '@type': 'MusicEvent',
        name: s.name,
        url: `${origin}/event/${s.id}`,
        startDate: s.startsAt,
        ...(s.venueName ? { location: { '@type': 'MusicVenue', name: s.venueName } } : null),
      })),
    },
  };
}

async function venueSeo(env: Env, id: string, origin: string): Promise<PageSeo | null> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      name: venues.name,
      city: venues.city,
      region: venues.region,
      country: venues.country,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(venues)
    .where(eq(venues.id, id))
    .get();
  if (!row) return null;

  const upcoming = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.venueId, id), gte(events.startsAt, nowIso())))
    .get();
  const n = upcoming?.count ?? 0;
  const where = place(row.city, row.region);

  return {
    title: `${row.name}${where ? ` — ${where}` : ''} tickets & upcoming shows · ${NAME}`,
    description:
      `${n > 0 ? `${n} upcoming concert${n === 1 ? '' : 's'}` : 'Upcoming concerts'} at ${row.name}` +
      `${where ? ` in ${where}` : ''} — full lineup, dates, prices and tickets.`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'MusicVenue',
      name: row.name,
      url: `${origin}/venue/${id}`,
      address: {
        '@type': 'PostalAddress',
        addressLocality: row.city ?? undefined,
        addressRegion: row.region ?? undefined,
        addressCountry: row.country ?? undefined,
      },
      ...(row.lat != null && row.lng != null
        ? { geo: { '@type': 'GeoCoordinates', latitude: row.lat, longitude: row.lng } }
        : null),
    },
  };
}

/** Metadata for a page path, or null when the path isn't a page we describe. */
export async function pageSeo(env: Env, path: string, origin: string): Promise<PageSeo | null> {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const staticPage = STATIC_PAGES[clean];
  if (staticPage) return staticPage;

  const detail = /^\/(event|artist|venue)\/([^/]+)$/.exec(clean);
  // Unknown paths still get the SPA shell with a 200, so without this they'd
  // look like real pages to a crawler (a soft 404).
  if (!detail) return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, noindex: true };
  const [, kind, id] = detail;

  const resolved =
    kind === 'event'
      ? await eventSeo(env, id, origin)
      : kind === 'artist'
        ? await artistSeo(env, id, origin)
        : await venueSeo(env, id, origin);

  // A bad id renders "not found" in the app — don't let it into the index.
  return resolved ?? { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, noindex: true };
}

// --- injection --------------------------------------------------------------

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Rewrite the SPA shell's <head> for this specific URL. */
export function injectSeo(res: Response, url: URL, seo: PageSeo): Response {
  const origin = url.origin;
  const canonical = origin + (url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/');
  const custom = seo.image ? absolute(origin, seo.image) : null;
  const image = custom ?? absolute(origin, OG_IMAGE);

  // Some of these are written by the client (react-helmet, via <PageMeta />) and
  // some by src/app/+html.tsx, so rather than assume a tag is in the shell we
  // overwrite the ones we find and append whatever was missing before </head>.
  const tags = [
    { attr: 'name', key: 'robots', content: seo.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large' },
    { attr: 'name', key: 'description', content: seo.description },
    { attr: 'property', key: 'og:title', content: seo.title },
    { attr: 'property', key: 'og:description', content: seo.description },
    { attr: 'property', key: 'og:url', content: canonical },
    { attr: 'property', key: 'og:image', content: image },
    { attr: 'property', key: 'og:image:alt', content: seo.title },
    { attr: 'name', key: 'twitter:title', content: seo.title },
    { attr: 'name', key: 'twitter:description', content: seo.description },
    { attr: 'name', key: 'twitter:image', content: image },
  ] as const;

  const seen = new Set<string>();
  let sawCanonical = false;

  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(seo.title);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        sawCanonical = true;
        el.setAttribute('href', canonical);
      },
    })
    // The declared 1200x630 only describes the default card.
    .on('meta[property="og:image:width"], meta[property="og:image:height"]', {
      element(el) {
        if (custom) el.remove();
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag((end) => {
          const missing = tags
            .filter((t) => !seen.has(t.key))
            .map((t) => `<meta ${t.attr}="${t.key}" content="${escapeAttr(t.content)}">`);
          if (!sawCanonical) missing.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
          if (seo.jsonLd) missing.push(`<script type="application/ld+json">${ldJson(seo.jsonLd)}</script>`);
          if (missing.length) end.before(missing.join(''), { html: true });
        });
      },
    });

  for (const tag of tags) {
    rewriter.on(`meta[${tag.attr}="${tag.key}"]`, {
      element(el) {
        seen.add(tag.key);
        el.setAttribute('content', tag.content);
      },
    });
  }

  return rewriter.transform(res);
}
