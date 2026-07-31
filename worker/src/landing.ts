import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { searchTowns } from './data';
import { getDb } from './db';
import type { Env } from './env';
import {
  bulbs,
  esc,
  faqJsonLd,
  faqSection,
  howSection,
  masthead,
  num,
  OG_IMAGE,
  placeOf,
  realVenueName,
  shell,
  type Faq,
  when,
} from './page';
import { citySlug } from './cities';
import { artists, events, venues } from './schema';
import { zoneFor } from './timezone';

/**
 * The web landing page, rendered here rather than in the app.
 *
 * Everything else on the site is the Expo SPA: one empty shell whose <head> this
 * Worker rewrites per route (see seo.ts). That works for social cards and for
 * Google, which runs JavaScript — but the *body* only exists after a 2 MB bundle
 * boots, so every other crawler (Bing, GPTBot, ClaudeBot, PerplexityBot, Slack,
 * anything cheap) sees a blank page, and the site's front door has no indexable
 * text at all.
 *
 * This page is the opposite: complete HTML, generated from D1 on the edge, no
 * client JavaScript and no images. It is also the only page on the site that
 * links out to hundreds of event/venue/artist URLs in plain <a> tags, which is
 * how a crawler finds them without parsing a sitemap.
 *
 * It has to earn the ranking, so it isn't a brochure: the counts, the shows, the
 * cities, the venues and the artists are all live reads. A landing page that
 * says "thousands of concerts" ranks like a landing page. One that lists the
 * next twelve, by name, ranks like a listings page.
 */

const NAME = 'Marquee';
const TITLE = 'Concerts Near You — Every Upcoming Show in One Place · Marquee';
// Kept inside DESC_MAX — a snippet that overflows is copy no search result shows.
export const DESCRIPTION =
  'Find concerts near you: upcoming shows, tour dates and tickets from Ticketmaster, SeatGeek and Bandsintown in one listing. No account needed to browse.';

/** How far ahead the page counts, matching the app's own horizon. */
const HORIZON_DAYS = 365;

// --- data -------------------------------------------------------------------

export type LandingData = {
  totals: { shows: number; venues: number; artists: number; cities: number };
  soon: {
    id: string;
    startsAt: string;
    /** Set time not announced — the date is real, the clock is a placeholder. */
    timeUnknown: boolean;
    /** IANA zone of the venue, when we can name one. */
    zone: string | null;
    artistName: string;
    genre: string | null;
    /** Event name, kept for the structured data rather than for display. */
    name: string;
    venueName: string | null;
    place: string;
  }[];
  cities: { label: string; slug: string; upcoming: number }[];
  venues: { id: string; name: string; place: string; upcoming: number }[];
  artists: { id: string; name: string; genre: string | null; upcoming: number }[];
};

const EMPTY: LandingData = {
  totals: { shows: 0, venues: 0, artists: 0, cities: 0 },
  soon: [],
  cities: [],
  venues: [],
  artists: [],
};

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const isoInDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19) + 'Z';

const firstGenre = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
  } catch {
    return null;
  }
};

/** One show per town, in date order, until we have `limit` of them. */
function oncePerCity<T extends { venueCity: string | null }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = (r.venueCity ?? '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(r);
    if (out.length === limit) break;
  }
  // Fewer towns than slots (a small catalogue, or early in the horizon): fall
  // back to filling the list rather than showing three rows.
  if (out.length < limit) {
    for (const r of rows) {
      if (out.includes(r)) continue;
      out.push(r);
      if (out.length === limit) break;
    }
  }
  return out;
}


/**
 * Five reads, all bounded, all on the upcoming window. Cheap enough to serve on
 * a cache miss and cached at the edge for the rest of the half hour.
 */
export async function landingData(env: Env): Promise<LandingData> {
  const db = getDb(env.DB);
  const canon = alias(venues, 'canon');
  const window = and(gte(events.startsAt, nowIso()), lte(events.startsAt, isoInDays(HORIZON_DAYS)));

  const [totals, soon, cities, rooms, acts] = await Promise.all([
    db
      .select({
        shows: sql<number>`count(distinct ${events.id})`,
        // Counted as clusters, not rows: the same room filed by three sources is
        // one venue everywhere else in the app, so it is one here too.
        venues: sql<number>`count(distinct coalesce(${venues.canonicalVenueId}, ${venues.id}))`,
        artists: sql<number>`count(distinct ${events.artistId})`,
        cities: sql<number>`count(distinct lower(${venues.city}))`,
      })
      .from(events)
      .leftJoin(venues, eq(venues.id, events.venueId))
      .where(window)
      .get(),
    db
      .select({
        id: events.id,
        name: events.name,
        startsAt: events.startsAt,
        timeUnknown: events.timeUnknown,
        artistName: artists.name,
        genres: artists.genres,
        venueName: canon.name,
        venueCity: canon.city,
        venueRegion: canon.region,
        venueCountry: canon.country,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .leftJoin(venues, eq(venues.id, events.venueId))
      .leftJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(window)
      .orderBy(events.startsAt)
      // Read wider than we show: the soonest dozen rows are often one festival
      // weekend in one town, and a listings page wants a spread of places.
      .limit(120),
    searchTowns(db, '', 30),
    db
      .select({
        id: canon.id,
        name: canon.name,
        city: canon.city,
        region: canon.region,
        upcoming: sql<number>`count(distinct ${events.id})`,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .innerJoin(canon, eq(canon.id, sql`coalesce(${venues.canonicalVenueId}, ${venues.id})`))
      .where(and(window, sql`${canon.name} is not null and trim(${canon.name}) <> ''`))
      .groupBy(canon.id)
      .orderBy(desc(sql`count(distinct ${events.id})`), canon.id)
      .limit(12),
    db
      .select({
        id: artists.id,
        name: artists.name,
        genres: artists.genres,
        upcoming: sql<number>`count(distinct ${events.id})`,
      })
      .from(events)
      .innerJoin(artists, eq(artists.id, events.artistId))
      .where(window)
      .groupBy(artists.id)
      .orderBy(desc(sql`count(distinct ${events.id})`), artists.id)
      .limit(16),
  ]);

  return {
    totals: {
      shows: totals?.shows ?? 0,
      venues: totals?.venues ?? 0,
      artists: totals?.artists ?? 0,
      cities: totals?.cities ?? 0,
    },
    soon: oncePerCity(soon, 12).map((r) => ({
      id: r.id,
      name: r.name,
      startsAt: r.startsAt,
      timeUnknown: r.timeUnknown,
      zone: zoneFor(r.venueRegion, r.venueCountry),
      artistName: r.artistName,
      genre: firstGenre(r.genres),
      // Some sources file the tour title where the venue goes. It is a real room
      // to them and a lie on a listings page, so it gets dropped rather than
      // printed — the town beside it is still true.
      venueName: realVenueName(r.venueName, r.artistName),
      place: placeOf(r.venueCity, r.venueRegion),
    })),
    cities: cities
      .map((t) => ({
        label: [t.city, t.region || t.country].filter(Boolean).join(', '),
        slug: citySlug(t.city, t.region, t.country),
        upcoming: t.upcoming,
      }))
      // No slug, no hub page to link to — see the filter in allTowns.
      .filter((c) => c.slug !== ''),
    venues: rooms.map((v) => ({
      id: v.id,
      name: v.name ?? '',
      place: placeOf(v.city, v.region),
      upcoming: v.upcoming,
    })),
    artists: acts.map((a) => ({
      id: a.id,
      name: a.name,
      genre: firstGenre(a.genres),
      upcoming: a.upcoming,
    })),
  };
}

// --- rendering --------------------------------------------------------------

/** A town chip opens that town's own hub page — a real URL, not a query string. */
const townHref = (c: LandingData['cities'][number]) => `/concerts/${c.slug}`;

const FAQ: Faq[] = [
  {
    q: 'How does Marquee find concerts near me?',
    a: 'It reads live listings from Ticketmaster, SeatGeek and Bandsintown, then merges them: the same show sold in three places becomes one entry, and a venue that all three name slightly differently becomes one room. You give it a point and a radius, and it answers with what is actually on.',
  },
  {
    q: 'Do I need an account?',
    a: 'Not to browse — search, the map and every listing work without one. An account is for keeping things: the artists and venues you follow, the shows you save and the concerts you log live on it, private to you, so they survive a lost phone and follow you between devices.',
  },
  {
    q: 'Is it free?',
    a: 'Yes, all of it. Tickets are bought from whoever is selling them — Marquee links straight out to the listing and takes nothing in between.',
  },
  {
    q: 'Which cities does it cover?',
    a: 'Anywhere the sources list shows, which in practice means most of the US and a good deal of Europe. The city list on this page is generated from what is on sale right now, so it is the honest answer at any given moment.',
  },
  {
    q: 'What does following an artist actually do?',
    a: 'It turns them into a standing question. Marquee re-checks your follows against the listings and collects every date they announce inside your radius for the next year — not just the next few weeks.',
  },
  {
    q: 'Is there an iPhone or Android app?',
    a: 'This is the web version, and it installs: open it on a phone and add it to your home screen for a full-screen app with its own icon. Native builds are on the way.',
  },
];
export function landingHtml(origin: string, d: LandingData): string {
  // The landing page is `/` now, so its own address is the site root.
  const canonical = origin + '/';
  const hasData = d.totals.shows > 0;

  const graph: unknown[] = [
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: TITLE,
      description: DESCRIPTION,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: NAME, url: origin },
      primaryImageOfPage: { '@type': 'ImageObject', url: origin + OG_IMAGE },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: NAME, item: canonical },
        ],
      },
    },
    {
      '@type': 'WebApplication',
      name: NAME,
      url: origin + '/explore',
      applicationCategory: 'EntertainmentApplication',
      operatingSystem: 'Web, iOS, Android',
      description: DESCRIPTION,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
      featureList: [
        'Upcoming concerts near you by radius',
        'Follow artists and venues',
        'Save shows for later',
        'Map of nearby shows',
        'Listings merged from Ticketmaster, SeatGeek and Bandsintown',
      ],
    },
    faqJsonLd(FAQ),
  ];

  if (d.soon.length) {
    graph.push({
      '@type': 'ItemList',
      name: 'Concerts happening soon',
      itemListElement: d.soon.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'MusicEvent',
          name: s.name,
          url: `${origin}/event/${s.id}`,
          startDate: s.timeUnknown ? s.startsAt.slice(0, 10) : s.startsAt,
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          performer: { '@type': 'MusicGroup', name: s.artistName },
          ...(s.venueName
            ? {
                location: {
                  '@type': 'MusicVenue',
                  name: s.venueName,
                  ...(s.place ? { address: s.place } : null),
                },
              }
            : null),
        },
      })),
    });
  }

  const showRows = d.soon
    .map((s) => {
      const w = when(s.startsAt, s.zone, s.timeUnknown);
      const room = [s.venueName, s.place].filter(Boolean);
      return `<li><a href="/event/${esc(s.id)}">
        <span class="date">${esc(w.day)}<small>${esc(w.time)}</small></span>
        <span><span class="who">${esc(s.artistName)}</span>
        <span class="where">${room.length ? `<b>${esc(room[0]!)}</b>${room[1] ? ` · ${esc(room[1])}` : ''}` : 'Venue to be announced'}</span></span>
        ${s.genre ? `<span class="tag">${esc(s.genre)}</span>` : '<span></span>'}
      </a></li>`;
    })
    .join('');

  const cityChips = d.cities
    .map((c) => `<a href="${esc(townHref(c))}">${esc(c.label)} <em>${num(c.upcoming)}</em></a>`)
    .join('');

  const venueRows = d.venues
    .map(
      (v) =>
        `<li><a href="/venue/${esc(v.id)}"><span class="nm">${esc(v.name)}<span class="sub">${esc(v.place || 'Location unknown')}</span></span><span class="ct">${num(v.upcoming)} ${v.upcoming === 1 ? 'show' : 'shows'}</span></a></li>`,
    )
    .join('');

  const artistRows = d.artists
    .map(
      (a) =>
        `<li><a href="/artist/${esc(a.id)}"><span class="nm">${esc(a.name)}${a.genre ? `<span class="sub">${esc(a.genre)}</span>` : ''}</span><span class="ct">${num(a.upcoming)} ${a.upcoming === 1 ? 'date' : 'dates'}</span></a></li>`,
    )
    .join('');

  const body = `<header class="wrap">
  ${masthead}
  ${bulbs(48)}
  <div class="hero">
    <div class="rise">
      <p class="eyebrow">No account needed to browse</p>
      <h1>Every concert<br>near you, <span class="lit">in one place.</span></h1>
      <p class="lede">Marquee pulls the listings from Ticketmaster, SeatGeek and Bandsintown, throws away the duplicates, and shows you what is actually on — tonight, this weekend, or any time in the next year.</p>
      <div class="buttons">
        <a class="btn" href="/explore">Open the app</a>
        <a class="btn ghost" href="/map">See the map</a>
      </div>
      <p class="tagline">Browse everything without signing up. An account keeps what you follow, save and log — private to you, on every device you use.</p>
    </div>
    <div class="stub rise" style="animation-delay:.12s">
      <p class="eyebrow" style="color:var(--cyan)">On sale right now</p>
      <div class="stats" style="margin-top:18px">
        <div class="stat"><b>${num(d.totals.shows)}</b><span>upcoming shows</span></div>
        <div class="stat"><b>${num(d.totals.venues)}</b><span>venues</span></div>
        <div class="stat"><b>${num(d.totals.artists)}</b><span>artists on tour</span></div>
        <div class="stat"><b>${num(d.totals.cities)}</b><span>towns and cities</span></div>
      </div>
      <p class="note">Counted from our own listings for the next 12 months, re-checked every hour by a scheduled crawl.</p>
    </div>
  </div>
</header>

<main id="main">
${
  hasData
    ? `<section class="wrap">
  <div class="head">
    <div>
      <p class="eyebrow">Next up</p>
      <h2>Playing soon</h2>
    </div>
    <p>The twelve soonest shows anywhere we have listings. Open one for the lineup, the door time, the price and a way in.</p>
  </div>
  <ol class="shows">${showRows}</ol>
</section>

<section class="wrap">
  <div class="head">
    <div>
      <p class="eyebrow">By city</p>
      <h2>Concerts in your town</h2>
    </div>
    <p>Busiest first, counted live. Each one opens a full listing for that town — every upcoming show, by date.</p>
  </div>
  <div class="chips">${cityChips}</div>
</section>

<section class="wrap">
  <div class="cols">
    <div>
      <div class="head"><div><p class="eyebrow">Rooms</p><h2>Busiest venues</h2></div></div>
      <ul class="rank">${venueRows}</ul>
    </div>
    <div>
      <div class="head"><div><p class="eyebrow">Acts</p><h2>Most dates booked</h2></div></div>
      <ul class="rank">${artistRows}</ul>
    </div>
  </div>
</section>`
    : ''
}

${howSection}

${faqSection(FAQ)}
</main>`;

  return shell({
    origin,
    canonical,
    title: TITLE,
    description: DESCRIPTION,
    jsonLd: { '@context': 'https://schema.org', '@graph': graph },
    body,
  });
}

/** Full page, or the same page with the live sections dropped if D1 is unhappy. */
export async function landingPage(env: Env, origin: string): Promise<string> {
  try {
    return landingHtml(origin, await landingData(env));
  } catch (err) {
    // A marketing page that 500s is worse than one without its listings.
    console.error('landing data failed:', err);
    return landingHtml(origin, EMPTY);
  }
}
