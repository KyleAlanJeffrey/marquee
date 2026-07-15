# Marquee — TODO

Local-first concert-discovery app. **Cloudflare stack:** Expo app → Cloudflare
Worker (Hono) → D1 (SQLite). Ticketmaster for concert data, Spotify for search.
Follows/prefs on-device (no account). Web → Pages; native → EAS.

## Status legend
- [ ] not started · [~] in progress · [x] done

---

## Done — infinite scroll, Spotify, headers, tickets (this pass)

- [x] **TanStack infinite scroll** on Browse + Venue (`useInfiniteNearby`,
  `useInfiniteVenueEvents`); `/api/nearby` and `/api/venues/:id/events` paginate
  with `{items, nextCursor}`. Explore/Following/Artist/Search stay single-shot.
- [x] **Artist info** (`/api/artists/:id/info`, multi-source, parallel):
  Spotify photo + profile link (backfilled to D1), **top tracks + fan count
  from Deezer** (open API, no key — album art + 30s preview + link), and a
  **bio from Wikipedia** (CC BY-SA, shown "via Wikipedia"). Routes around
  Spotify dev-mode limits (no bio field, top-tracks 403, stripped payload).
- [x] **Fixed broken artist search**: dev-mode Spotify caps `limit` at 10; we
  were sending 15 (HTTP 400 → zero results). Lowered to 10.
- [x] **Contextual page headers** (Event / Artist / Venue / Browse) via a
  `TopBar` `title` prop; tab screens keep the MARQUEE wordmark.
- [x] **Capped the featured card on web** (560px, centered) so the 16:10 hero
  isn't screen-filling on desktop.
- [x] **Tappable search results**: `/api/artists/ensure` upserts a Spotify hit
  into D1, then opens their page (which pulls the TM schedule on open).
- [x] **StubHub** resale option in the event "Get Tickets" section (search deep
  link); buy bar is always actionable ("Buy Tickets" or "Find on StubHub").
- [x] **Real map** for "Nearby Venues" via Mapbox Static Images API (dark style,
  pins baked in — a plain `<Image>`, so web + native share one path). Gated on
  `EXPO_PUBLIC_MAPBOX_TOKEN`; stylized grid is the fallback when unset.

## Done — unified single-Worker deploy (this pass)

- [x] One Worker now serves the web build (static `assets`) **and** the API at
  `/api/*` (run_worker_first + SPA fallback). Root `wrangler.jsonc`; the worker
  is flattened into the root package (hono + wrangler in root deps).
- [x] Auto-deploys via **Cloudflare Workers Builds** (Git integration):
  `npm run build` → `npx wrangler deploy`. Removed the separate Pages deploy and
  the GitHub Action; deleted `worker/package.json` / `wrangler.toml`.
- [x] Client calls same-origin `/api` (EXPO_PUBLIC_API_URL optional on web,
  required for native). `npm run deploy` / `db:apply` scripts added.
- [x] Verified locally: one `wrangler dev` serves `/api/nearby` (14 rows, prices),
  `/` (Expo index), `/browse` (static), `/artist/:id` (SPA fallback). tsc + lint
  + build clean.

## Done — enhanced Explore + Browse All (this pass)

- [x] Reworked the Explore sections to match the newer mockups (colors/fonts
  unchanged): a search bar, "Nearby Venues" with a live-show count + View All
  and a richer map overlay (location + "within N miles" + Explore Area), a wide
  16:10 hero, a "Trending Nearby" list, and image-top "Coming Up Next" cards.
- [x] New **Browse All** screen (`src/app/browse.tsx`): genre chips, result
  count, grid/list toggle, a feature card, 2-up grid, Load More, floating Map
  View. Reached from View All / Browse All.
- [x] **Ticket price** ingested from Ticketmaster (`price_from`, migration
  0003) and shown as "$N+" with a "Tickets"/"Free" fallback. Verified: real LA
  pull returned prices (D.I. $28, Flying Lotus $19); seed events priced.
- [x] Verified every section in-browser (mobile) against real + seed data.

## Done — Cloudflare migration (this pass)

- [x] **Worker API** (`worker/`, Hono): `/nearby`, `/artists/:id`,
  `/artists/:id/events`, `/events/:id`, `/search-artists`, `/discover-events`,
  `/refresh-artist-events`.
- [x] **D1 schema + seed** ported from Postgres (lat/lng columns instead of
  PostGIS; genres as JSON text; UUIDs generated in the Worker).
- [x] **Geo without PostGIS:** bbox prefilter on indexed lat/lng + haversine in
  the Worker, applied in `/nearby`.
- [x] **Client rewired** to the Worker (`src/lib/api.ts`, rewritten `hooks.ts` /
  `discovery.ts`); removed `@supabase/supabase-js` + the supabase client.
- [x] **Supabase removed** (whole `supabase/` dir); `scripts/dev.sh` now runs
  Worker + local D1 + Expo.
- [x] Fixed a latent duplicate-artist / unique-collision bug in the refresh path
  while porting it.
- [x] **Verified end-to-end** against real Ticketmaster: local D1 seeded,
  `/discover-events` ingested 122 NYC shows, `/nearby` served them with correct
  haversine distances, refresh pulled artists' dates, and the app UI rendered
  real data with no console errors. App tsc + lint + web bundle and worker tsc
  all clean.

## Next up

- [ ] **Ship it:** `git push` — Cloudflare Workers Builds auto-deploys
  (`npm run build` → `wrangler deploy`). Then apply the schema to remote D1
  (`npm run db:apply`) and set the prod secrets:
  `wrangler secret put TICKETMASTER_API_KEY` / `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET`.
- [ ] **Rotate the Ticketmaster key** (shared in chat); update the root
  `.dev.vars` and the prod Worker secret.
- [ ] **Set `EXPO_PUBLIC_MAPBOX_TOKEN`** to enable the real map: a public `pk.*`
  token in `.env` for local dev, and as a **build-time** env var in Cloudflare
  Workers Builds for prod (Expo inlines `EXPO_PUBLIC_*` at build time).
- [ ] **Scheduled discovery** (optional): a Cloudflare Cron Trigger that sweeps a
  fixed launch-city list into D1 so feeds are warm before the first visitor.

## Later — ticketing & enrichment

- [ ] **StubHub Partner API** (Partnerize): today the event page's StubHub
  option is a **search deep link** (`stubhub.com/explore?q=artist+city`) — no
  open listings API without an affiliate account. With Partner creds, swap it
  for real per-event listings + prices (and affiliate credit on sales).
- [ ] **More resale sources**: add SeatGeek / Vivid Seats alongside StubHub in
  the event "Get Tickets" section (same `ticketSources()` pattern in
  `src/lib/tickets.ts`).
- [ ] **Spotify extended quota** (optional now — routed around via Deezer/
  Wikipedia): the app is in **development mode**, so `/artists/:id` is stripped
  (no genres/popularity) and `top-tracks` is 403. Extended quota would let us
  source top tracks/genres from Spotify directly instead of Deezer.
- [ ] **In-app track previews**: Deezer top tracks include a 30s `preview_url`
  (`ArtistTrack.preview_url`) — wire an audio player (expo-av) so tapping a
  track plays the preview instead of opening the link.

## Design-section placeholders (need real data)

- [x] Artist bio (Wikipedia), top tracks + fans (Deezer), photo + Spotify link.
- [ ] Fan/artist galleries from real images; support acts from same-venue
  events; ticket price on the event Buy bar.

## Known limitations (by design)

- No account; follows/prefs are per-device.
- Dark-only theme.
- D1/SQLite geo is bbox + haversine (fine at city radius; not true spherical
  indexing). Revisit if radii or data volume grow a lot.
- Native apps aren't hosted on Cloudflare — they ship via EAS/app stores and
  point at the deployed Worker.

_Design source: `stitch_marquee_concert_tracker/` (DESIGN.md + mockups)._
