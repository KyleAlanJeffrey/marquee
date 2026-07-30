import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { searchTowns } from './data';
import { getDb } from './db';
import { looksLikeTourName } from './dedupe';
import type { Env } from './env';
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
const DESCRIPTION =
  'Find concerts near you: upcoming shows, tour dates and tickets from Ticketmaster, SeatGeek and Bandsintown, merged into one listing. Follow artists and venues, save shows, no account needed.';
const OG_IMAGE = '/og-image.png';

/** How far ahead the page counts, matching the app's own horizon. */
const HORIZON_DAYS = 365;

// --- data -------------------------------------------------------------------

export type LandingData = {
  totals: { shows: number; venues: number; artists: number; cities: number };
  soon: {
    id: string;
    startsAt: string;
    /** IANA zone of the venue, when we can name one. */
    zone: string | null;
    artistName: string;
    genre: string | null;
    /** Event name, kept for the structured data rather than for display. */
    name: string;
    venueName: string | null;
    place: string;
  }[];
  cities: { label: string; upcoming: number; venues: number; lat: number; lng: number }[];
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
 * The venue name, or nothing if it clearly isn't one.
 *
 * `looksLikeTourName` catches the obvious shapes ("… Tour", "… 2026 Tour"), but
 * not "YE (Kanye West) - LIVE IN SPAIN" or "JASON ISBELL + PATTY GRIFFIN", which
 * arrive in the venue column all the same. A name carrying the performer's own
 * name is a bill, not a room — no venue is named after tonight's act. Display
 * only: the clustering rules in dedupe.ts are deliberately more cautious.
 */
function realVenueName(venueName: string | null, artistName: string): string | null {
  const name = venueName?.trim();
  if (!name || looksLikeTourName(name)) return null;
  const haystack = name.toLowerCase();
  const act = artistName.trim().toLowerCase();
  if (act.length > 2 && haystack.includes(act)) return null;
  return name;
}

const placeOf = (city: string | null, region: string | null) =>
  [city, region].filter((s) => s && s.trim()).join(', ');

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
      zone: zoneFor(r.venueRegion, r.venueCountry),
      artistName: r.artistName,
      genre: firstGenre(r.genres),
      // Some sources file the tour title where the venue goes. It is a real room
      // to them and a lie on a listings page, so it gets dropped rather than
      // printed — the town beside it is still true.
      venueName: realVenueName(r.venueName, r.artistName),
      place: placeOf(r.venueCity, r.venueRegion),
    })),
    cities: cities.map((t) => ({
      label: [t.city, t.region || t.country].filter(Boolean).join(', '),
      upcoming: t.upcoming,
      venues: t.venues,
      lat: t.lat,
      lng: t.lng,
    })),
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

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON-LD goes in raw, so close off the one sequence that could break out. */
const ldJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const num = (n: number) => n.toLocaleString('en-US');

/**
 * The date as the venue's town would say it. A show at 8pm local is stored as
 * 03:00Z the next morning, so formatting in UTC moves it a day — the one mistake
 * a listings page cannot make.
 */
function when(iso: string, zone: string | null): { day: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  const f = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone ?? 'UTC', ...opts }).format(d);
    } catch {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(d);
    }
  };
  return {
    day: f({ weekday: 'short', month: 'short', day: 'numeric' }),
    time: f({ hour: 'numeric', minute: '2-digit' }),
  };
}

/** A town opens the app's own feed, centred on that town. Matches search.tsx. */
const townHref = (c: LandingData['cities'][number]) =>
  `/browse?lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}&radius=50&town=${encodeURIComponent(c.label)}`;

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How does Marquee find concerts near me?',
    a: 'It reads live listings from Ticketmaster, SeatGeek and Bandsintown, then merges them: the same show sold in three places becomes one entry, and a venue that all three name slightly differently becomes one room. You give it a point and a radius, and it answers with what is actually on.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. There is no sign-up and no password. The artists and venues you follow, the shows you save and your search radius are stored on your own device, which is also why nothing you follow is visible to anyone else.',
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

const HOW: { n: string; h: string; p: string }[] = [
  {
    n: '01',
    h: 'Point it at a place',
    p: 'Share your location or search any town. You get every upcoming show inside your radius as a feed, a grid or a map — filterable by genre, soonest first.',
  },
  {
    n: '02',
    h: 'Follow the acts and the rooms',
    p: 'Follow an artist and every date they announce collects in one tab. Follow a venue and its whole calendar does, however many sources filed it.',
  },
  {
    n: '03',
    h: 'Put shows aside',
    p: 'Save anything you are thinking about. Marquee re-checks the saved list against the live listings, so a moved door time or a pulled show tells you rather than surprising you.',
  },
];

function bulbs(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += `<i style="--i:${i}"></i>`;
  return `<div class="bulbs" aria-hidden="true">${out}</div>`;
}

const css = `
:root{
  --bg:#131313; --bg-low:#0e0e0e; --card:#201f1f; --card-high:#2a2a2a;
  --line:rgba(255,255,255,.10); --line-str:rgba(255,255,255,.18);
  --ink:#e5e2e1; --ink-2:#d4c0d7; --ink-3:#9d8ba0;
  --accent:#ecb2ff; --accent-vivid:#bd00ff; --cyan:#00dbe9; --warm:#ffb59a;
  --display:'Sora',Georgia,serif;
  --body:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --label:'Space Grotesk',ui-monospace,monospace;
  --pad:clamp(20px,5vw,44px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
  font-size:17px;line-height:1.65;letter-spacing:-.005em;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;
}
/* Stage haze: two lights, one warm and one cold, thrown at the top of the page. */
body::before{
  content:'';position:absolute;inset:0 0 auto;height:min(900px,90vh);z-index:-2;pointer-events:none;
  background:
    radial-gradient(58% 42% at 18% 0%,rgba(189,0,255,.22),transparent 70%),
    radial-gradient(46% 38% at 88% 6%,rgba(0,219,233,.14),transparent 72%),
    linear-gradient(180deg,var(--bg-low),var(--bg) 70%);
}
/* Grain, so the flat dark reads as paper rather than as a void. */
body::after{
  content:'';position:fixed;inset:0;z-index:9;pointer-events:none;opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
a{color:inherit;text-decoration:none}
h1,h2,h3{font-family:var(--display);font-weight:800;line-height:1.02;letter-spacing:-.035em;margin:0}
p{margin:0}
ol,ul{margin:0;padding:0;list-style:none}
.wrap{width:100%;max-width:1140px;margin-inline:auto;padding-inline:var(--pad)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:var(--pad);top:12px;z-index:20;background:var(--accent);color:#520071;padding:10px 16px;border-radius:99px;font-family:var(--label)}
:focus-visible{outline:2px solid var(--cyan);outline-offset:3px;border-radius:4px}

.eyebrow{font-family:var(--label);font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}

/* --- masthead --- */
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 0 18px}
.brand{display:flex;align-items:center;gap:11px;font-family:var(--display);font-size:23px;letter-spacing:-.04em}
.brand svg{display:block;flex:none}
.top nav{display:flex;gap:6px;font-family:var(--label);font-size:13.5px;letter-spacing:.02em}
.top nav a{padding:9px 13px;border-radius:99px;color:var(--ink-2);transition:background .18s,color .18s}
.top nav a:hover{background:var(--card);color:var(--ink)}
.top nav a.cta{background:var(--accent);color:#520071;font-weight:700}
.top nav a.cta:hover{background:#fff}
@media(max-width:700px){.top nav a.hide-sm{display:none}}

/* --- marquee bulb rail --- */
.bulbs{display:flex;gap:10px;justify-content:space-between;padding:0 2px 30px;overflow:hidden}
.bulbs i{
  width:5px;height:5px;flex:none;border-radius:50%;background:var(--accent);
  box-shadow:0 0 10px 2px rgba(236,178,255,.55);opacity:.85;
  animation:flicker 3.4s calc(var(--i) * -.11s) infinite ease-in-out;
}
@keyframes flicker{0%,100%{opacity:.9;transform:scale(1)}42%{opacity:.22;transform:scale(.82)}}

/* --- hero --- */
.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.85fr);gap:clamp(28px,5vw,64px);align-items:end;padding-bottom:clamp(48px,7vw,84px)}
@media(max-width:940px){.hero{grid-template-columns:1fr;align-items:start}}
h1{font-size:clamp(44px,8.2vw,88px)}
h1 .lit{
  background:linear-gradient(102deg,var(--accent-vivid),var(--accent) 42%,var(--cyan));
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.lede{margin-top:22px;max-width:34ch;font-size:clamp(17px,2.1vw,20px);color:var(--ink-2)}
.buttons{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.btn{
  display:inline-flex;align-items:center;gap:9px;padding:15px 26px;border-radius:99px;
  font-family:var(--label);font-size:15px;font-weight:700;letter-spacing:.01em;
  background:linear-gradient(115deg,var(--accent-vivid),var(--cyan));color:#fff;
  box-shadow:0 12px 34px -14px rgba(189,0,255,.9);transition:transform .18s,box-shadow .18s;
}
.btn:hover{transform:translateY(-2px);box-shadow:0 18px 40px -14px rgba(189,0,255,1)}
.btn.ghost{background:none;border:1px solid var(--line-str);color:var(--ink);box-shadow:none}
.btn.ghost:hover{border-color:var(--accent);color:var(--accent)}

/* The stat panel is a ticket stub: torn left edge, punched holes. */
.stub{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 26px 22px 32px;overflow:hidden}
.stub::before{content:'';position:absolute;left:14px;top:16px;bottom:16px;width:1px;background:repeating-linear-gradient(180deg,var(--line-str) 0 5px,transparent 5px 11px)}
.stub::after{content:'';position:absolute;left:8px;top:-9px;width:14px;height:14px;border-radius:50%;background:var(--bg);box-shadow:0 0 0 1px var(--line)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:20px 18px}
.stat b{display:block;font-family:var(--display);font-size:clamp(26px,3.4vw,34px);letter-spacing:-.04em;line-height:1}
.stat span{display:block;margin-top:5px;font-family:var(--label);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.stub .note{margin-top:22px;padding-top:16px;border-top:1px dashed var(--line-str);font-size:13.5px;color:var(--ink-3)}

/* --- sections --- */
section{padding:clamp(46px,6vw,74px) 0;border-top:1px solid var(--line)}
.head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:30px}
h2{font-size:clamp(27px,3.6vw,38px)}
.head p{max-width:52ch;color:var(--ink-3);font-size:15.5px}
.more{font-family:var(--label);font-size:13.5px;color:var(--accent);border-bottom:1px solid transparent;transition:border-color .18s}
.more:hover{border-color:var(--accent)}

/* Show rows, printed-listings style: date at the left, rule between each. */
.shows li{border-top:1px solid var(--line)}
.shows li:last-child{border-bottom:1px solid var(--line)}
.shows a{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:20px;align-items:center;padding:17px 6px;transition:background .16s,padding-left .16s}
.shows a:hover{background:linear-gradient(90deg,rgba(236,178,255,.07),transparent 70%);padding-left:14px}
.date{font-family:var(--label);font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--warm)}
.date small{display:block;font-size:11px;letter-spacing:.14em;color:var(--ink-3)}
.who{display:block;font-family:var(--display);font-weight:700;font-size:clamp(18px,2.2vw,22px);letter-spacing:-.03em}
.where{display:block;margin-top:3px;font-size:14.5px;color:var(--ink-3)}
.where b{color:var(--ink-2);font-weight:600}
.tag{font-family:var(--label);font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--cyan);white-space:nowrap}
@media(max-width:620px){
  .shows a{grid-template-columns:1fr;gap:6px;padding:15px 4px}
  .shows a:hover{padding-left:8px}
  .tag{display:none}
}

/* City chips */
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chips a{display:inline-flex;align-items:baseline;gap:8px;padding:11px 17px;border:1px solid var(--line);border-radius:99px;background:rgba(32,31,31,.6);font-size:15px;transition:border-color .18s,background .18s,transform .18s}
.chips a:hover{border-color:var(--accent);background:var(--card-high);transform:translateY(-1px)}
.chips em{font-family:var(--label);font-style:normal;font-size:12px;letter-spacing:.08em;color:var(--ink-3)}

/* Two lists side by side */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,4vw,56px)}
@media(max-width:820px){.cols{grid-template-columns:1fr}}
.rank li{border-bottom:1px solid var(--line)}
.rank a{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:13px 4px;transition:padding-left .16s,color .16s}
.rank a:hover{padding-left:10px;color:var(--accent)}
.rank .nm{font-weight:600}
.rank .sub{display:block;font-size:13.5px;color:var(--ink-3);font-weight:400}
.rank .ct{font-family:var(--label);font-size:12.5px;letter-spacing:.06em;color:var(--ink-3);white-space:nowrap}

/* How it works */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(18px,2.4vw,26px)}
@media(max-width:860px){.steps{grid-template-columns:1fr}}
.step{position:relative;padding:28px 24px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(42,42,42,.5),rgba(32,31,31,.25));overflow:hidden}
.step .n{position:absolute;top:-14px;right:8px;font-family:var(--display);font-size:86px;color:rgba(255,255,255,.045);letter-spacing:-.06em}
.step h3{font-size:20px;margin-bottom:10px}
.step p{font-size:15.5px;color:var(--ink-2)}

/* FAQ */
.faq{border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 4px;cursor:pointer;font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:-.02em;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-family:var(--label);font-size:22px;color:var(--accent);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq p{padding:0 4px 22px;max-width:72ch;color:var(--ink-2);font-size:16px}

footer{border-top:1px solid var(--line);padding:40px 0 56px;color:var(--ink-3);font-size:14.5px}
footer nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:18px;font-family:var(--label);font-size:13.5px}
footer nav a:hover{color:var(--accent)}
footer p{max-width:76ch}

/* One orchestrated entrance, then nothing moves again. */
.rise{animation:rise .75s both cubic-bezier(.16,.84,.34,1)}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
`;

export function landingHtml(origin: string, d: LandingData): string {
  const canonical = `${origin}/concerts`;
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
          { '@type': 'ListItem', position: 1, name: NAME, item: origin },
          { '@type': 'ListItem', position: 2, name: 'Concerts near you', item: canonical },
        ],
      },
    },
    {
      '@type': 'WebApplication',
      name: NAME,
      url: origin,
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
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
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
          startDate: s.startsAt,
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
      const w = when(s.startsAt, s.zone);
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
    .map(
      (c) =>
        `<a href="${esc(townHref(c))}">${esc(c.label)} <em>${num(c.upcoming)}</em></a>`,
    )
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="author" content="Kyle Jeffrey">
<meta name="theme-color" content="#0e0e0e">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(origin + OG_IMAGE)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Marquee — find concerts near you">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<meta name="twitter:image" content="${esc(origin + OG_IMAGE)}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=Plus+Jakarta+Sans:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap">
<style>${css}</style>
<script type="application/ld+json">${ldJson({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="wrap">
  <div class="top">
    <a class="brand" href="/" aria-label="Marquee home">
      <svg width="26" height="26" viewBox="0 0 26 26" role="img" aria-hidden="true">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#bd00ff"/><stop offset="1" stop-color="#00dbe9"/>
        </linearGradient></defs>
        <rect x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="url(#g)" stroke-width="2"/>
        <g fill="url(#g)"><rect x="7" y="10" width="2.6" height="6" rx="1.3"/><rect x="11.7" y="6.5" width="2.6" height="13" rx="1.3"/><rect x="16.4" y="9" width="2.6" height="8" rx="1.3"/></g>
      </svg>
      Marquee
    </a>
    <nav aria-label="Marquee">
      <a class="hide-sm" href="/browse">Browse</a>
      <a class="hide-sm" href="/map">Map</a>
      <a class="hide-sm" href="/search">Artists</a>
      <a class="cta" href="/">Open the app</a>
    </nav>
  </div>
  ${bulbs(48)}
  <div class="hero">
    <div class="rise">
      <p class="eyebrow">Live music radar</p>
      <h1>Every concert<br>near you, <span class="lit">in one place.</span></h1>
      <p class="lede">Marquee pulls the listings from Ticketmaster, SeatGeek and Bandsintown, throws away the duplicates, and shows you what is actually on — tonight, this weekend, or any time in the next year.</p>
      <div class="buttons">
        <a class="btn" href="/">Open the app</a>
        <a class="btn ghost" href="/map">See the map</a>
      </div>
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
    <p>Busiest first, counted live. Each one opens the full feed for that town inside a 50-mile radius.</p>
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

<section class="wrap">
  <div class="head">
    <div><p class="eyebrow">How it works</p><h2>Three things, done properly</h2></div>
    <p>No account, no feed algorithm, no email. Your follows live on your device.</p>
  </div>
  <div class="steps">
    ${HOW.map(
      (s) =>
        `<div class="step"><span class="n" aria-hidden="true">${s.n}</span><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></div>`,
    ).join('')}
  </div>
</section>

<section class="wrap">
  <div class="head"><div><p class="eyebrow">Questions</p><h2>Frequently asked</h2></div></div>
  <div class="faq">
    ${FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
  </div>
</section>
</main>

<footer class="wrap">
  <nav aria-label="Marquee pages">
    <a href="/">Concerts near you</a>
    <a href="/browse">Browse every show</a>
    <a href="/map">Concert map</a>
    <a href="/search">Find an artist</a>
    <a href="/following">Artists you follow</a>
    <a href="/saved">Saved shows</a>
    <a href="/sitemap.xml">Sitemap</a>
  </nav>
  <p>Marquee is a free live-music radar built by Kyle Jeffrey. Listings come from Ticketmaster, SeatGeek and Bandsintown; artist detail from Spotify, Deezer and Wikipedia. Tickets are sold by those sites, not by us.</p>
</footer>
</body>
</html>
`;
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
