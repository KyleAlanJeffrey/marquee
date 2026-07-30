# Marquee 🎪

Discover upcoming concerts near you, follow the artists you love, and get an
on-device reminder before their next nearby show.

**Stack:** an Expo (React Native + TypeScript) app talking to a **Cloudflare
Worker** (Hono) backed by **Cloudflare D1** (SQLite). Concert data is pulled on
demand from the Ticketmaster Discovery API; artist search uses Spotify. Follows
and preferences live **on-device** (no account). The web build deploys to
**Cloudflare Pages**; native builds ship via EAS.

Because D1 is SQLite (no PostGIS), the "near me" radius search is a lat/lng
bounding-box prefilter (indexed) plus a haversine distance computed in the
Worker.

## Project layout

```
src/
  app/            expo-router screens (Near Me tab, Profile tab, search modal, artist + event detail)
  components/     UI building blocks (design system, cards, map, etc.)
  lib/            api client (Worker), TanStack Query hooks, local follows/prefs stores, reminders
worker/
  src/index.ts    thin entry: mounts the API routers, robots/sitemap, asset SEO
  src/routes/     per-resource Hono routers (artists, venues, events, feed, search, admin)
  src/data.ts     D1 repository (reads/writes) via Drizzle
  src/sources.ts  external APIs (Ticketmaster, Bandsintown, SeatGeek, Spotify, Bluesky)
  src/dedupe.ts   cross-source venue/show identity · src/crawl.ts crawl scheduling
  src/timezone.ts venue-local → UTC (state/province zone + Intl, longitude fallback)
  src/seo.ts      robots.txt, sitemap.xml, per-page <head> + JSON-LD injection
  src/landing.ts  /concerts — the one server-rendered page, for crawlers with no JS
  schema.sql      D1 baseline schema (DDL only — this is what production gets)
  migrations/     numbered D1 migrations applied after the baseline
  seed.sql        local-only dev seed (fictional shows) · unseed.sql removes it
  test/           vitest specs (pure mapping/parsing — `npm test`)
public/           copied to the web export root (og-image, icons, manifest.json)
scripts/dev.sh    one-command local dev (Worker + local D1 + Expo)
```

## Getting started

Prereqs: Node 20+, and (for the backend) Wrangler — installed automatically as a
`worker/` dev dependency.

```sh
npm install
npm run dev            # installs worker deps, loads the D1 schema locally,
                       # starts the Worker on :8787, writes .env, launches Expo
```

`npm run dev` ([scripts/dev.sh](scripts/dev.sh)) runs the whole stack locally
against a local SQLite D1 database seeded with fictional artists at real venues
(mostly SF, the simulator's default location). Press `w` / `i` / `a` in Expo.
`npm run dev -- --no-app` runs just the Worker.

### Real concert data (optional)

Set a **Ticketmaster Discovery** key (and optionally Spotify for search) in
`.dev.vars` in the repo root (gitignored — `wrangler dev` loads it automatically):

```
TICKETMASTER_API_KEY=your-key
SPOTIFY_CLIENT_ID=…
SPOTIFY_CLIENT_SECRET=…
BANDSINTOWN_APP_ID=…      # widens coverage a lot; see "API keys" below
SEATGEEK_CLIENT_ID=…      # the club tier Ticketmaster doesn't list
ADMIN_TOKEN=…             # enables /api/admin/* (backfill); unset = off
```

`GET /api/admin/health` reports which of these are actually configured, how many
events each source has produced, and how deep the crawl queue is — a source with
a missing key no-ops silently, so check there first when a source looks dead.

### The artist crawl

Bandsintown's open API is keyed by artist and has no geographic search, so
coverage is a function of how many artists we ask about and how often. A Cron
Trigger (every 15 minutes, `wrangler.jsonc` → `triggers.crons`) drains the
`artist_sources` queue: artists a client looked at recently are re-checked every
6 hours, ones with an upcoming show daily, cold ones weekly, and support acts
found in a `lineup[]` become artists in their own right at the lowest priority —
which is how the roster grows itself. `POST /api/admin/crawl` runs one pass of
exactly the same code path when you don't want to wait for the schedule.

Then on a device with real location, open **Near Me** and pull to refresh — the
app calls the Worker's `/discover-events`, which pulls nearby shows from
Ticketmaster into D1. Without a key the app runs on seed data and the ingestion
endpoints no-op gracefully.

## API (Cloudflare Worker)

One Worker serves the web build (static assets) and the API under `/api/*`.

| Route | Purpose |
|---|---|
| `GET /api/nearby?lat&lng&radius` | upcoming shows near a point (bbox + haversine) |
| `GET /api/artists/:id` · `GET /api/artists/:id/events` | artist + their upcoming shows |
| `GET /api/events/:id` | event detail |
| `POST /api/following` | upcoming shows for the on-device follow lists — a year ahead, no radius, one row per show (POST so the follow list stays out of request logs) |
| `POST /api/events/by-ids` | the saved list, revalidated — upcoming shows only, soonest first (POST so a saved list stays out of request logs) |
| `GET /api/venues/nearby?lat&lng&radius&limit` | venues with upcoming shows near a point, busiest first, one row per canonical venue |
| `GET /api/venues/:id` · `GET /api/venues/:id/events` | venue + its upcoming shows; any member id of a cluster resolves to the canonical venue |
| `POST /api/search-artists` | Spotify artist search |
| `POST /api/discover-events` | pull nearby shows from Ticketmaster + SeatGeek (throttled per area) |
| `POST /api/refresh-artist-events` | pull shows for the on-device follow list (Ticketmaster + Bandsintown) |
| `GET /api/towns?q=` | towns with upcoming shows (busiest first when `q` is empty) |
| `GET /api/admin/health` | configured sources, event counts per source, sources yielding nothing, crawl queue depth |
| `GET /api/admin/stats?days=` | ingest runs per source, what they produced, coverage per town (needs `ADMIN_TOKEN`) |
| `POST /api/admin/crawl?limit=` | run one pass of the scheduled artist crawl by hand (needs `ADMIN_TOKEN`) |
| `POST /api/admin/crawl-queue` | enqueue every artist not on the crawl queue yet (needs `ADMIN_TOKEN`) |
| `POST /api/admin/discover-seatgeek?lat&lng&radius` | sweep one area with SeatGeek, ignoring the per-area throttle (needs `ADMIN_TOKEN`) |
| `POST /api/admin/repair-duplicates?after=` | cluster venues, collapse shows stored twice; idempotent. Resume with the `next_artist_id` it returns, or run [scripts/repair-duplicates.sh](scripts/repair-duplicates.sh) (needs `ADMIN_TOKEN`) |
| `POST /api/admin/backfill-bandsintown?limit&offset` | one-off Bandsintown sweep over known artists (needs `ADMIN_TOKEN`) |
| `GET /robots.txt` · `GET /sitemap.xml` | crawler entry points (sitemap built live from D1) |
| `GET /concerts` | server-rendered landing page — real HTML, no JS, built live from D1 |

## Deploying

Production is **https://marquee.rocks**. One Cloudflare Worker serves the web
build **and** the API, and auto-deploys via **Cloudflare Workers Builds** (Git
integration) — on each push it runs `npm run build` (Expo web export → `./dist`)
then `npx wrangler deploy`, which uploads the Worker and the static assets
together. `wrangler.jsonc` pins the D1 `database_id`, so a deploy always binds
the existing database rather than creating one by name.

The Worker answers on any domain pointed at it — the `workers.dev` deploy URL and
`marquee.rocks` both work with no config change — but only one of them is allowed
to *be* the site. `PRIMARY_HOST` in `wrangler.jsonc` names it, and every public
URL (canonical, `og:url`, `sitemap.xml`, `robots.txt`) is written with that origin
whichever host served the request. A request arriving on any other host gets
`X-Robots-Tag: noindex, nofollow` on its HTML and a `robots.txt` that disallows
everything, so the duplicate copy is unindexable rather than merely un-preferred.
Deliberately not a redirect: the deploy URL is what
[scripts/repair-duplicates.sh](scripts/repair-duplicates.sh) and native builds
POST to, and a 301 drops the request body. Unset `PRIMARY_HOST` and the old
behaviour returns (every origin self-canonical), which is what local dev wants.

After the first deploy, one time:

```sh
# load the schema into the remote D1 (DDL only — the dev seed in worker/seed.sql
# is deliberately local, so production never serves made-up shows)
npm run db:apply        # baseline schema + numbered migrations
# set the Worker's secrets (Worker → Settings → Variables and Secrets, or CLI)
npx wrangler secret put TICKETMASTER_API_KEY
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put BANDSINTOWN_APP_ID
npx wrangler secret put SEATGEEK_CLIENT_ID
npx wrangler secret put ADMIN_TOKEN
```

### The custom domain

`marquee.rocks` is attached to the Worker as a **Custom Domain** (Workers & Pages
→ marquee → Settings → Domains & Routes → Add → Custom domain), which needs the
zone on Cloudflare — check `dig NS marquee.rocks` shows `*.ns.cloudflare.com`
before trying. Cloudflare creates the DNS record and issues the certificate
itself; there is no origin to point at.

The equivalent as config is a `routes` entry in `wrangler.jsonc` (staged there,
commented out). It is deliberately not enabled: `wrangler deploy` fails if the
zone isn't active yet, and because deploys run on push, that failure would take
the whole pipeline down rather than just the domain.

Schema changes after the baseline are numbered files in `worker/migrations/`
(`npm run db:migrate` locally, `npm run db:migrate:remote` for production) —
`schema.sql` is only the starting point for a fresh database.

The web is served same-origin, so it needs no API URL. Deploy by hand with
`npm run deploy` (after `npm run build`).

**Native app:** build with EAS (`eas build`) with
`EXPO_PUBLIC_API_URL=https://marquee.rocks` — native has no same origin to be
relative to. It's inlined at **build** time, so changing it means a rebuild, not
a restart. Push/reminders need a dev or store build on a physical device.

## API keys

| Key | Where | Used by |
|---|---|---|
| Ticketmaster Discovery key | developer.ticketmaster.com | discover-events, refresh-artist-events |
| Spotify client id/secret | developer.spotify.com | search-artists |
| Bandsintown app id | see below | refresh-artist-events, admin backfill |
| SeatGeek client id | seatgeek.com/account/develop | discover-events, admin discover-seatgeek |

**Bandsintown** has far more of the club/DIY tier than Ticketmaster, and its API
is gated: it's for "artists and anyone working on their behalf". If you manage an
artist profile, the key is under **Settings → General → Get API Key** in
[Bandsintown for Artists](https://artists.bandsintown.com). Otherwise email
`API@bandsintown.com` with the project and your traffic projections (they state
they don't accept student/educational requests). The open endpoints answer for
some `app_id` values that aren't yours — don't build on those; the crawl in
`todo.md` assumes a key issued to this project.

**SeatGeek** is the third source, and the only one besides Ticketmaster that
searches by *place* rather than by artist — which is what it's here for: its first
San Francisco page is mostly rooms Ticketmaster has never heard of. Registering at
[seatgeek.com/account/develop](https://seatgeek.com/account/develop) gives a
`client_id` immediately, with no review. Two things it publishes that nothing else
here does: a true UTC timestamp and the venue's IANA timezone, so its show times
need no inference at all. Two it publishes that look like data and aren't:
`enddatetime_utc` (a 90-minute template — ignored) and `stats.lowest_price` (the
cheapest resale listing, so it fills a price but never overwrites Ticketmaster's
face value).

## SEO

The web build is a client-rendered SPA, so a crawler that doesn't run JS would
otherwise see an empty shell. Four layers fix that:

1. `src/app/+html.tsx` — head defaults baked into every prerendered route
   (canonical, Open Graph/Twitter card, keywords, `WebSite` JSON-LD, manifest).
2. `<PageMeta>` (`src/components/page-meta.web.tsx`, no-op on native) — per-route
   title + description via `expo-router/head`; detail screens title themselves
   from the record they loaded.
3. `worker/src/seo.ts` — the Worker runs in front of the assets, so for
   `/event/:id`, `/artist/:id` and `/venue/:id` it reads the row from D1 and
   rewrites the shell's `<head>` on the way out (title, description, canonical,
   social card, `noindex` for unknown ids) plus `MusicEvent` / `MusicGroup` /
   `MusicVenue` JSON-LD. It also serves `/robots.txt` and a live `/sitemap.xml`.
4. `worker/src/landing.ts` — the first three layers only ever fix the `<head>`;
   the `<body>` of every route still needs the bundle to boot before it says
   anything. `/concerts` is the exception: server-rendered HTML with no JS and no
   images, built from five D1 reads (totals, the next twelve shows one-per-city,
   thirty cities, the busiest venues, the most-booked artists) plus an FAQ, and a
   JSON-LD `@graph` of `WebPage` / `WebApplication` / `FAQPage` / `ItemList`. It
   is the site's entry point for anything that reads HTML rather than runs it, and
   every row on it links into the app. Edge-cached 30 minutes, stale-while-
   revalidate a day.

### Venue identity, and why a coordinate isn't enough

Two sources agree on *where* long before they agree on what a room is called, so
location leads and names are the tiebreaker ([worker/src/dedupe.ts](worker/src/dedupe.ts)).
The exception that cost real data: Ticketmaster returns a **city centroid** for
venues it has no address for, and the same centroid for every one of them, so five
unrelated San Francisco rooms arrived zero metres apart and merged into a single
venue — after which the feed listed Interpol and Dimmu Borgir at Davies Symphony
Hall. A shared coordinate therefore only merges when the names don't contradict
each other; when they do, the centroid-stamped row falls through to the nested-name
rule and finds its real room instead.

Bandsintown has the mirror-image problem: its `venue.name` is sometimes the *tour*
("Brunette World Tour"), on the venue's real coordinates. Those rows keep their
location and lose their name — a tour title yields no name tokens, so it can
neither agree nor conflict, and the row still merges into the room it is sitting
on. A cluster's head is chosen preferring a real name over a tour title, because
every event is repointed at the head and the head is what the venue page is called.

Known residual: a town's own name still counts as a distinguishing word, so
"Metro Chicago" and "Radius Chicago" can agree on "chicago" when they are close
together. That accounts for most of the clusters still holding three or more real
names.

### Venue links

The venue screen links out to directions, Google reviews, Yelp and the venue's
own site (`src/lib/venue-links.ts`). These are **searches, not resolved records**,
on purpose: none of the three upstreams publishes a venue's website — Ticketmaster
and SeatGeek both return their own venue pages — and a real star rating means a
billed key (Google Places or Yelp Fusion) plus their attribution and caching
rules. OpenStreetMap was the free option for websites and had no `website` tag for
two of four venues checked, so a button that worked half the time would be worse
than one that always gets you there in one more tap.

Regenerate the social card and PWA icons in `public/` with
`node scripts/gen-web-assets.mjs`.

## How it works

- **Local-first:** follows and prefs are stored on the device (AsyncStorage);
  there's no account or server-side user state.
- **Near Me** — the home feed calls `GET /nearby` for the device's location and
  auto-triggers `POST /discover-events` (server-throttled per area) to keep the
  area fresh. A Nearby/Following toggle filters to followed artists.
- **Following** — the app POSTs its follow list to `refresh-artist-events` on
  launch / pull-to-refresh to pull those artists' upcoming shows.
- **Reminders** — local notifications scheduled on-device the day before a
  followed artist's nearby show.
