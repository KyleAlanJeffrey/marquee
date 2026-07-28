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
  src/routes/     per-resource Hono routers (artists, venues, events, feed, search)
  src/data.ts     D1 repository (reads/writes) via Drizzle · src/sources.ts external APIs
  src/seo.ts      robots.txt, sitemap.xml, per-page <head> + JSON-LD injection
  schema.sql      D1 schema (DDL only — this is what production gets)
  seed.sql        local-only dev seed (fictional shows) · unseed.sql removes it
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
`worker/.dev.vars`:

```
TICKETMASTER_API_KEY=your-key
SPOTIFY_CLIENT_ID=…
SPOTIFY_CLIENT_SECRET=…
```

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
| `POST /api/search-artists` | Spotify artist search |
| `POST /api/discover-events` | pull nearby shows from Ticketmaster (throttled per area) |
| `POST /api/refresh-artist-events` | pull shows for the on-device follow list |
| `GET /robots.txt` · `GET /sitemap.xml` | crawler entry points (sitemap built live from D1) |

## Deploying

One Cloudflare Worker serves the web build **and** the API, and auto-deploys via
**Cloudflare Workers Builds** (Git integration) — on each push it runs
`npm run build` (Expo web export → `./dist`) then `npx wrangler deploy`, which
uploads the Worker and the static assets together. The D1 database is
auto-created by name on first deploy (no id pinned in `wrangler.jsonc`).

After the first deploy, one time:

```sh
# load the schema into the remote D1 (DDL only — the dev seed in worker/seed.sql
# is deliberately local, so production never serves made-up shows)
npm run db:apply
# set the Worker's secrets (Worker → Settings → Variables and Secrets, or CLI)
npx wrangler secret put TICKETMASTER_API_KEY
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
```

The web is served same-origin, so it needs no API URL. Deploy by hand with
`npm run deploy` (after `npm run build`).

**Native app:** build with EAS (`eas build`) and set `EXPO_PUBLIC_API_URL` to the
deployed Worker origin (native can't use same-origin relative URLs).
Push/reminders need a dev or store build on a physical device.

## API keys

| Key | Where | Used by |
|---|---|---|
| Ticketmaster Discovery key | developer.ticketmaster.com | discover-events, refresh-artist-events |
| Spotify client id/secret | developer.spotify.com | search-artists |
| Bandsintown app id (optional) | artists.bandsintown.com | refresh-artist-events |

## SEO

The web build is a client-rendered SPA, so a crawler that doesn't run JS would
otherwise see an empty shell. Three layers fix that:

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
