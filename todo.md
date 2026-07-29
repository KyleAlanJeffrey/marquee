# Marquee — TODO

Local-first concert-discovery app. **Cloudflare stack:** Expo app → Cloudflare
Worker (Hono) → D1 (SQLite). Ticketmaster for concert data, Spotify for search.
Follows/prefs on-device (no account). Web → Pages; native → EAS.

## Status legend
- [ ] not started · [~] in progress · [x] done

---

## Done — CodeRabbit audit pass (this pass)

Ran the CodeRabbit CLI over the whole repo (in per-directory slices; the free CLI
allowance times out on the full 15k-line diff). Fixed:

- [x] **Unbounded Ticketmaster 429 retry** (`sources.ts`) — recursed forever on a
  spent quota; now at most 4 requests (the first plus 3 retries) with increasing
  backoff.
- [x] **No timeouts on outbound calls** — added `fetchWithTimeout` (8s,
  AbortController) and routed TM/Bandsintown/Spotify/Deezer/Wikipedia/Bluesky
  through it, so a stalled upstream can't hold a Worker request open. The
  deadline covers the response headers, not the body read.
- [x] **One bad Bandsintown datetime** threw and dropped an artist's whole
  schedule; that record is now skipped.
- [x] **Dev seed shipped to production**: `worker/schema.sql` is DDL only,
  `worker/seed.sql` is local-only (`db:apply:local`), `worker/unseed.sql` +
  `npm run db:unseed` (`:remote` for the deployed one) clean a database that
  already has it. Made-up shows must
  never reach the sitemap or social cards.
- [x] **API errors**: `String(err)` no longer returned to callers (logged
  instead), and missing-config paths return 503 rather than a 200 with
  `ingested: 0`.
- [x] **`noindex` could be dropped** if the shell had no robots meta — it's now
  part of the guaranteed tag set in `seo.ts`.
- [x] **Sitemap `lastmod`** was always "today" (which crawlers discount); it now
  reflects each row's ingest time.
- [x] **Reminders**: tapping one did nothing (the payload carries `eventId`, the
  handler only read `artistId`) — now opens the event page. A show <24h out no
  longer schedules a reminder for "one minute from now", and past/invalid start
  times schedule nothing.
- [x] **Store hydration races**: a follow or pref change made while AsyncStorage
  was still loading got overwritten; hydration now merges instead of replacing.
- [x] **Location failures** on the home + following tabs left a permanent
  spinner (no `catch`); they now fall back to the "Location needed" state, and
  Following shows it instead of a misleading empty list.
- [x] **Map lifecycle** (`map.web.tsx`): the whole Mapbox instance was destroyed
  and recreated on every data/follow change, throwing away the user's pan/zoom.
  Init and marker updates are now separate effects; a failed GL load is no
  longer cached forever and falls back to the list; pins are attached on
  `style.load` (they're DOM overlays and don't need a completed first paint).
- [x] Smaller ones: `formatRelativeDay` called past dates "Tonight"; unhandled
  `Linking.openURL` rejections (now a shared `openUrl()` that reports failure);
  artist page treated a failed events query as "no shows"; browse route params
  weren't normalised (`string[]`/NaN) and its Map View button was a no-op
  without coords; the grid-map fallback pinned same-latitude venues to an edge;
  `GradientButton block` didn't stretch; "This Weekend" wasn't weekend-filtered
  (retitled "Up Next Near You"); accessibility labels on icon-only controls.

Second pass — CodeRabbit reviewing the fix commit itself:

- [x] **Reverse geocode failure looked like a denied permission** on the home tab
  (it shared the location `try`), hiding the feed even though coordinates were
  in hand. The label lookup now has its own `catch`.
- [x] **Route coordinates were parsed three different ways**; `/map` still used
  `Number(lat)`, so `?lat=` mapped 0,0 and an out-of-range latitude threw inside
  Mapbox. `src/lib/params.ts` is now the single validated parser (blank/NaN/
  out-of-bounds → no location), shared by browse + both map screens, and `/map`
  says what to do instead of rendering an empty screen.
- [x] **A bad Mapbox token or unreachable style** failed asynchronously, after
  `loadMapbox()` had resolved, leaving a blank canvas; GL `error` events before
  the style lands now trip the list fallback (later ones don't — a single missing
  tile shouldn't tear down a working map).
- [x] **`/search-artists` only checked `SPOTIFY_CLIENT_ID`** and 500'd when the
  secret was the missing half; both are required for the 503.
- [x] **`db:unseed` defaulted to `--remote`** — it's the local database now,
  with `db:unseed:remote` for the deployed one.
- [x] **Re-seeding kept stale dates** (`insert or ignore` on relative
  `strftime`), so seed shows drifted into the past; the seed events are now
  deleted and rewritten on every run.

Also skipped from that pass: swapping `openUrl()`'s web `console.warn` for a
toast — there's no toast/banner primitive in the app, and adding one to report a
failed `Linking.openURL` (which on web means a blocked popup) isn't worth a new
UI layer.

Deliberately skipped (verified as non-issues): unhandled rejections in
`discoverEvents`/`refreshArtistEvents`/`ensureArtist` (they already catch
internally and resolve), `SecondaryEventCard` "missing" `onToggleFollow` (the
prop doesn't exist — list mode has no follow control by design), and widening
`PressableScale`'s `style`/`children` types to support callback form (no caller
uses it).

Not yet covered: the `src/lib` slice hit the free-tier rate limit
(`isProUser: false`) — its findings come from the timed-out full-repo pass only.

## Done — web SEO + byline (this pass)

- [x] **Static head defaults**: `src/app/+html.tsx` — keywords, robots
  (`max-image-preview:large`), canonical, Open Graph + Twitter card, theme
  colour, apple-web-app tags, manifest link and a `WebSite` JSON-LD block, on
  every prerendered route.
- [x] **Per-route titles/descriptions**: `<PageMeta>`
  (`src/components/page-meta.web.tsx`, no-op on native) wraps
  `expo-router/head`, mounted in `_layout.tsx` (defaults) and on every screen —
  including the dynamic event/artist/venue pages, which title themselves from
  the loaded record.
- [x] **Server-side SEO for the SPA** (`worker/src/seo.ts`): the Worker already
  runs in front of the assets, so it looks the route up in D1 and rewrites the
  shell's `<head>` (title, description, canonical, og/twitter, `noindex` for
  unknown ids) and appends `MusicEvent` / `MusicGroup` / `MusicVenue` JSON-LD.
  Crawlers that don't run JS now get real per-page metadata.
- [x] **`/robots.txt` + `/sitemap.xml`** served by the Worker; the sitemap is
  generated live from D1 (static routes + every upcoming event and the
  artists/venues behind them).
- [x] **Social + PWA assets**: `public/og-image.png` (1200×630 brand card),
  `apple-touch-icon.png`, `icon-192/512.png`, `manifest.json` — generated by
  `scripts/gen-web-assets.mjs`, copied to the export root by Expo.
- [x] **"built by Kyle" badge**: `@kylealanjeffrey/badge` rendered on web only
  (`src/components/kyle-badge.web.tsx`), and only ≥900px wide — on phone widths
  every corner is already occupied by app chrome.

## Done — backend module structure (this pass)

- [x] Split the monolithic worker into modules: `env.ts` (types), `schema.ts`
  (Drizzle tables), `db.ts` (client), `data.ts` (repository — reads/writes),
  `sources.ts` (Ticketmaster/Spotify/Deezer/Wikipedia + orchestrators),
  `schemas.ts` (zod), and per-resource routers in `routes/`
  (`artists`, `venues`, `events`, `feed`, `search`) mounted by a thin
  `index.ts`. Deleted `lib.ts`. All endpoints re-verified.

## Done — Drizzle ORM + validated Hono API (this pass)

- [x] **Drizzle ORM** for D1: table defs in `worker/src/schema.ts` (+ `getDb()`
  client in `worker/src/db.ts`). All raw `db.prepare` SQL in `lib.ts` replaced
  with the Drizzle query builder — selects/joins, `onConflictDo*` upserts, and
  `db.batch` for the ingest path. `worker/schema.sql` stays the applied DDL +
  seed (keep the two mirrored).
- [x] **Validated Hono API**: `@hono/zod-validator` + zod schemas on every
  request (query params + JSON bodies), replacing the manual parse/guard code.
  Invalid input now returns a 400 automatically.
- [x] Verified end-to-end: all reads, upserts (ensure), and the batch ingest
  (`discover` → 113 events) work through Drizzle; validation returns 400 on
  bad input; the app renders unchanged (identical JSON contracts).

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
