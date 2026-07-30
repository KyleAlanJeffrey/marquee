# Marquee — TODO

Local-first concert-discovery app. **Cloudflare stack:** Expo app → Cloudflare
Worker (Hono) → D1 (SQLite). Ticketmaster for concert data, Spotify for search.
Follows/prefs on-device (no account). Web → Pages; native → EAS.
Production: **https://marquee.rocks**.

## Status legend
- [ ] not started · [~] in progress · [x] done

---

## Done — a placeholder coordinate no longer places a venue (this pass)

- [x] Repair run on production: 1,067 venues clustered, 60 duplicate shows merged.
  The Chicago pile-up split correctly — The Salt Shed + The Salt Shed Outdoors are
  one venue, while Constellation, Huntington Bank Pavilion at Northerly Island and
  a festival title are each their own again.
- [x] The 16 remaining same-artist-same-day pairs in the SF feed are **not**
  clustering failures: each is two sources placing one show at different named
  venues kilometres apart (Dimmu Borgir at both The Warfield and Davies Symphony
  Hall). `sameVenue` is right to refuse those. Confirmed against Ticketmaster's
  live API that they answer with one point per town for any venue they have no
  address for — `37.779499,-122.419502` for *both* Golden Gate Park and Rickshaw
  Stop, which are 4 km and 300 m away from it.
- [x] **Head selection now weighs coordinates, not just names.** Every event in a
  cluster is repointed at the head, so the head's name is what the feed shows and
  its coordinates are the distance and the map pin — and nothing stopped a row
  sitting on a town's fallback point from winning. `isPlaceholderPoint` calls a
  coordinate untrustworthy when three *mutually unrelated* rooms are filed at it;
  names are grouped by shared distinguishing words first, so a complex that files
  its rooms at one point ("Salt Shed Indoors/Outdoors") stays one group, and tour
  titles are ignored because they vouch for nothing.
- [x] Measured on the live table (3,786 venues, 2,694 clusters): 51 rows sit on a
  genuine placeholder point, 31 clusters were headed by one, and the fix moves 2 of
  them — Golden Gate Park from Civic Center to the actual park, Showbox SoDo from a
  downtown default to its address. The other 29 are single-row clusters with no
  better member to pick; correcting those needs a geocoder, not a better choice.
  (An earlier count of 134 was a SQL overestimate — it counted tour titles and a
  venue's own name variants as unrelated rooms.)

### Known residuals

- An event filed against the wrong venue row before the matcher was fixed stays
  wrong: re-clustering repoints events at a cluster *head*, it never re-decides
  which venue an event belongs to. Three Outside Lands dates still sit on the
  Davies Symphony Hall row. A Ticketmaster re-sweep of those areas is what fixes
  them, not another repair pass.
- 29 venues are pinned at a source's town-wide default because that is the only
  row we have for them. Needs geocoding to fix.

## Done — follows for venues, saved shows (this pass)

- [x] **One on-device store, three collections.** `src/lib/local-collection.tsx`
  holds the hydrate-merge, the validate-on-read and the "don't resurrect what was
  removed before hydration" guard once; `follows-store`, `followed-venues-store`
  and `saved-shows-store` are thin wrappers over it with their own key, validator
  and match function. Validators are unit-tested (`src/lib/stores.test.ts`).
- [x] **Follow a venue** from its page; **save a show** from the top-right of the
  event page. The save control went there rather than in the sticky buy bar: at
  375 pt the bar already holds the artist line, the follow heart and the buy
  button, and a second mini button squeezed the artist name to "John…".
- [x] **Following** has an Artists/Venues switch (`src/components/segmented.tsx`).
  Artists keeps the avatar rail; Venues lists followed rooms with an unfollow
  heart.
- [x] **Following asks its own question** (`POST /api/following`). It used to
  filter the location feed, which is one bounded page of what's nearest in time
  inside a radius — around SF that page ends nine weeks out, so a followed artist
  playing in October wasn't in it and the screen said nobody you follow is
  playing. The route asks about the artists and rooms themselves, both lists in
  one request, each row tagged with which half it answers (the client can't tell —
  rows carry the canonical venue id, not the id the device stored). Follows are
  sent by catalog id *and* Spotify id, because an artist followed from search only
  ever has the latter.
- [x] **Still gated by the radius from Profile**, measured off the venue's
  displayed coordinates so the gate can't contradict the "12 mi" next to it. What
  the radius no longer bounds is *time*: the whole year inside it comes back
  rather than the first 400 rows of it. A show we can't place is out while a
  radius is in force. With no location there is no gate — the list loads whole,
  headed "COMING UP" instead of "WITHIN 50 MI", rather than showing nothing.
- [x] **Saved** is its own tab. Stored snapshots render instantly, then the
  server's rows replace them: `POST /api/events/by-ids` returns only shows still
  to come, soonest first, so nothing on the client has to decide what time it is.
  Anything the response omits has passed or been pulled, and is listed dimmed
  under "PAST OR NO LONGER LISTED" rather than silently dropped.
- [x] **Venues Near You** on the home page, from the new `/api/venues/nearby`
  (busiest first, one entry per canonical venue). The pin map above it is a map
  of *shows*, so it is now titled "Around You" instead of "Nearby Venues".
- [x] **One venue identity across the app.** A followed venue is only useful if
  the id on a feed card is the id on the venue page, so `nearbyEvents`,
  `eventsByIds` and `venueById` all report the canonical row, and
  `venueEvents` lists every show in the cluster — resolving through the head
  first, so a member id works as well as the head's.
- [x] Two nested-pressable bugs found in the browser and fixed: a button inside a
  button is invalid DOM on web and one of the two taps stops working
  (`VenueRow`, `SecondaryEventCard`). The follow button's glow also needed the
  pill radius, or web draws a square shadow behind a round button.

## Done — venue identity under placeholder coordinates (this pass)

Found while checking that `repair-duplicates` had actually cleaned production: the
San Francisco feed still showed 14 artist+day pairs twice, with wrong venue names
(Interpol and Dimmu Borgir at Davies Symphony Hall). Ticketmaster's own API returns
`Warfield` for that Interpol event — with Golden Gate Park's coordinates.

- [x] **City-centroid over-merge.** Ticketmaster stamps venues it has no address
  for with the city centroid, the same point for all of them; `sameVenue` joined
  anything within 50m without reading the name. Five SF rooms (Warfield, Golden
  Gate Park, Davies Symphony Hall, Golden Gate Theater, Rickshaw Stop) sat on
  37.779499,-122.419502 and became one venue. The same-spot rule now declines on a
  name conflict — both names carry a distinguishing word and share none. Measured
  by re-clustering the live 3,491-row table offline: clusters holding 3+ distinct
  real names **97 → 45**, and each SF row lands on its own room (Warfield → The
  Warfield 900m away, via the nested-name rule that the bad merge was pre-empting).
- [x] **Tour titles as venue names.** 653 Bandsintown rows are named after the tour
  ("Brunette World Tour", "BILMURI presents: The KINDA HARD Tour"), but carry the
  venue's real coordinates and usually sit right on the proper room. A tour title
  now yields no name tokens, so it can't conflict and the row still merges. Not
  discarded: that would strand the show with no location and drop it from "near me".
- [x] **Cluster head named the cluster.** The head was the smallest id, so a tour
  title could title a real arena's page — 129 clusters. The head now prefers a real
  name, id order only breaking ties, preserving the total ordering that stops a
  two-cycle. **129 → 7**, and those 7 have no real name available to promote.
- [x] **Stale representative broke show matching.** `findExistingShows` compared
  venue ids exactly, so a show stored against a row that *was* the representative
  before the cluster grew never matched its twin. It now matches anywhere in the
  cluster.
- [x] **`repairDuplicates` could not resume.** The event scan capped at 5,000
  ordered by (artist, venue, start) with no cursor, so "re-run to continue"
  re-scanned the same rows forever. Production has 6,832 upcoming events and a
  duplicated Tommy Newport pair ranked 1,370 and 5,542 — never in scope together.
  Returns `next_artist_id` now, cutting pages at artist boundaries; `?after=` on
  the route and `scripts/repair-duplicates.sh` to drive it to completion.
- [x] Also confirmed Ticketmaster lists some shows under two event ids (a plain
  listing and a TicketWeb one), which is why a same-source pair can duplicate.
- [ ] **Residual:** a town's own name still counts as distinguishing, so "Metro
  Chicago" / "Radius Chicago" can agree on "chicago". Accounts for most of the
  remaining 45. Fix is to drop tokens matching the venue's city.

## Done — production domain (this pass)

- [x] Bought `marquee.rocks`; the name stays Marquee, so there is no rebrand to
  do — `app.json` (`name`/`slug`/`scheme`) and every string in the UI are
  already right.
- [x] Confirmed **no code change is needed** for the domain. `injectSeo` takes
  `origin` from the request URL (`worker/src/seo.ts`), and `index.ts` passes
  `new URL(c.req.url).origin` into `robotsTxt`/`sitemapXml`/`pageSeo`, so
  canonical, `og:url`, `og:image`, robots and the sitemap all follow whichever
  hostname served the request. Verified against the live workers.dev deploy: a
  `/venue/:id` request came back with a canonical and `og:url` on that host, and
  `robots.txt` advertised the sitemap on it too. `+html.tsx`'s relative
  `og:url` placeholder is overwritten on every HTML response, because `pageSeo`
  returns a `noindex` default rather than null for unknown paths.
- [x] Docs and env point at the new origin: `.env.example`, README Deploying +
  Native sections, `wrangler.jsonc` header.
- [x] Custom-domain `routes` entry **staged commented-out** in `wrangler.jsonc`
  rather than enabled. Registry RDAP shows the domain registered 2026-07-29 with
  Cloudflare nameservers (`marge`/`clay.ns.cloudflare.com`) and those servers
  answer authoritatively, but the `.rocks` TLD servers had not published the
  delegation yet — and `wrangler deploy` errors on an inactive zone, which would
  fail the whole push-triggered build rather than just the domain.
- [ ] Attach the domain (dashboard or uncomment the route) once the zone reads
  Active, then re-check `robots.txt` on `marquee.rocks`.
- [ ] `database_name: "marquee"` stays as-is. It is not branding: `database_id`
  is pinned next to it, and renaming without that pin would bind a fresh empty
  database and orphan the stored events.

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
- [x] Resolution: `lookupKeys` tries `id_{bandsintown_id}` first (the only
  unambiguous key), then the stored `source_key`, their spelling, ours, then each
  without a leading "The"; whichever answers is stored as `source_key`. The negative cache is `state='not_found'` with a long sleep
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

- [x] **SeatGeek, measured against real responses.** `client_id` supplied, so the
  adapter was written against recorded payloads rather than guessed at. It joins
  `discover()` alongside Ticketmaster: both are geographic, and the six-hour
  per-area throttle covers the pair.

  What it added, on a live local run — **San Francisco, 25 miles**: 300 events
  scanned, **230 new shows**, 153 new artists, and **68 listings folded into
  Ticketmaster rows we already had** rather than duplicating them. 46 SeatGeek
  venues arrived and **31 were recognised as places already in the table**. Two
  further runs ingested 0 — idempotent. **Austin, 25 miles**: SeatGeek 162 new
  against Ticketmaster's 24, which is the coverage gap it was brought in for.
  `repair-duplicates` afterwards reported `shows_merged: 0` twice: ingestion
  caught everything at write time, so phases 2 and 3 did their job.

  Two fields it publishes that look like data and aren't, both found by looking
  rather than assuming:
  - `enddatetime_utc` — **ignored.** Across a recorded page, 45 of 49 events ended
    exactly 90 minutes after they started and the other 4 exactly 60. It's a
    template. Storing it would print a made-up end time on every show, and fill
    that field on Ticketmaster rows that are honestly empty.
  - `stats.lowest_price` — the cheapest *resale* listing, which is a different
    claim from Ticketmaster's minimum face value, so SeatGeek fills a price nobody
    else knows and never overwrites one. `0` means "no listings", not "free".

  Two it publishes that nothing else here does: a true UTC timestamp and the
  venue's IANA zone, so its times need no inference — it owns `starts_at` jointly
  with Ticketmaster and may correct a Bandsintown conversion.

  Support acts go to `lineup` (capped at 12 — Outside Lands bills 76) and become
  artist rows through the crawl's frontier expansion, at a rate D1's write quota
  can take, rather than 1,200 inserts inside one request.

  Also skipped: `time_tbd` events. SeatGeek fills an unannounced set time with
  03:30 local, and two San Francisco festival passes were stored "starting" at half
  three in the morning before this was caught. Because SeatGeek co-owns `starts_at`
  a placeholder could also overwrite a real Ticketmaster time. Letting these back
  in properly needs a `time_unknown` column and a card that renders a date without
  a clock — worth doing, not done here.

  **A known cap, stated rather than implied:** a sweep takes 3 pages × 100 events,
  soonest first, and a dense metro has ~600 concerts within 25 miles. So coverage
  is complete for the near term and lags for the far future; the window slides
  forward as earlier shows pass out of the `datetime_utc.gte=now` filter. Raising
  `SG_MAX_PAGES` costs subrequests in the same invocation as the Ticketmaster pass,
  so it should follow a look at real CPU/subrequest headroom, not a guess.
- [ ] Venue-calendar adapters for the DIY tier (WordPress "The Events Calendar"
  at `/wp-json/tribe/events/v1/events`, or iCal). Reaches shows neither TM nor
  BIT lists, but it means fetching from venues' own sites: needs a per-venue
  registry, robots/ToS review, rate limits and a kill switch. That's a subsystem
  and a judgement call about scraping third parties, not an afternoon's adapter.
- [ ] Keep the existing per-venue TM refresh for arena/club lineups.

### Phase 5 — observability and guardrails
- [x] `ingest_runs` (migration `0006`) — one row per pass with scanned/inserted/
  failed and a note, written by the crawl, the backfill, discover and the
  client-driven artist refresh. Recorded **even when a pass can't run**: "the
  crawl is misconfigured" and "the crawl isn't running" used to look identical
  from the event table. The logging never throws — losing the log must not take
  an ingest down with it.
- [x] `GET /api/admin/stats?days=` — runs per source and kind, what they
  produced, when each source last inserted anything, upcoming events per town per
  source, the last ten notes, and a `yielding_nothing` list that names any source
  whose runs keep succeeding while inserting nothing. That is the exact failure
  that hid Bandsintown for weeks, and now it says so.
- [x] Sanity guards in `persist()` (`sanitizeInputs`, tested): drop anything
  already past, further out than two years, or unparseable, and cap one artist at
  200 events per pass so a malformed feed can't flood the table.
- [x] The sitemap is canonical by construction now — one row per show since phase
  2, filtered to upcoming.

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

- [x] **Venue links: decided against a ratings API, with numbers.** The venue
  screen links out to directions, Google reviews, Yelp and the venue's own site
  (`src/lib/venue-links.ts`) — searches, not resolved records. Real ratings were
  costed and declined in July 2026:
  - **Yelp Fusion/Places** has no free tier any more: a 30-day, 5,000-call trial,
    then **$229/mo** (Base, no review excerpts), $299 (3 excerpts), $643
    (7 excerpts + review highlights). Its display requirements cap caching at
    **24 hours**, so 470 venues kept fresh is ~14k calls/month — a permanent
    paid plan just to stop the stars going stale.
  - **Google Places (New)** puts `rating`, `userRatingCount` *and* `websiteUri` on
    one Place Details **Enterprise** call: **1,000 free events/month**, then $20
    per 1,000, and caching allowed for **30 days**. So ~470 venues refreshed
    monthly fits inside the free cap. This is the option to take if ratings ever
    become worth a billing account — cheaper *and* broader than Yelp, which is
    the opposite of how it looks at first glance.
  - No **venue website** from any current source: Ticketmaster and SeatGeek return
    their own venue pages, Bandsintown has no field. OpenStreetMap was the free
    route and had no `website` tag for 2 of 4 venues checked (Great American Music
    Hall, Oakland Arena), with Overpass returning HTML error pages under light
    sequential use.
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

## Done — SEO pass (this pass)

- [x] `/concerts` — server-rendered landing page, ~1,040 words, no JS, no images.
- [x] `PRIMARY_HOST`: one canonical origin for every public URL; the workers.dev
  copy answers `X-Robots-Tag: noindex` and a `Disallow: /` robots.txt.
- [x] **City hub pages.** `/concerts/:town`, ~1,700 of them, one per town with an
  upcoming show. Each lists that town's next 120 shows by date (month rules, local
  door times), its venues, its acts, the towns within 180 miles, and an FAQ built
  from its own numbers. Slugs are `city-region` (`austin-tx`, `london-united-kingdom`)
  and resolved by generating slugs rather than parsing them, because a slug can't
  be split back into its parts reliably and slugifying is lossy about punctuation.
- [x] **Sitemap index.** Was one document capped at 5,000 per type, silently
  omitting 9,142 of 14,142 shows; now an index over paginated children — 21,590
  URLs. Venues listed by canonical id (drops 154 URLs that duplicated another by
  construction). Truncation is logged.
- [x] **Index hygiene.** Past events, artists with nothing booked and rooms with
  nothing booked are `noindex`. A non-head venue cluster member canonicals to its
  head.
- [x] **IndexNow.** The hourly crawl announces what it wrote. Off unless
  `INDEXNOW_KEY` is set; never fails the crawl.
- [x] **IndexNow was being refused, and said so quietly.** Every run came back 429
  "Too Many Requests (potential Spam)" — 102 URLs on one, 263 on the next — so
  nothing had ever reached Bing, Yandex, Seznam or Naver. Not volume: a one-off POST
  of 200 never-submitted event URLs, same host and key, was accepted with 200, and a
  single-URL POST seconds after a 429 with 202. The refused payloads re-sent `/` and
  every affected hub, 96 times a day. `indexnow_log` (migration 0007) now holds a
  listing page back for 24 hours after announcing it; event URLs are exempt because
  they're new by construction.
- [x] **Meta descriptions inside what a search result shows.** Bing's audit flagged
  one instance; production had six — `/` at 190 characters and every city hub over
  (Austin 169, Toronto 170, New York 171, LA 174, London 181). The event and venue
  templates were worse in a way the audit couldn't see, since they interpolate feed
  names that reach 195 and 90 characters. `clampDesc` (DESC_MAX 155) is enforced in
  `shell()` and `injectSeo()`, the two places any description is emitted, and the
  templates were tightened so the clamp is a backstop. `/map` and `/settings` were on
  the short side of the same check. Measured across 19 pages: all now 80–153.
- [x] **Server-rendered detail bodies** (`worker/src/detail.ts`). `/event/:id`,
  `/artist/:id` and `/venue/:id` had excellent heads and a body of nine words. Now
  the rows that built the metadata build the body too — the show plus the rest of
  that act's tour, the full tour-date list, the venue's calendar. 15–26 real links
  per page where there were none.
  The hydration blocker turned out not to be one: rewriting
  `__EXPO_ROUTER_HYDRATE__` to `false` on exactly these pages switches the bundle
  from `hydrateRoot` to `createRoot().render()`, which clears the container by
  design — so the injected markup hands over cleanly, and all that is given up is a
  spinner's worth of prerender. Verified in the browser: flag `false`, `#mq-sr`
  gone after boot, one child under `#root`, no console errors. App routes are
  untouched and still hydrate.
- [x] **The landing page is `/`.** It collects every inbound link and every share,
  and it was answering with the app's spinner. The app's feed is `/explore` now
  (`src/app/index.tsx` redirects, so native still launches into it), `/concerts`
  301s to `/`, the tab bar and the PWA `start_url` point at `/explore`, and the
  sitemap lists `/` at priority 1.0.
- [x] **One page per town, with all of its shows.** Towns are spelled several ways
  in the venue rows ("Montréal"/"Montreal", "United Kingdom"/"GB"); the hub pages
  were picking one row and dropping the others' shows — 61 of Montréal's 126. The
  spellings now fold into one town, and the losing slugs 301 to the winner.

## SEO follow-ups

- [ ] **Search Console + Bing Webmaster verification.** Manual, one-time, not
  something the repo can do. Worth more than any further on-page work.
- [ ] **Venue-name quality is title quality.** An event title reading
  "Davies Symphony Hall at Golden Gate Park" is two different places, and Google
  rewrites titles it judges inaccurate — losing the keyword. The two data-quality
  follow-ups below are SEO work now, not just correctness work.

## Data-quality follow-ups

- [ ] **Chained venue clusters.** "Three Links Deep Ellum" is clustered into "The
  Bomb Factory" — two genuinely different Dallas rooms. Individually their names
  conflict, so they can only have merged transitively through an intermediate
  row ("The Factory In Deep Ellum" / "The Studio at the Factory"). `sameVenue` is
  pairwise; clustering is not. Wants a check that a candidate agrees with the
  whole cluster, not just the row it was compared against.
- [ ] **`findExistingShows` scans the venues table per listing.**
  `worker/src/data.ts` matches shows with
  `venue_id in (select id from venues where coalesce(canonical_venue_id, id) = ?)`
  — the exact non-sargable form the read paths were changed away from, one
  statement per incoming show on the hot ingest path. Resolve cluster members
  once per distinct venue id (two indexed lookups, as `clusterVenueIds` does) and
  bind an `in (...)`.

## Known limitations (by design)

- No account; follows/prefs are per-device.
- Dark-only theme.
- D1/SQLite geo is bbox + haversine (fine at city radius; not true spherical
  indexing). Revisit if radii or data volume grow a lot.
- Native apps aren't hosted on Cloudflare — they ship via EAS/app stores and
  point at the deployed Worker.

_Design source: `stitch_marquee_concert_tracker/` (DESIGN.md + mockups)._
