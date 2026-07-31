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
  app/            expo-router screens (Explore tab at /explore, Profile tab, search modal, artist + event detail)
  components/     UI building blocks (design system, cards, map, etc.)
  lib/            api client (Worker), TanStack Query hooks, local follows/prefs stores, reminders
worker/
  src/index.ts    thin entry: mounts the API routers, robots/sitemap, asset SEO
  src/routes/     per-resource Hono routers (artists, venues, events, feed, search, admin)
  src/data.ts     D1 repository (reads/writes) via Drizzle
  src/sources.ts  external APIs (Ticketmaster, Bandsintown, SeatGeek, Spotify, Bluesky)
  src/dedupe.ts   cross-source venue/show identity · src/crawl.ts crawl scheduling
  src/timezone.ts venue-local → UTC (state/province zone + Intl, longitude fallback)
  src/seo.ts      robots.txt, sitemap index + children, per-page <head> + JSON-LD
  src/page.ts     shared chrome for the server-rendered pages (CSS, head, shell)
  src/detail.ts   the <body> for /event, /artist and /venue, injected into the shell
  src/landing.ts  / — the front door, rendered without JavaScript
  src/cities.ts   /concerts/:town — a page per town, and the town↔slug mapping
  src/indexnow.ts tells Bing et al. about the shows the crawl just wrote
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
| `GET /robots.txt` · `GET /sitemap.xml` | crawler entry points (a sitemap index; children at `/sitemap-pages.xml`, `/sitemap-events-N.xml`, …) |
| `GET /` | server-rendered landing page — real HTML, no JS, built live from D1 |
| `GET /concerts` | 301 to `/`, where the landing page lives now |
| `GET /concerts/:town` | one server-rendered page per town (`/concerts/austin-tx`); 301 for another spelling of one, 404 for a slug no town answers to |

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
| Clerk publishable + secret key | dashboard.clerk.com | accounts, `/api/me`, anything that publishes |

**Clerk** is the identity provider — see "Accounts" in `todo.md` for why it was
bought rather than built. Four variables, and only the first two are needed:

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (client, in `.env`) — publishable by design;
  it names the Clerk instance and authorises nothing.
- `CLERK_SECRET_KEY` (Worker, in `.dev.vars` / `wrangler secret put`).
- `CLERK_JWT_KEY` (Worker, optional) — the PEM public key from **API keys → Show
  JWT public key**. With it, verifying a session is pure computation; without it
  the SDK fetches the JWKS from Clerk's API on a cache miss, and a Worker's
  subrequest budget is shared with ingestion. Worth setting in production.
- `CLERK_AUTHORIZED_PARTIES` (Worker, optional) — comma-separated origins allowed
  to have minted a session. Guards the subdomain-cookie-leak case; a token from a
  *different* Clerk instance already fails on its signature.

**Leaving all of them unset is a supported configuration**, not a broken one: no
provider is mounted, every request resolves to signed-out, and the app behaves
exactly as it did before accounts existed. `GET /api/me` reports which state
you're in — `{"signed_in":false,"configured":false}` means no keys are set.

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
otherwise see an empty shell. Five layers fix that:

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
4. `worker/src/detail.ts` — the layers above only fix the `<head>`, and a page
   whose entire body is a loading spinner has nothing to rank. So the same D1 rows
   that produced the metadata also render the body: the show and the rest of that
   act's tour on `/event/:id`, the whole tour-date list on `/artist/:id`, the
   calendar on `/venue/:id`. The markup replaces the export's prerendered spinner
   inside `#root`, and the Worker rewrites `__EXPO_ROUTER_HYDRATE__` to `false` on
   exactly those pages so the bundle mounts with `createRoot().render()` — which
   clears the container by design — instead of hydrating markup that no longer
   matches. Nothing is lost in the swap; what it discards is a spinner's worth of
   prerender. App routes keep hydration untouched.
5. `worker/src/landing.ts` + `worker/src/cities.ts` — a crawler still needs a way
   *in*, and a page per query people actually type. These are documents of their own
   rather than rewritten shells: server-rendered HTML with no JS and no images, built
   from D1 on the edge and sharing one stylesheet via `page.ts`. `/` is the front
   door — totals, the next twelve shows one-per-city, thirty city links, the busiest
   venues, the most-booked artists, an FAQ. It is at `/` on purpose: every inbound
   link and every share arrives there, and for a month that address answered with
   the app's loading spinner while this page earned its own way from nothing at
   `/concerts` (which now 301s here). The app's feed moved to `/explore`.
   `/concerts/:town` is one page per town with an
   upcoming show — ~1,700 of them — each listing that town's next 120 shows by
   date, its venues, its acts and the towns within 180 miles. Both carry a JSON-LD
   `@graph`. Edge-cached 30 minutes, stale-while-revalidate a day.

   A town is a (city, region) pair on the venue rows, the same identity the app's
   town search uses — but the rows spell it more than one way. "Montréal" and
   "Montreal", "United Kingdom" and "GB": one town, two rows, and picking one row
   would leave the other's shows off the page (61 of Montréal's 126, measured).
   `cities.ts` folds them — busiest spelling wins the URL and the title, the shows
   are looked up under every spelling — and the spellings that lost redirect to the
   one that won, since some of them are already in Google's index.

### Index hygiene

Being crawlable is not the same as being worth indexing, so the Worker also says
what *not* to keep. Past events, artists with nothing booked and rooms with
nothing booked are `noindex` — thousands of thin pages are how a site teaches
Google it is mostly empty. A venue id that is a cluster member canonicals to its
cluster head instead of competing with it. And `/sitemap.xml` is a sitemap
*index*: the single document it replaced capped at 5,000 URLs per type and was
quietly omitting two thirds of the catalogue, so the paginated version logs
whenever it has to drop anything.

### Getting indexed sooner

Shows go on sale weeks ahead and the crawl runs hourly, so waiting to be
discovered costs the whole interesting window. Set `INDEXNOW_KEY` to any 8–128
characters of `[A-Za-z0-9-]`:

```sh
npx wrangler secret put INDEXNOW_KEY
```

Use that command, not the dashboard's **Variables** panel. A plaintext variable
added there is not in `wrangler.jsonc`, and `wrangler deploy` replaces the whole
vars block with the one it finds in the config — so the next push silently unbinds
it. That happened here: submissions stopped with no 429, no error and no log line,
looking exactly like a run with nothing to announce. Secrets survive a deploy, and
the unbound case now logs instead of returning quietly.

and each crawl POSTs the URLs it just created to IndexNow — read by Bing, Yandex,
Seznam and Naver — while `/<key>.txt` starts answering with the key so they can
verify it. Unset, nothing is submitted. Google doesn't participate in IndexNow,
so this complements the sitemap rather than replacing it.

**Every submission from the Worker is currently refused with 429**, and the cause is
not anything in the payload. Measured against the live endpoint:

| request | origin | result |
| --- | --- | --- |
| 20 never-announced event URLs | laptop | `200` |
| 3 hubs announced ~96×/day for days | laptop | `200` |
| `/` alone — the most re-announced URL we have | laptop | `200` |
| 154 URLs: root + 50 hubs + 103 events, the cron's exact shape | laptop | `200` |
| 71 / 100 / 153 / 263 URLs, every scheduled run | Worker | `429` |

Content, size and repetition are all ruled out — the laptop request that succeeded
was a reconstruction of the Worker request that failed minutes earlier. What is left
is the origin, which points at a per-IP limit on Cloudflare's shared Worker egress
addresses, plausibly because a great many Workers submit to IndexNow from them. No
change to this code can fix it. The options are Bing's authenticated URL Submission
API (needs Webmaster Tools verification and a key, and has a per-site quota rather
than a per-IP one), submitting from somewhere with its own address, or leaning on the
sitemap — which Bing does read.

The 24-hour listing throttle stays regardless. `indexnow_log` records when `/` and
each city hub was last announced and holds it for a day; event URLs are exempt, since
each is a page that did not exist an hour ago. That is the right behaviour on its own
merits — a crawler does not need telling 96 times a day that a page changed — it just
isn't the fix it was originally written as.

One trap worth knowing if you ever chase this: `console.log` is not a record.
`wrangler tail` samples, and it dropped the cron invocation entirely at ~3,000 events
in a window. Each run now writes an `ingest_runs` row instead:

```sh
npx wrangler d1 execute marquee --remote \
  --command "select started_at, scanned, inserted, failed, note from ingest_runs where source='indexnow' order by started_at desc limit 10"
```

A run that submitted nothing writes a row too, with `note` starting `noop` and the
reason after it. There are four:

| `note` | Means |
| --- | --- |
| `noop nothing new` | A quiet hour — the crawl wrote no future-dated shows. Normal. |
| `noop INDEXNOW_KEY not bound` | The secret is missing. Nothing has been submitted since the deploy that dropped it. |
| `noop PRIMARY_HOST not bound` | No canonical host, so there is no absolute URL to submit. |
| `noop INDEXNOW_KEY malformed` | The key is set but isn't 8–128 of `[A-Za-z0-9-]`, so Bing would reject the list. |

The first and the second used to be the same silent `return null`, which is exactly
how the unbound key went unnoticed for a day; telling them apart is the point.

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

### Brand assets

`node scripts/gen-web-assets.mjs` redraws every icon — the PWA set in `public/`,
the favicon, and the app, splash and Android adaptive layers in `assets/images/` —
from one vector mark plus `public/manifest.json`. The mark's geometry is a copy of
`src/components/brand-logo.tsx`, so the inline SVG in the app and the PNGs on disk
stay the same drawing.

The 1200×630 social card is built separately, because it sets Anybody and `sharp`
can only use fonts installed locally. `scripts/og-image.html` is the source; the
generator's header has the headless-Chrome command that rasterises it.

**After rebuilding the card, bump `?v` on `OG_IMAGE` in `worker/src/page.ts` and in
`src/app/+html.tsx`.** Facebook, X, Slack, iMessage and Google all cache the card
against its URL, so without a new URL an existing share keeps showing the old one.

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
