import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { allTowns } from './cities';
import { clusterMemberIds, isoAt, stillUpcoming, TBD_GRACE_MS } from './data';
import type { DB } from './db';
import { getDb } from './db';
import { artistBody, eventBody, usdFrom, venueBody } from './detail';
import type { Env } from './env';
import { clampDesc, OG_IMAGE } from './page';
import { artists, events, venues } from './schema';
import { zoneFor } from './timezone';

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

/**
 * Routes the Expo export prerenders. Everything else is a dynamic detail page.
 *
 * `/` is not one of them any more: the Worker renders the landing page there itself,
 * so that path never reaches the shell for its head to be rewritten. The app's feed
 * is `/explore`.
 */
export const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/explore': {
    title: `Concerts near you · ${NAME}`,
    description:
      "The shows on near you in the next year — tonight's, this weekend's, and the ones worth planning around.",
  },
  '/browse': {
    title: `Browse concerts near you · ${NAME}`,
    description: 'Every upcoming show inside your radius, filterable by genre — grid, list or map.',
  },
  '/map': {
    title: `Concert map · ${NAME}`,
    description:
      'Every upcoming concert near you plotted on a map by venue — pan around to see what is on in any part of town.',
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
    description:
      'Set the point Marquee searches from, how far out to look for shows, and whether it reminds you before doors.',
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
  /**
   * A different URL to declare canonical — set when this path is a second address
   * for a page that already has one (a venue cluster member). Root-relative.
   */
  canonicalPath?: string;
  /**
   * Server-rendered markup for `#root` — see detail.ts. Present means the page has
   * something to say without JavaScript, and that the bundle should mount fresh
   * rather than try to hydrate it.
   */
  body?: string;
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

/** For any host that isn't the canonical one — see `PRIMARY_HOST` in env.ts. */
export function robotsTxtOffBrand(): string {
  return ['User-agent: *', 'Disallow: /', ''].join('\n');
}

// --- sitemap ----------------------------------------------------------------

/**
 * URLs per child sitemap. The protocol allows 50,000, but a smaller document is
 * quicker to build inside a Worker's budget and cheaper for a crawler to refetch
 * when one show in it changes.
 */
const SITEMAP_PAGE = 5000;

/**
 * A ceiling, so a runaway table can't ask the Worker to enumerate a million rows.
 * Crossing it is logged rather than silently obeyed — the single-document sitemap
 * this replaced dropped two thirds of the catalogue for months without a word.
 */
const SITEMAP_MAX_PAGES = 40;

type Kind = 'events' | 'artists' | 'venues';

const canonicalVenue = sql<string>`coalesce(${venues.canonicalVenueId}, ${venues.id})`;

/** How many URLs of each kind there are, so the index knows what to list. */
async function sitemapCounts(db: DB): Promise<Record<Kind, number>> {
  const upcoming = stillUpcoming();
  const [ev, ar, ve] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(events).where(upcoming).get(),
    db
      .select({ n: sql<number>`count(distinct ${events.artistId})` })
      .from(events)
      .where(upcoming)
      .get(),
    db
      .select({ n: sql<number>`count(distinct ${canonicalVenue})` })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(upcoming)
      .get(),
  ]);
  return { events: ev?.n ?? 0, artists: ar?.n ?? 0, venues: ve?.n ?? 0 };
}

const pagesFor = (count: number, kind: string): number => {
  // No rows, no child: an advertised sitemap that turns out to be an empty urlset
  // is reported back as an error, and `sitemap-pages.xml` is unconditional, so the
  // index can never end up empty either way.
  if (count === 0) return 0;
  const wanted = Math.ceil(count / SITEMAP_PAGE);
  if (wanted > SITEMAP_MAX_PAGES) {
    console.warn(
      `sitemap: ${count} ${kind} needs ${wanted} pages, capping at ${SITEMAP_MAX_PAGES} — ` +
        `${count - SITEMAP_MAX_PAGES * SITEMAP_PAGE} URLs will not be listed`,
    );
    return SITEMAP_MAX_PAGES;
  }
  return wanted;
};

/** `<sitemapindex>` — the document /sitemap.xml serves now. */
export async function sitemapIndex(env: Env, origin: string): Promise<string> {
  const db = getDb(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const counts = await sitemapCounts(db);

  const children = ['/sitemap-pages.xml'];
  for (const kind of ['events', 'artists', 'venues'] as Kind[]) {
    const pages = pagesFor(counts[kind], kind);
    for (let p = 1; p <= pages; p++) children.push(`/sitemap-${kind}-${p}.xml`);
  }

  const entries = children
    .map((path) => `  <sitemap><loc>${xml(origin + path)}</loc><lastmod>${today}</lastmod></sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

type Url = { path: string; lastmod: string; changefreq: string; priority: string };

const urlset = (origin: string, urls: Url[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${xml(origin + u.path)}</loc><lastmod>${u.lastmod}</lastmod>` +
        `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    )
    .join('\n')}\n</urlset>\n`;

/** The static routes and every city hub — the pages a crawler should start from. */
async function pagesSitemap(env: Env, origin: string): Promise<string> {
  const db = getDb(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const urls: Url[] = [
    // The landing page: server-rendered, and the hub that links to the city pages in
    // plain <a> tags. `/concerts` is not listed — it redirects here now.
    { path: '/', lastmod: today, changefreq: 'daily', priority: '1.0' },
    { path: '/explore', lastmod: today, changefreq: 'daily', priority: '0.9' },
    { path: '/browse', lastmod: today, changefreq: 'daily', priority: '0.9' },
    { path: '/map', lastmod: today, changefreq: 'daily', priority: '0.8' },
    { path: '/search', lastmod: today, changefreq: 'weekly', priority: '0.6' },
  ];

  // A town with nothing on is noindex on its own page, so it stays out of here too.
  for (const t of await allTowns(db)) {
    if (t.upcoming > 0) {
      urls.push({ path: `/concerts/${t.slug}`, lastmod: today, changefreq: 'daily', priority: '0.9' });
    }
  }
  return urlset(origin, urls);
}

/**
 * One page of detail URLs.
 *
 * Venues are listed by *canonical* id. The same room filed by three sources is one
 * venue everywhere else in the app, and volunteering the member ids offered Google
 * 154 URLs that were duplicates of another URL by construction.
 */
async function detailSitemap(env: Env, origin: string, kind: Kind, page: number): Promise<string> {
  const db = getDb(env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = stillUpcoming();
  const offset = (page - 1) * SITEMAP_PAGE;
  const day = (iso: string | null) => (iso ?? '').slice(0, 10) || today;

  if (kind === 'events') {
    const rows = await db
      .select({ id: events.id, updated: events.createdAt })
      .from(events)
      .where(upcoming)
      // id breaks the tie: an unstable order across pages means a URL that appears
      // twice and another that appears in no page at all.
      .orderBy(events.startsAt, events.id)
      .limit(SITEMAP_PAGE)
      .offset(offset);
    // Events go stale the moment they happen, so they get the highest churn.
    return urlset(
      origin,
      rows.map((e) => ({
        path: `/event/${e.id}`,
        lastmod: day(e.updated),
        changefreq: 'daily',
        priority: '0.8',
      })),
    );
  }

  if (kind === 'artists') {
    const rows = await db
      .select({ id: events.artistId, updated: sql<string>`max(${events.createdAt})` })
      .from(events)
      .where(upcoming)
      .groupBy(events.artistId)
      .orderBy(events.artistId)
      .limit(SITEMAP_PAGE)
      .offset(offset);
    return urlset(
      origin,
      rows.map((a) => ({
        path: `/artist/${a.id}`,
        lastmod: day(a.updated),
        changefreq: 'weekly',
        priority: '0.7',
      })),
    );
  }

  const rows = await db
    .select({ id: canonicalVenue, updated: sql<string>`max(${events.createdAt})` })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(upcoming, isNotNull(events.venueId)))
    .groupBy(canonicalVenue)
    .orderBy(canonicalVenue)
    .limit(SITEMAP_PAGE)
    .offset(offset);
  return urlset(
    origin,
    rows
      .filter((v) => v.id)
      .map((v) => ({
        path: `/venue/${v.id}`,
        lastmod: day(v.updated),
        changefreq: 'weekly',
        priority: '0.6',
      })),
  );
}

/**
 * A child sitemap by filename, or null when the name isn't one we publish.
 *
 * Names are matched rather than parsed loosely: an unbounded page number would let
 * anyone ask the Worker for `/sitemap-events-99999.xml` and pay for the scan.
 */
export async function sitemapChild(env: Env, origin: string, name: string): Promise<string | null> {
  if (name === 'pages') return pagesSitemap(env, origin);
  const m = /^(events|artists|venues)-(\d{1,3})$/.exec(name);
  if (!m) return null;
  const kind = m[1] as Kind;
  const page = Number(m[2]);
  if (page < 1 || page > SITEMAP_MAX_PAGES) return null;
  return detailSitemap(env, origin, kind, page);
}

// --- per-page metadata ------------------------------------------------------

async function eventSeo(env: Env, id: string, origin: string): Promise<PageSeo | null> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      name: events.name,
      startsAt: events.startsAt,
      timeUnknown: events.timeUnknown,
      ticketUrl: events.ticketUrl,
      priceFrom: events.priceFrom,
      artistId: events.artistId,
      artistName: artists.name,
      artistImage: artists.imageUrl,
      artistGenres: artists.genres,
      venueId: sql<string | null>`coalesce(${venues.canonicalVenueId}, ${venues.id})`,
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

  // The rest of this act's tour: the internal links a crawler follows out of here,
  // and the question anyone on the page is about to ask. One indexed range scan on
  // events_artist_idx(artist_id, starts_at).
  const alsoPlaying = await db
    .select({
      id: events.id,
      startsAt: events.startsAt,
      venueName: venues.name,
      city: venues.city,
      region: venues.region,
      country: venues.country,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.artistId, row.artistId), stillUpcoming(), ne(events.id, id)))
    .orderBy(events.startsAt)
    .limit(8);

  const where = row.venueName ? [row.venueName, place(row.venueCity, row.venueRegion)].filter(Boolean).join(', ') : '';
  const when = formatDate(row.startsAt);
  const usd = usdFrom(row.priceFrom, row.venueCountry);
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
    description: `${row.name} plays ${where || 'live'} on ${when}. Doors, tickets and the rest of the tour.`,
    // A show that has happened is a dead page: nothing to buy, nothing to attend,
    // and it will never be right again. Kept crawlable for its links, out of the
    // index for the same reason a newspaper doesn't reprint last week's listings.
    // A time-unknown show's timestamp is noon at the venue; it isn't over —
    // and shouldn't fall out of the index — until midnight there.
    noindex: row.startsAt < (row.timeUnknown ? isoAt(Date.now() - TBD_GRACE_MS) : nowIso()),
    image: row.artistImage,
    body: eventBody({
      id,
      name: row.name,
      startsAt: row.startsAt,
      timeUnknown: row.timeUnknown,
      zone: zoneFor(row.venueRegion, row.venueCountry),
      ticketUrl: row.ticketUrl,
      priceFrom: row.priceFrom,
      artistId: row.artistId,
      artistName: row.artistName,
      venueId: row.venueId,
      venueName: row.venueName,
      city: row.venueCity,
      region: row.venueRegion,
      country: row.venueCountry,
      // Each date in its own venue's timezone — a Manila show read in London time is
      // off by a day, and a tour list is mostly other countries.
      alsoPlaying: alsoPlaying.map((s) => ({ ...s, zone: zoneFor(s.region, s.country) })),
    }),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: row.name,
      url: `${origin}/event/${id}`,
      // Date-only for an unannounced set time — schema.org allows it, and a
      // noon placeholder published as a startDate would be machine-read as fact.
      startDate: row.timeUnknown ? row.startsAt.slice(0, 10) : row.startsAt,
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
              // Same rule as the page body: no currency column, so only claim USD
              // where the feed's local currency is USD. See `usdFrom`.
              ...(usd != null ? { price: usd, priceCurrency: 'USD' } : null),
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

  // One over the page's limit, only to know whether to say "more in the app".
  const SHOWS = 24;
  const canon = alias(venues, 'canon');
  const shows = await db
    .select({
      id: events.id,
      name: events.name,
      startsAt: events.startsAt,
      timeUnknown: events.timeUnknown,
      venueId: canon.id,
      venueName: venues.name,
      city: venues.city,
      region: venues.region,
      country: venues.country,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    // Linked by cluster head: a member id is a second URL for the same room, and
    // venueSeo canonicals it away — no reason to spend a link on it.
    .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
    .where(and(eq(events.artistId, id), stillUpcoming()))
    .orderBy(events.startsAt)
    .limit(SHOWS + 1);

  const next = shows[0];
  return {
    title: `${row.name} tour dates & tickets · ${NAME}`,
    description:
      `${row.name}${genres.length ? ` (${genres.slice(0, 2).join(', ')})` : ''} upcoming concerts, tour dates and tickets` +
      `${next ? ` — next up ${next.venueName ?? 'live'} on ${formatDate(next.startsAt)}` : ''}.`,
    // An artist with nothing booked is a page whose entire content is "no upcoming
    // shows". There are tens of thousands of those in the catalogue and indexing
    // them teaches Google the site is mostly empty pages.
    noindex: shows.length === 0,
    image: row.image,
    body: artistBody({
      id,
      name: row.name,
      genres,
      shows: shows.slice(0, SHOWS).map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        timeUnknown: s.timeUnknown,
        zone: zoneFor(s.region, s.country),
        venueId: s.venueId,
        venueName: s.venueName,
        city: s.city,
        region: s.region,
        country: s.country,
      })),
      truncated: shows.length > SHOWS,
    }),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'MusicGroup',
      name: row.name,
      url: `${origin}/artist/${id}`,
      ...(row.image ? { image: row.image } : null),
      ...(genres.length ? { genre: genres } : null),
      event: shows.slice(0, 10).map((s) => ({
        '@type': 'MusicEvent',
        name: s.name,
        url: `${origin}/event/${s.id}`,
        startDate: s.timeUnknown ? s.startsAt.slice(0, 10) : s.startsAt,
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
      canonicalVenueId: venues.canonicalVenueId,
    })
    .from(venues)
    .where(eq(venues.id, id))
    .get();
  if (!row) return null;

  // The room, not the row: three sources filing the same venue is one cluster, and
  // the app shows the cluster's whole calendar on any of its ids. Counting only
  // this row's own events would under-report a venue that merged.
  const cluster = await clusterMemberIds(db, [id]);
  const head = row.canonicalVenueId ?? id;
  const SHOWS = 30;
  const [upcoming, shows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(and(inArray(events.venueId, cluster), stillUpcoming()))
      .get(),
    db
      .select({
        id: events.id,
        startsAt: events.startsAt,
        timeUnknown: events.timeUnknown,
        artistId: events.artistId,
        artistName: artists.name,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .where(and(inArray(events.venueId, cluster), stillUpcoming()))
      .orderBy(events.startsAt)
      .limit(SHOWS),
  ]);
  const n = upcoming?.count ?? 0;
  const where = place(row.city, row.region);
  const zone = zoneFor(row.region, row.country);

  return {
    title: `${row.name}${where ? ` — ${where}` : ''} tickets & upcoming shows · ${NAME}`,
    description:
      `${n > 0 ? `${n} upcoming concert${n === 1 ? '' : 's'}` : 'Upcoming concerts'} at ${row.name}` +
      `${where ? ` in ${where}` : ''} — full lineup, dates and tickets.`,
    // A room with nothing booked has nothing to say, and there are thousands of
    // them behind expired listings. Only the head carries it, though: `noindex`
    // and a canonical pointing elsewhere on the same URL are contradictory
    // instructions, and Google resolves them by propagating the noindex to the
    // canonical target — which would take the head down with the member. An empty
    // cluster's head is noindex on its own page anyway.
    noindex: head === id && n === 0,
    // Every member id renders the same room from the same cluster, so only the
    // head is a page. Without this, a venue that merged three ways is three URLs
    // competing with each other for the same query.
    ...(head !== id ? { canonicalPath: `/venue/${head}` } : null),
    body: venueBody({
      id,
      name: row.name,
      city: row.city,
      region: row.region,
      country: row.country,
      upcoming: n,
      shows: shows.map((s) => ({ ...s, zone })),
      truncated: n > shows.length,
    }),
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
  const self = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
  const canonical = origin + (seo.canonicalPath ?? self);
  const custom = seo.image ? absolute(origin, seo.image) : null;
  const image = custom ?? absolute(origin, OG_IMAGE);
  // Event, artist and venue descriptions all interpolate a name from a ticket feed,
  // and those run to 195 characters. One clamp here covers every template rather
  // than each one having to remember the budget.
  const description = clampDesc(seo.description);

  // Some of these are written by the client (react-helmet, via <PageMeta />) and
  // some by src/app/+html.tsx, so rather than assume a tag is in the shell we
  // overwrite the ones we find and append whatever was missing before </head>.
  const tags = [
    { attr: 'name', key: 'robots', content: seo.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large' },
    { attr: 'name', key: 'description', content: description },
    { attr: 'property', key: 'og:title', content: seo.title },
    { attr: 'property', key: 'og:description', content: description },
    { attr: 'property', key: 'og:url', content: canonical },
    { attr: 'property', key: 'og:image', content: image },
    { attr: 'property', key: 'og:image:alt', content: seo.title },
    { attr: 'name', key: 'twitter:title', content: seo.title },
    { attr: 'name', key: 'twitter:description', content: description },
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

  if (seo.body) {
    const body = seo.body;
    /** One module script's text, reassembled across however many chunks it arrives in. */
    let module = '';
    rewriter
      // The export prerendered a loading spinner into #root and set the hydrate flag
      // so React would adopt it. Replacing those children *and* hydrating is a
      // mismatch, and React resolves a mismatch by throwing the whole tree away with
      // a console error. Turning the flag off switches the bundle to
      // `createRoot().render()`, which discards the container's children by design —
      // which is exactly the handover we want, since all it discards is our markup
      // after it has been read. Nothing is lost: the thing being hydrated was a
      // spinner.
      //
      // Buffered rather than tested chunk by chunk: HTMLRewriter splits a text node
      // wherever it likes, and a flag straddling two chunks would be missed — which
      // is the one failure that matters here, since it would leave a hydrating page
      // with markup that doesn't match. Scoped to the module script (the only one
      // the export writes it into) so the JSON-LD next to it is never rebuilt.
      .on('script[type="module"]', {
        element() {
          module = '';
        },
        text(chunk) {
          module += chunk.text;
          if (!chunk.lastInTextNode) {
            chunk.remove();
            return;
          }
          chunk.replace(
            module.replace(/__EXPO_ROUTER_HYDRATE__\s*=\s*true/, '__EXPO_ROUTER_HYDRATE__=false'),
            { html: true },
          );
          module = '';
        },
      })
      .on('#root', {
        element(el) {
          el.setInnerContent(body, { html: true });
        },
      });
  }

  return rewriter.transform(res);
}
