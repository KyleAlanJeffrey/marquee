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
  src/index.ts    Hono routes (reads + ingestion endpoints)
  src/lib.ts      Ticketmaster/Spotify/Bandsintown + D1 persistence + geo
  schema.sql      D1 schema + dev seed (one file; apply with `d1 execute`)
  wrangler.toml   Worker + D1 binding
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

| Route | Purpose |
|---|---|
| `GET /nearby?lat&lng&radius` | upcoming shows near a point (bbox + haversine) |
| `GET /artists/:id` · `GET /artists/:id/events` | artist + their upcoming shows |
| `GET /events/:id` | event detail |
| `POST /search-artists` | Spotify artist search |
| `POST /discover-events` | pull nearby shows from Ticketmaster (throttled per area) |
| `POST /refresh-artist-events` | pull shows for the on-device follow list |

## Deploying

**Worker + D1:**

```sh
cd worker
npx wrangler d1 create marquee          # paste the id into wrangler.toml
npx wrangler d1 execute marquee --remote --file=schema.sql
npx wrangler secret put TICKETMASTER_API_KEY
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler deploy                     # → https://marquee-worker.<sub>.workers.dev
```

**Web app → Cloudflare Pages:**

```sh
EXPO_PUBLIC_API_URL=https://marquee-worker.<sub>.workers.dev npx expo export -p web
npx wrangler pages deploy dist --project-name marquee
```

**Native app:** build with EAS (`eas build`); set `EXPO_PUBLIC_API_URL` to the
deployed Worker. Push/reminders need a dev or store build on a physical device.

## API keys

| Key | Where | Used by |
|---|---|---|
| Ticketmaster Discovery key | developer.ticketmaster.com | discover-events, refresh-artist-events |
| Spotify client id/secret | developer.spotify.com | search-artists |
| Bandsintown app id (optional) | artists.bandsintown.com | refresh-artist-events |

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
