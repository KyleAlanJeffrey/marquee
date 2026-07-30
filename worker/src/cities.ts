import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import type { DB } from './db';
import { getDb } from './db';
import { looksLikeTourName } from './dedupe';
import type { Env } from './env';
import {
  bulbs,
  esc,
  faqJsonLd,
  faqSection,
  howSection,
  masthead,
  num,
  plural,
  realVenueName,
  shell,
  type Faq,
  when,
} from './page';
import { artists, events, venues } from './schema';
import { zoneFor } from './timezone';

/**
 * A page per town: `/concerts/austin-tx`.
 *
 * "concerts in austin" is the query people actually type, and until this the site
 * had nothing that answered it. The app can show you Austin — but only via
 * `/browse?lat=…&lng=…`, which is a query string, needs JavaScript, and is not a
 * URL anybody links to or a crawler indexes.
 *
 * So each town with upcoming shows gets a real document, generated the same way
 * as the landing page: complete HTML from D1, no client JavaScript. It lists the
 * shows by date rather than summarising them, because the thing that ranks for
 * "concerts in austin" is a page that visibly *is* the concerts in Austin.
 *
 * Town identity here matches the app's own (`searchTowns`): a town is a
 * (city, region) pair on the venue rows, so Portland OR and Portland ME are two
 * towns rather than one confused one.
 */

const NAME = 'Marquee';
const HORIZON_DAYS = 365;

/** Rows printed on a hub page. Past this the page is long and the tail is thin. */
const SHOW_LIMIT = 120;
/** Towns read for slug resolution and the nearby list. Well past what we have. */
const TOWN_LIMIT = 4000;

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isoInDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19) + 'Z';

// --- slugs ------------------------------------------------------------------

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    // Strip accents so München and Munchen are the same URL.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The URL for a town: city, then whatever qualifies it — `austin-tx`, `london-gb`.
 *
 * The qualifier is not decoration. "Portland" alone is two different towns, and a
 * slug that can mean either is a slug that cannot be resolved.
 */
export function citySlug(city: string, region: string | null, country: string | null): string {
  const base = slugify(city);
  const qualifier = slugify(region || country || '');
  return qualifier ? `${base}-${qualifier}` : base;
}

export type Town = {
  city: string;
  region: string | null;
  country: string | null;
  slug: string;
  label: string;
  lat: number;
  lng: number;
  upcoming: number;
  venues: number;
};

const blank = (s: string | null) => (s && s.trim() ? s : null);

/**
 * Every town with an upcoming show, busiest first.
 *
 * Deliberately the same grouping as `searchTowns` — one row per (city, region) —
 * so the hub pages, the app's town search and the sitemap all agree on what a
 * town is. Busiest-first also settles slug collisions: two spellings that slugify
 * the same ("St. Louis", "St Louis") resolve to whichever has more shows, which
 * is stable as long as the data is.
 */
export async function allTowns(db: DB, limit = TOWN_LIMIT, cityPrefix?: string): Promise<Town[]> {
  const rows = await db
    .select({
      city: venues.city,
      region: venues.region,
      country: venues.country,
      lat: sql<number>`avg(${venues.lat})`,
      lng: sql<number>`avg(${venues.lng})`,
      upcoming: sql<number>`count(distinct ${events.id})`,
      venues: sql<number>`count(distinct coalesce(${venues.canonicalVenueId}, ${venues.id}))`,
    })
    .from(venues)
    .innerJoin(events, eq(events.venueId, venues.id))
    .where(
      and(
        gte(events.startsAt, nowIso()),
        lte(events.startsAt, isoInDays(HORIZON_DAYS)),
        sql`${venues.city} is not null and trim(${venues.city}) <> ''`,
        sql`${venues.lat} is not null and ${venues.lng} is not null`,
        cityPrefix ? sql`lower(${venues.city}) like ${`${cityPrefix}%`}` : undefined,
      ),
    )
    .groupBy(sql`lower(${venues.city})`, sql`lower(coalesce(${venues.region}, ''))`)
    .orderBy(desc(sql`count(distinct ${events.id})`), venues.city)
    .limit(limit);

  if (rows.length === limit) {
    // The silent truncation this codebase already paid for once, in the sitemap.
    console.warn(`cities: town list hit its ${limit}-row limit; some towns have no hub page`);
  }

  return rows
    .map((r) => {
      const city = r.city as string;
      const region = blank(r.region);
      const country = blank(r.country);
      return {
        city,
        region,
        country,
        slug: citySlug(city, region, country),
        label: [city, region || country].filter(Boolean).join(', '),
        lat: r.lat,
        lng: r.lng,
        upcoming: r.upcoming,
        venues: r.venues,
      };
    })
    // A name written in a script with no Latin characters slugifies to nothing, and
    // an empty slug is `/concerts/` — a URL that is every such town at once. They
    // are reachable in the app by search; they just can't have a hub page.
    .filter((t) => t.slug !== '');
}

/**
 * The town a slug names, or null.
 *
 * Resolved by generating slugs rather than parsing them: a slug can't be split
 * back into city and region reliably ("san-francisco-ca" has two hyphens and one
 * of them isn't a separator), and slugifying is lossy about punctuation, so
 * "st-louis-mo" would never match "St. Louis" through a LIKE. The leading token
 * narrows the scan to a handful of rows first, with a full pass behind it for the
 * names whose slug doesn't start where the name does.
 */
export async function townBySlug(db: DB, slug: string): Promise<Town | null> {
  const wanted = slugify(slug);
  if (!wanted) return null;
  const prefix = wanted.split('-')[0];
  const narrow = await allTowns(db, 200, prefix);
  return narrow.find((t) => t.slug === wanted) ?? findInAll();

  async function findInAll(): Promise<Town | null> {
    const all = await allTowns(db);
    return all.find((t) => t.slug === wanted) ?? null;
  }
}

// --- data -------------------------------------------------------------------

export type CityData = {
  town: Town;
  shows: {
    id: string;
    name: string;
    startsAt: string;
    zone: string | null;
    artistName: string;
    genre: string | null;
    venueName: string | null;
  }[];
  /** True when the town has more shows than the page prints. */
  truncated: boolean;
  venues: { id: string; name: string; upcoming: number }[];
  artists: { id: string; name: string; genre: string | null; upcoming: number }[];
  nearby: Town[];
};

const firstGenre = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
  } catch {
    return null;
  }
};

const MILES_PER_DEG = 69;

/** Rough great-circle miles. Good enough to order a list of nearby towns. */
function milesBetween(a: Town, b: Town): number {
  const dLat = (a.lat - b.lat) * MILES_PER_DEG;
  const dLng = (a.lng - b.lng) * MILES_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export async function cityData(env: Env, town: Town): Promise<CityData> {
  const db = getDb(env.DB);
  const canon = alias(venues, 'canon');
  const window = and(gte(events.startsAt, nowIso()), lte(events.startsAt, isoInDays(HORIZON_DAYS)));
  // The town is identified on the venue the event points at, matching allTowns.
  const inTown = and(
    sql`lower(${venues.city}) = ${town.city.toLowerCase()}`,
    sql`lower(coalesce(${venues.region}, '')) = ${(town.region ?? '').toLowerCase()}`,
  );
  const scope = and(window, inTown);

  const [shows, rooms, acts, towns] = await Promise.all([
    db
      .select({
        id: events.id,
        name: events.name,
        startsAt: events.startsAt,
        artistName: artists.name,
        genres: artists.genres,
        venueName: canon.name,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .innerJoin(venues, eq(venues.id, events.venueId))
      .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(scope)
      .orderBy(events.startsAt)
      // One over the limit, purely to know whether there are more.
      .limit(SHOW_LIMIT + 1),
    db
      .select({
        id: canon.id,
        name: canon.name,
        upcoming: sql<number>`count(distinct ${events.id})`,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(and(scope, sql`${canon.name} is not null and trim(${canon.name}) <> ''`))
      .groupBy(canon.id)
      .orderBy(desc(sql`count(distinct ${events.id})`), canon.id)
      .limit(14),
    db
      .select({
        id: artists.id,
        name: artists.name,
        genres: artists.genres,
        upcoming: sql<number>`count(distinct ${events.id})`,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(scope)
      .groupBy(artists.id)
      .orderBy(desc(sql`count(distinct ${events.id})`), artists.id)
      .limit(14),
    allTowns(db),
  ]);

  const nearby = towns
    .filter((t) => t.slug !== town.slug)
    .map((t) => ({ t, d: milesBetween(town, t) }))
    // Inside a day trip, and busiest-of-those first — a list of the nearest
    // villages is worse than a list of the nearest places with shows on.
    .filter((x) => x.d < 180)
    .sort((a, b) => b.t.upcoming - a.t.upcoming)
    .slice(0, 14)
    .map((x) => x.t);

  return {
    town,
    shows: shows.slice(0, SHOW_LIMIT).map((s) => ({
      id: s.id,
      name: s.name,
      startsAt: s.startsAt,
      zone: zoneFor(town.region, town.country),
      artistName: s.artistName,
      genre: firstGenre(s.genres),
      venueName: realVenueName(s.venueName, s.artistName, looksLikeTourName),
    })),
    truncated: shows.length > SHOW_LIMIT,
    venues: rooms.map((v) => ({ id: v.id, name: v.name ?? '', upcoming: v.upcoming })),
    artists: acts.map((a) => ({
      id: a.id,
      name: a.name,
      genre: firstGenre(a.genres),
      upcoming: a.upcoming,
    })),
    nearby,
  };
}

// --- rendering --------------------------------------------------------------

/** Month heading for the date rules down the show list. */
const monthOf = (iso: string, zone: string | null) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: zone ?? 'UTC',
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
};

function cityFaq(d: CityData): Faq[] {
  const where = d.town.label;
  const rooms = d.venues
    .slice(0, 3)
    .map((v) => v.name)
    .filter(Boolean);
  return [
    {
      q: `How many concerts are coming up in ${where}?`,
      a:
        `${num(d.town.upcoming)} upcoming ${plural(d.town.upcoming, 'show', 'shows')} across ` +
        `${num(d.town.venues)} ${plural(d.town.venues, 'venue', 'venues')} in the next 12 months, ` +
        'counted from live listings at the moment you loaded this page. It changes as shows are announced and as they pass.',
    },
    {
      q: `Which venues in ${where} have the most shows?`,
      a: rooms.length
        ? `${rooms.join(', ')} are the busiest right now. Every room in town is listed above with its own page and full calendar.`
        : `The venue list above is generated from what is on sale in ${where} right now.`,
    },
    {
      q: `Where do these ${where} listings come from?`,
      a: 'Ticketmaster, SeatGeek and Bandsintown, read live and merged: the same show sold in three places becomes one entry, and a room all three name slightly differently becomes one venue. Tickets are bought from whoever is selling them — Marquee links straight out and takes nothing in between.',
    },
    {
      q: `Can I get told when an artist announces a ${where} date?`,
      a: `Yes. Open the app, set your radius around ${d.town.city} and follow the acts you care about. Marquee re-checks your follows against the listings and collects every date they announce inside that radius for the next year. No account, and your follows stay on your device.`,
    },
  ];
}

export function cityHtml(origin: string, d: CityData): string {
  const { town } = d;
  const canonical = `${origin}/concerts/${town.slug}`;
  const shows = num(town.upcoming);
  const title = `Concerts in ${town.label} — ${shows} Upcoming ${plural(town.upcoming, 'Show', 'Shows')} & Tour Dates · ${NAME}`;
  const description =
    `Every upcoming concert in ${town.label}: ${shows} ${plural(town.upcoming, 'show', 'shows')} at ` +
    `${num(town.venues)} ${plural(town.venues, 'venue', 'venues')}, with dates, door times and tickets. ` +
    'Merged from Ticketmaster, SeatGeek and Bandsintown — no account needed.';
  const faq = cityFaq(d);

  // Date rules down the list, so a long calendar can be scanned by month.
  let month = '';
  const showRows = d.shows
    .map((s) => {
      const w = when(s.startsAt, s.zone);
      const m = monthOf(s.startsAt, s.zone);
      const rule = m && m !== month ? `<li class="month">${esc(m)}</li>` : '';
      month = m || month;
      return `${rule}<li><a href="/event/${esc(s.id)}">
        <span class="date">${esc(w.day)}<small>${esc(w.time)}</small></span>
        <span><span class="who">${esc(s.artistName)}</span>
        <span class="where">${s.venueName ? `<b>${esc(s.venueName)}</b>` : 'Venue to be announced'}</span></span>
        ${s.genre ? `<span class="tag">${esc(s.genre)}</span>` : '<span></span>'}
      </a></li>`;
    })
    .join('');

  const venueRows = d.venues
    .map(
      (v) =>
        `<li><a href="/venue/${esc(v.id)}"><span class="nm">${esc(v.name)}</span><span class="ct">${num(v.upcoming)} ${plural(v.upcoming, 'show', 'shows')}</span></a></li>`,
    )
    .join('');

  const artistRows = d.artists
    .map(
      (a) =>
        `<li><a href="/artist/${esc(a.id)}"><span class="nm">${esc(a.name)}${a.genre ? `<span class="sub">${esc(a.genre)}</span>` : ''}</span><span class="ct">${num(a.upcoming)} ${plural(a.upcoming, 'date', 'dates')}</span></a></li>`,
    )
    .join('');

  const nearbyChips = d.nearby
    .map(
      (t) =>
        `<a href="/concerts/${esc(t.slug)}">${esc(t.label)} <em>${num(t.upcoming)}</em></a>`,
    )
    .join('');

  const graph: unknown[] = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: NAME, url: origin },
      about: {
        '@type': 'City',
        name: town.city,
        ...(town.region || town.country
          ? {
              address: {
                '@type': 'PostalAddress',
                addressRegion: town.region ?? undefined,
                addressCountry: town.country ?? undefined,
              },
            }
          : null),
        geo: { '@type': 'GeoCoordinates', latitude: town.lat, longitude: town.lng },
      },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: NAME, item: origin },
          { '@type': 'ListItem', position: 2, name: 'Concerts', item: `${origin}/concerts` },
          { '@type': 'ListItem', position: 3, name: `Concerts in ${town.label}`, item: canonical },
        ],
      },
    },
    faqJsonLd(faq),
  ];

  if (d.shows.length) {
    graph.push({
      '@type': 'ItemList',
      name: `Upcoming concerts in ${town.label}`,
      numberOfItems: d.shows.length,
      itemListElement: d.shows.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'MusicEvent',
          name: s.name,
          url: `${origin}/event/${s.id}`,
          startDate: s.startsAt,
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          performer: { '@type': 'MusicGroup', name: s.artistName },
          location: {
            '@type': 'MusicVenue',
            name: s.venueName ?? town.label,
            address: {
              '@type': 'PostalAddress',
              addressLocality: town.city,
              addressRegion: town.region ?? undefined,
              addressCountry: town.country ?? undefined,
            },
          },
        },
      })),
    });
  }

  const feedHref = `/browse?lat=${town.lat.toFixed(4)}&lng=${town.lng.toFixed(4)}&radius=50&town=${encodeURIComponent(town.label)}`;
  const first = d.shows[0];
  const nextUp = first ? when(first.startsAt, first.zone).day : '';

  const body = `<header class="wrap">
  ${masthead}
  ${bulbs(48)}
  <div class="hero tight">
    <div class="rise">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/concerts">Concerts</a><span aria-hidden="true">/</span>${esc(town.label)}
      </nav>
      <h1>Concerts in <span class="lit">${esc(town.label)}</span></h1>
      <p class="lede">Every upcoming show in ${esc(town.label)}, by date — ${shows} of them across ${num(town.venues)} ${plural(town.venues, 'venue', 'venues')}, pulled from Ticketmaster, SeatGeek and Bandsintown and merged so a show sold in three places is listed once.</p>
      <div class="buttons">
        <a class="btn" href="${esc(feedHref)}">Open ${esc(town.city)} in the app</a>
        <a class="btn ghost" href="/map">See the map</a>
      </div>
    </div>
    <div class="stub rise" style="animation-delay:.12s">
      <p class="eyebrow" style="color:var(--cyan)">On sale in ${esc(town.city)}</p>
      <div class="stats" style="margin-top:18px">
        <div class="stat"><b>${shows}</b><span>upcoming shows</span></div>
        <div class="stat"><b>${num(town.venues)}</b><span>venues</span></div>
        <div class="stat txt"><b>${esc(nextUp || '—')}</b><span>next show</span></div>
        <div class="stat"><b>${num(d.nearby.length)}</b><span>towns nearby</span></div>
      </div>
      <p class="note">Counted live for the next 12 months, re-checked every hour by a scheduled crawl.</p>
    </div>
  </div>
</header>

<main id="main">
${
  d.shows.length
    ? `<section class="wrap">
  <div class="head">
    <div>
      <p class="eyebrow">By date</p>
      <h2>What's on in ${esc(town.city)}</h2>
    </div>
    <p>${d.truncated ? `The next ${num(d.shows.length)} shows, soonest first. Open the app for the rest of the year.` : 'Soonest first. Open one for the lineup, the door time, the price and a way in.'}</p>
  </div>
  <ol class="shows">${showRows}</ol>
  ${d.truncated ? `<p class="prose" style="margin-top:26px"><a class="more" href="${esc(feedHref)}">See all ${shows} shows in ${esc(town.label)} →</a></p>` : ''}
</section>

<section class="wrap">
  <div class="cols">
    <div>
      <div class="head"><div><p class="eyebrow">Rooms</p><h2>Venues in ${esc(town.city)}</h2></div></div>
      <ul class="rank">${venueRows}</ul>
    </div>
    <div>
      <div class="head"><div><p class="eyebrow">Acts</p><h2>Playing ${esc(town.city)}</h2></div></div>
      <ul class="rank">${artistRows}</ul>
    </div>
  </div>
</section>`
    : `<section class="wrap">
  <div class="head"><div><h2>No shows listed in ${esc(town.city)} right now</h2></div></div>
  <p class="prose">Nothing is on sale here at the moment. The nearby towns below have listings, and the app will tell you when ${esc(town.city)} does.</p>
</section>`
}

${
  d.nearby.length
    ? `<section class="wrap">
  <div class="head">
    <div><p class="eyebrow">Nearby</p><h2>Other towns within reach</h2></div>
    <p>Within about 180 miles of ${esc(town.city)}, busiest first.</p>
  </div>
  <div class="chips">${nearbyChips}</div>
</section>`
    : ''
}

${howSection}

${faqSection(faq, `Concerts in ${town.label}: questions`)}
</main>`;

  return shell({
    origin,
    canonical,
    title,
    description,
    jsonLd: { '@context': 'https://schema.org', '@graph': graph },
    body,
    // A town whose listings have all passed is a thin page; keep it crawlable for
    // the links but out of the index until it has something to say.
    noindex: d.shows.length === 0,
    footerExtra: d.nearby.length
      ? `<p class="near">Concerts nearby: ${d.nearby
          .slice(0, 10)
          .map((t) => `<a href="/concerts/${esc(t.slug)}">${esc(t.label)}</a>`)
          .join(' · ')}</p>`
      : '',
  });
}

/** The page for a slug, or null when no town answers to it (a real 404). */
export async function cityPage(env: Env, origin: string, slug: string): Promise<string | null> {
  const db = getDb(env.DB);
  const town = await townBySlug(db, slug);
  if (!town) return null;
  return cityHtml(origin, await cityData(env, town));
}
