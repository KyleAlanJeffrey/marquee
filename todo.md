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

Third pass — the `src/lib` slice (finally past the free-tier rate limit):

- [x] **Corrupt stored follows reached the UI**: `JSON.parse` output was trusted
  wholesale, so a partial write or a hand-edited `localStorage` entry crashed the
  Following screen on `undefined.name`. Entries are now validated with a type
  guard (identity + shape) on hydration.
- [x] **Unfollows made before hydration were undone** by the disk copy; those
  drops are recorded and filtered out of the stored list.
- [x] **Duplicates in the stored list** survived when the in-memory list was
  empty (the old fast path assigned it as-is); the merge now dedupes as it
  accumulates.
- [x] **"Remind Me" asked for notification permission before checking the
  date**, so a past show prompted and then silently did nothing.

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

Coverage: `worker/`, `src/app/`, `src/components/`, `src/lib/` and the two fix
commits were each reviewed as their own slice (the free CLI allowance times out
on the whole diff at once and rate-limits repeated runs, so this took a few
attempts).

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

## Plan — event coverage (Bandsintown-led ingestion)

Ticketmaster alone misses the club/DIY tier. Bandsintown lists far more bands,
but its open API is shaped differently, so this is an architecture change, not a
new `fetch`. Probed 2026-07-28:

- **Bandsintown ingestion is dead right now.** `BANDSINTOWN_APP_ID` is empty in
  `.dev.vars`, and `bitEventsForArtist` returns `[]` without it. Local D1: 962
  `ticketmaster` events, **0** `bandsintown`. Any app_id string works on the open
  tier (`app_id=abc` → 200), so this was never a quota problem.
- **Bandsintown has no geographic search.** `/artists/{name}/events` (v3 and v4)
  returns 200; `/events/search?location=`, `/venues/{id}/events` and `mbid_`
  lookups return 403 / internal error without a partner key. Coverage therefore
  scales with **how many artists we know**, not with how many places we sweep.
- **Per artist it wins where it matters**: Wednesday 28 vs 22 TM events,
  Militarie Gun 41 vs 23, feeble little horse 34 vs 23. Payload also carries
  venue lat/lng, `offers`, `sold_out`, `free`, festival dates — and `lineup`
  (support acts by name), which is a free artist-discovery feed.
- **Name resolution is fragile both ways**: TM attraction matching is
  exact-name-only, and BIT is name-keyed (`MJ Lenderman` → `0`, `MJ Lenderman and
  the Wind` → NotFound). Empty and unknown are indistinguishable.
- **Nothing runs on a schedule.** Ingestion only happens when a client posts
  `/discover-events` or `/refresh-artist-events`, so coverage tracks traffic.
- **Cross-source dedupe doesn't exist**, and it's the blocker: `events` is unique
  per `(source, source_event_id)` and `nearbyEvents` collapses on `venue_id`, but
  TM's Fillmore and BIT's Fillmore are different venue rows. Turning BIT on at
  volume today would double-list every overlapping show.

### Phase 1 — turn Bandsintown on and see it (small)
- [x] **`BANDSINTOWN_APP_ID` set locally**, ingestion confirmed working. Still
  needed for production: a key issued to this project — only a couple of
  `app_id` values answer, and they aren't ours, so prod shouldn't lean on one
  (README has both request paths).
- [x] `GET /api/admin/health` — which sources are configured, events per source,
  and `silent_sources` for anything configured that has produced nothing. A
  missing key no-ops silently; that's how this hid.
- [x] Store what Bandsintown already sends: `ends_at`, `sold_out`, `is_free` and
  `lineup` on `events` (migration `0001_ingest_extras.sql`), plus
  `artists.bandsintown_id` / `mbid` so lookups can use the unambiguous
  `id_{id}` form instead of a display name.
- [x] **D1 migrations** (`worker/migrations/`, `npm run db:migrate`) — `schema.sql`
  is now just the baseline; changes after it are numbered files.
- [x] `persist()` refreshes instead of ignoring: an existing row's name, date,
  price, ticket url, sold-out and lineup are updated on re-ingest, with
  `coalesce(excluded.x, x)` so a source that doesn't carry a field can't blank
  one another source filled in. New-vs-updated is told apart by `created_at`, so
  `ingested` counts stay honest. Verified live against Ticketmaster.
- [x] **Tests exist now** (`npm test`, vitest): the Bandsintown mapping is pinned
  to a recorded payload in `worker/test/fixtures/`.
- [x] `POST /api/admin/backfill-bandsintown?limit&offset` (`ADMIN_TOKEN` guarded).
  **Baseline measured** — 10 artists, 2.4s, **203 new events** on top of 1,060
  from Ticketmaster: Chris Botti +88, Diamond Rio +28, White Denim +28, Joji +22,
  Streetlight Manifesto +20, Willie Nelson +10. Every row arrived with a lineup
  and a sold-out flag, 88 with an end time, and 9 artists learned their
  `bandsintown_id` + `mbid` on the way through. That is ~20 events per artist
  from one source we weren't calling, against 763 artists in the table.

### Phase 2 — canonical shows + venues (the blocker)

Measured on the backfill above: **17 shows already listed twice**, from 10
artists. The venue names differ exactly as feared — `LONDON MUSIC HALL` vs
`Forest City London Music Hall of Fame`, `Moody Center ATX` vs `Moody Center`,
`The Danforth Music Hall` vs `Danforth Music Hall` — while the coordinates agree
to 0.0001–0.0022 degrees (11–240m). So geo proximity is the reliable signal and
the name is the weak one, which sets the matcher's priorities.
- [x] Venue identity: `venues.canonical_venue_id` clusters source rows by
  geography with the name as tiebreaker (`worker/src/dedupe.ts`). Measured
  against real pairs: Ticketmaster often gives a **city centroid**, not the door
  — 821m (Franklin Music Hall), 1.4km (Royal Oak), 6.6km (The Eastern) — so
  matching runs in tiers: ≤50m outright, ≤300m with a shared distinguishing
  word, ≤12km with a nested name in the same town.
- [x] Show identity: matched on (canonical venue, artist, ±6h) rather than a
  unique key, because Bandsintown times are venue-local and Ticketmaster's are
  UTC. `persist()` merges by field ownership (TM owns price/time/name, BIT owns
  lineup/sold_out/ends_at) and records every upstream id in `events.sources`.
  The `groupBy` hack in `nearbyEvents` is gone. **Result: 17 duplicate shows → 0,
  92 venues clustered, 1,170 provenance rows filled, re-runnable.**
- [x] Two listings arriving in the *same* batch (`refreshArtists` fetches both
  sources at once) are matched in memory too, so they never become two rows that
  only the repair pass can collapse.
- [x] Test runner (`npm test`, vitest): the measured venue pairs, show-identity
  windows, field ownership and the timezone conversion are all pinned.
- [x] **Timezones done properly**: a state/province → IANA zone table plus `Intl`
  gives the real offset for the night of the show (`worker/src/timezone.ts`).
  Longitude alone was an hour out under DST — a 20:00 August show in San
  Francisco was stored as 04:00Z instead of 03:00Z. Longitude remains the
  fallback outside North America.
- [x] `POST /api/admin/repair-duplicates` for data ingested before all this.
  Venue clustering is grid-bucketed (not quadratic) and the event scan is
  bounded, reporting `truncated` when there is more to do.

### Phase 3 — artist frontier crawl (the coverage multiplier)
- [x] `artist_sources` (artist_id, source, source_key, state, last_checked_at,
  last_ok_at, fail_count, next_check_at) is the work queue — migration
  `0003_artist_crawl.sql`, which also enqueues every artist already in D1.
- [x] Cron Trigger every 15 minutes (`wrangler.jsonc` → `triggers.crons`) pops
  the due batch, calls Bandsintown, persists and reschedules by tier:
  **6h** for an artist a client asked about in the last week (`artists.last_requested_at`),
  **24h** with a show upcoming, **7d** cold, **14d** for an unconfirmed lineup
  name, exponential backoff (1h→7d) on failure, 30d negative cache on not-found.
  Batch size is deliberately small (8/run ≈ 770 checks a day): every artist is a
  subrequest plus D1 calls, and both are budgeted per invocation.
- [x] Frontier expansion from `lineup[]`: unknown support acts become artists in
  state `discovered`, queued behind everything already known. Names are matched
  case-insensitively against existing artists first — inserting blind would
  multiply duplicate artists instead of adding coverage.
- [x] Resolution: `lookupKeys` tries the stored key, `id_{bandsintown_id}`, their
  spelling, ours, then each without a leading "The"; whichever answers is stored
  as `source_key`. The negative cache is `state='not_found'` with a long sleep
  rather than a separate table — Bandsintown can't distinguish "unknown artist"
  from "no dates yet", so a verdict has to expire. **No `artist_aliases` table
  yet**; add one if a real alias case shows up that these variants miss.
- [x] Visible: `GET /api/admin/health` reports queue depth and how much is due;
  `POST /api/admin/crawl?limit=` runs the exact cron code path by hand.
- [x] **Measured** — 33 artists crawled: 224 new events and 67 new frontier
  artists, ~0.25s per artist. On 830 artists that pace is the whole roster every
  ~26 hours, and the roster grows itself from lineups.
- [ ] Watch the first production runs for CPU/subrequest limits (the free plan is
  tight) and raise `CRAWL_BATCH` if there's headroom.

### Phase 4 — complement with location-capable sources
- [ ] SeatGeek: free `client_id`, has `/2/events?lat=&lon=&range=` (403
  unauthenticated when probed). A second *geographic* source next to TM.
- [ ] Venue-calendar adapters for the DIY tier: most indie venues run WordPress
  "The Events Calendar" (`/wp-json/tribe/events/v1/events`) or publish iCal. One
  generic adapter plus a per-venue registry reaches shows neither TM nor BIT
  lists. Respect robots/rate limits; per-venue kill switch.
- [ ] Keep the existing per-venue TM refresh for arena/club lineups.

### Phase 5 — observability and guardrails
- [ ] `ingest_runs` (source, started_at, scanned, inserted, updated, failed) plus
  an admin-token `/api/admin/stats`: per-source counts, per-cell freshness, top
  failures.
- [ ] Coverage check: events per metro per source per week, logged loudly when a
  source's yield hits zero — exactly the failure found by hand above.
- [ ] Sanity guards: drop events >2 years out or already past, cap events per
  artist per run, and keep the sitemap to canonical shows only.

Order matters: phase 2 before phase 3, or the crawl multiplies duplicates
instead of coverage.

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
