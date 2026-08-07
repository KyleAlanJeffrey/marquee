# Performance audit — 2026-08-07

Everything here was measured against production (D1 `marquee`, `3905e807-…`, and
the live site) on 2026-08-07. Numbers are quoted, not estimated.

## Scale

| | rows |
|---|---|
| events | 59,639 (51,295 upcoming) |
| venues | 21,504 |
| artists | 9,396 |
| reviews | 10 |
| event_rsvps | 19 |
| users | 7 |

D1 file size 61.9 MB. The catalogue is real; the social tables are empty. That
matters for ranking the findings — anything whose cost scales with `reviews` or
`event_rsvps` is theoretical today, and anything that scales with `events` is
being paid right now.

## The network floor

A static asset (`/favicon.ico`, `cf-cache-status: HIT`) answers in **0.31s**, and
`/api/` — a 404 that touches no database — answers in **0.293s**. That is the
client→edge round trip from this machine. Every number below should be read as
"floor + work".

| request | TTFB | over floor |
|---|---|---|
| `GET /api/events/:id` | 0.399s | +0.11s |
| `GET /api/activity` | 0.374s | +0.08s |
| `GET /api/events/:id/reviews` | 0.379s | +0.09s |
| `GET /api/events/:id/rsvps` | 0.678s | +0.39s |
| `GET /api/towns?q=aus` | 0.68–0.80s | +0.4–0.5s |
| `POST /api/nearby` (50mi, 400) | 1.19–1.31s | +0.9–1.0s |
| `GET /event/:id` (HTML) | 0.51s | |
| `GET /concerts/new-york-ny` | 2.09–2.24s | |
| `GET /` (landing) | 1.93s first, 2.39–3.32s after | |

---

## 1. `ANALYZE` has never been run, and it is costing 34× on the hottest query

`sqlite_stat1` does not exist in production. Without it SQLite guesses index
selectivity, and on `/api/nearby` it guesses wrong.

The same count, same answer, two join orders:

| plan | rows read | SQL time |
|---|---|---|
| planner's choice (drives from `events_starts_at_idx`) | **93,049** | **277.1 ms** |
| forced venues-first (`CROSS JOIN` pins the outer loop) | **6,625** | **8.1 ms** |

The trigger is the 120-day cap at [data.ts:251](worker/src/data.ts:251). Without
it the planner picks the geo index and reads 6,625 rows in 14ms; adding the
range predicate on `starts_at` flips it to the date index and it reads 93,049.
A filter that removes rows makes the query 19× slower.

Full production shape of `nearbyEvents`, both statements, measured faithfully
(artists join, `rsvpCounts` in the select, canon join, the notability ORDER BY):

| statement | rows read | SQL time |
|---|---|---|
| row query, `limit 400`, `sort=featured` | 101,253 | 368.9 ms |
| `total` query ([data.ts:315](worker/src/data.ts:315)) | 95,753 | 263.9 ms |
| **per request** | **197,006** | **632.8 ms** |

That is essentially the whole ~0.9s that `/api/nearby` spends above the floor.

**The limit is not the problem.** Payload scales, latency barely does:

| limit | TTFB | bytes |
|---|---|---|
| 1 | 1.035s | 864 |
| 20 | 1.050s | 17,170 |
| 100 | 1.110s | 85,541 |
| 400 | 1.248s | 339,379 |

One row costs 1.03s. The `featured` sort and the `total` count both run over the
full 2,704-row candidate set before `LIMIT` applies, so asking for less doesn't
buy anything.

Things I checked that are *not* the cause, so nobody re-litigates them:

- The `canon` self-join through `coalesce` — removing it entirely still reads
  93,049 rows. It's an index seek on the PK; it costs ~2,700 rows.
- The `or(canon.lat is null, …)` clause at [data.ts:261](worker/src/data.ts:261) —
  the AND form, the coalesce form and the OR form all read exactly 95,753.
- `withinMilesSql` being non-sargable. True, but the bbox prefilter handles it
  fine *when the planner uses it*.

**Fix:** run `ANALYZE` (D1 persists `sqlite_stat1`), re-run it after large
ingests. If the plan doesn't flip, pin it — venues-first subquery or `CROSS
JOIN`. This is the highest value-per-minute change available.

## 2. `/api/nearby` runs the same join twice, serially

[data.ts:315-321](worker/src/data.ts:315) re-executes the identical `where`
— both distance expressions, both joins — only to produce `total`. It is not
`Promise.all`'d with the row query, so it is additive latency: **95,753 rows and
264ms on every page, including offset pages where the client already has the
total.**

**Fix:** `total: sql\`count(*) over ()\`` in the row select. One pass, same
number, one fewer round trip.

## 3. The cron scans the entire events table once per incoming listing

[`findExistingShows`, data.ts:1650](worker/src/data.ts:1650) ORs an indexed
lookup with `json_extract(sources, …)`. SQLite's OR optimisation needs *every*
arm indexable; one function-on-column arm poisons the disjunction.

| form | rows read | SQL time |
|---|---|---|
| current `OR` form | **59,639** (the whole table) | 59.7 ms |
| indexed arm alone | **0** | 0.28 ms |

`persist` calls this once per listing, `MAX_EVENTS_PER_ARTIST = 200`,
`CRAWL_BATCH = 8` artists per tick, every 15 minutes — on the order of hundreds
of full table scans of `events` per tick. Both `wrangler.jsonc` and
`wrangler.jobs.jsonc` bind the same `database_id`, so the Worker split isolates
CPU and subrequests but not this.

**Fix:** try the two indexed arms first; fall back to the `json_extract` arm only
for listings the first two missed. Cross-source re-matching is the rare case and
is currently charging the common case for it.

## 4. Server-rendered HTML is not cached at the edge at all

[index.ts:137](worker/src/index.ts:137) sets
`public, max-age=300, s-maxage=1800, stale-while-revalidate=86400` on `/`,
`/privacy` and `/concerts/:slug`.

Measured: `/` and `/concerts/new-york-ny` come back with **no `cf-cache-status`
header at all**, while `/favicon.ico` returns `HIT`. Grep confirms **zero** uses
of `caches.default`, `caches.open` or `ctx.waitUntil` anywhere in `worker/src`,
no KV binding, and no Smart Placement in either wrangler config.

Cloudflare does not cache `text/html` from a Worker by default. `s-maxage` is
advice to a cache that isn't running, so every hit pays full price: landing 5 D1
queries at 1.93–3.32s, city hub 4 queries at 2.09–2.24s.

**This is the biggest lever for the SEO/page-load goal**, and it is a
configuration change, not an architecture change.

## 5. `allTowns` is the heaviest query on the site, and it blocks city pages

`GROUP BY lower(city), lower(region), lower(country)` over the whole
`events ⋈ venues` join. No index can serve grouping on `lower(city)`.

Measured: **158,625 rows read, 383.3 ms**, 4,000 towns returned.

It runs *serially before* the other three queries in `cityPage`
([cities.ts:717](worker/src/cities.ts:717)), again on the landing page
([landing.ts:169](worker/src/landing.ts:169)), in `pagesSitemap`
([seo.ts:239](worker/src/seo.ts:239)), and on every `/api/towns` call — which is
the 0.68–0.80s measured above.

Its result is identical for every visitor and changes only when the crawl
writes. Same fix as #4.

## 6. Missing index `events(venue_id, starts_at)`

Confirmed present in production: `events_starts_at_idx`, `events_artist_idx`,
`events_dedupe_idx (venue_id, artist_id, starts_at)`. Every venue-scoped read
filters `venue_id AND starts_at`, and `artist_id` sits between them, so only the
`venue_id` prefix is usable.

Measured cost today is small — the busiest venue (251 events) reads 252 rows for
215 results, 0.25ms. Real, worth adding, not urgent. It becomes important once
#1 makes venues-driven plans the norm.

## 7. Client: one 3.17 MB bundle, and nothing paints until the fonts land

- `entry-*.js` is **3,169,267 B raw / 775,681 B gzip**, and every exported HTML
  references the same file — no route splitting. `cf-cache-status: HIT`, but
  `cache-control: public, max-age=0, must-revalidate` on a **content-hashed**
  filename, so every load pays a revalidation round trip for nothing.
- [_layout.tsx:79](src/app/_layout.tsx:79) gates the entire navigator on
  `fontsLoaded`, rendering a bare charcoal `View` until six Anybody TTFs
  (~395 KB) finish — after the 776 KB bundle parses. Ionicons adds 390 KB.
- Metro exported all 18 Anybody weights (1.19 MB); 12 are never requested,
  because the weights are imported from the package barrel.
- `expo-notifications` ships to web and runs
  `setNotificationHandler` at module scope, though every entry point
  early-returns on web. A `notifications.web.ts` stub — the pattern
  `map.web.tsx` and `page-meta.web.tsx` already use — drops it from the graph.

## 8. Explore blocks on GPS, then fetches 400 rows to draw three cards

[explore.tsx:49](src/app/(tabs)/explore.tsx:49) awaits
`getCurrentPositionAsync` with no timeout, no `maximumAge` and no last-known
fallback; both queries are `enabled: coords != null`, and the screen shows a
spinner for the whole duration. Then:

- `limit: 400` at [queries.ts:56](src/hooks/queries.ts:56) — 339 KB to render one
  featured card, two secondary cards and a horizontal rail.
- The radius flips mid-flight: `prefs-store` falls back to 50 while `/me` is in
  flight, so a user whose stored radius is 25 fires two full 400-row queries.
- `discoverEvents` invalidates `['nearby-events']` on success — a third.

## 9. Waterfalls

- [person-profile.tsx:260](src/components/person-profile.tsx:260) gates three
  queries on `profile.isSuccess`, though all three take only `profileKey`.
  Two full round trips before the profile body appears. Deleting the gate is the
  whole fix.
- Detail screens (`event`, `venue`, `artist`) early-return on the shell query, so
  child queries (`useEventRsvps`, `useEventReviews`) don't start until it
  resolves — a second wave one RTT late.
- [api.ts:76](src/lib/api.ts:76) awaits a Clerk token before every
  non-`anonymous` fetch, so the public catalogue is serialized behind a
  third-party script load, for signed-out visitors too. The public reads
  (`useEvent`, `useArtist`, `useVenue`, …) should be `{ anonymous: true }`.
- `GET /api/users/:key` makes 6 sequential round trips where only the first is a
  dependency ([people.ts:132](worker/src/routes/people.ts:132)).

## 10. The SSR work is thrown away on hydration

`worker/src/seo.ts` already has the event row in hand when it builds the JSON-LD
— name, date, venue. The client then fetches `/api/events/:id` for the same
three fields. Emitting the row a second time as
`<script id="__MARQUEE_DATA__" type="application/json">` and seeding the query
cache before first render would make detail pages paint with **zero** client
round trips, which also sidesteps #9 for the most-linked routes.

## 11. Smaller, cheap

- `cors()` at [index.ts:26](worker/src/index.ts:26) sets no `maxAge`. The hot
  reads (`/nearby`, `/following`, `/venues/nearby`, `/events/by-ids`) are all
  POST with JSON bodies, so they always preflight. `cors({ maxAge: 86400 })` is
  a one-line win.
- No `Cache-Control` on any `/api/*` response, though `/api/towns`,
  `/api/artists/:id`, `/api/venues/:id` and `/api/events/:id` are public and
  slow-changing.
- `GET /api/artists/:id/events` has **no LIMIT** at all.
- `GET /api/users/search`: full `users` scan with a joined correlated aggregate
  per row, and the LIKE pair evaluated twice per row. Empty table today.
- `GET /api/events/:id/reviews` re-emits the `likeCount` subquery in `ORDER BY`
  instead of referencing the alias, so it is computed twice per row; `mine` is a
  fourth serial query that could be `Promise.all`'d.
- Serial chunk loops that are independent and `Promise.all`-able:
  [data.ts:492](worker/src/data.ts:492), [data.ts:688](worker/src/data.ts:688).
- Unwindowed `.map()` over paginated data inside `ScrollView`:
  [activity.tsx:94](src/app/(tabs)/activity.tsx:94) is the live one — every
  "SHOW OLDER" press re-renders the whole accumulated list.

## On splitting the app from the website

The measurements don't support doing this first. The landing and city pages are
already server-rendered HTML that never needs the app bundle, and their 2–3s
TTFB is uncached D1 work (#4, #5), not React. Splitting would genuinely help —
the marketing/SEO surface could drop the 776 KB bundle outright — but it is an
architecture change competing with a configuration change that fixes the same
number today.

Suggested order: #1 and #2 (hours, no structural change), then #4 and #5
(caching, same fix), then #3 (stops the cron poisoning read latency), then
revisit the split with clean numbers.

## Order of work

Ticked as each one lands, with the measured after-number next to it so the
claim and the evidence stay together. Started 2026-08-07.

### Pass 1 — the database (items 1, 2, 10) — **landed 2026-08-07**

- [x] **1. `ANALYZE`.** Ran on production (197ms, 47 rows of stats). **The plan
  flipped on its own** — nothing pinned, no query rewritten: 93,049 rows /
  277ms → **6,634 rows / 6.5ms** on the same predicate, a 14× drop in rows read
  and 42× in SQL time. Migration `0022` carries it for fresh databases, and the
  jobs cron re-runs it daily at 09:00 UTC so stats can't drift behind the crawl.
- [x] **2. `count(*) over ()`** replaces the second full-join query
  ([data.ts](worker/src/data.ts)). Removes 95,753 rows and a serial round trip
  per request. Verified the artists join is count-neutral first (2,709 either
  way; zero null and zero orphaned `artist_id`), and kept the old count as a
  fallback for the one case a window function can't answer — an empty page at
  `offset > 0`, where there's no row to read it off.
- [x] **10. `events(venue_id, starts_at)`** index — migration `0022`.

**Measured end to end on production**, against the 0.281s network floor:

| | before | after | server-side work |
|---|---|---|---|
| `POST /api/nearby` limit 400 | 1.19–1.31s | **0.57–0.86s** | −47% |
| `POST /api/nearby` limit 1 | 1.035s | **0.40–0.51s** | 755ms → 120ms, **−84%** |

Correctness re-checked on the live endpoint after deploy: `total` matches D1,
`total_count` doesn't leak into items (22 fields, as before), paging is intact,
and both empty-page paths — past the end at `offset 9000`, and an empty radius
at `offset 0` — return the right totals.

### Pass 2 — edge caching (items 3, 5) — **landed 2026-08-07**

- [x] **3. Cache API** on `/`, `/privacy`, `/concerts/:slug`
  ([index.ts](worker/src/index.ts)). The cache is checked *before* the renderer
  runs, so a hit on a city page skips all four D1 queries including the
  158,625-row `allTowns`. `cf-cache-status: HIT` now appears on these pages,
  where before there was no such header at all.
- [x] **5. `cors({ maxAge: 86400 })`** — verified live:
  `access-control-max-age: 86400` on an `OPTIONS /api/nearby` preflight.

| | before | cold (MISS) | warm (HIT) |
|---|---|---|---|
| `/` | 1.93–3.32s | 2.64s | **0.39–0.55s** |
| `/concerts/new-york-ny` | 2.09–2.24s | 2.04–2.12s | **0.28–0.46s** |
| `/privacy` | 0.30s | 0.30s | 0.38s (no D1 either way) |

Verified after deploy: cached bodies are byte-identical across hits (42,538 and
79,292 bytes, matching the pre-change measurements), canonicals and `<h1>` are
intact, a bogus slug still 404s and is *not* stored, `/concerts` still 301s, and
event deep links still get their two JSON-LD blocks injected.

Two deliberate choices worth knowing:

- **The key drops the query string.** None of these three pages reads one, so
  keying on the full URL would mint a fresh entry per `?utm_source=…` and miss
  on all of them.
- **Off-brand hosts bypass entirely.** The `*.workers.dev` copy writes different
  canonicals and carries a `noindex` stamp, so sharing entries with the real
  domain would leak one into the other in whichever direction raced first.

Not done here: purging on ingest. A new show can take up to `s-maxage` (30 min)
to appear on `/` or a city page. That is what the header always claimed, and
IndexNow still pings the crawler immediately.

### Pass 3 — the crawl (item 4)

- [ ] **4. Split the `json_extract` OR arm** in `findExistingShows`. Baseline:
  59,639 rows scanned per call vs 0 for the indexed arm alone, hundreds of
  times per 15-minute tick. — [data.ts:1650](worker/src/data.ts:1650)

### Pass 4 — the client (items 6–9)

- [ ] **6. `immutable` on hashed assets; drop the font gate.** Baselines:
  776 KB gzip bundle at `max-age=0, must-revalidate`; nothing paints until
  ~395 KB of TTFs land. — wrangler + [_layout.tsx:79](src/app/_layout.tsx:79)
- [ ] **7. Explore: last-known coords, `limit` 40, gate on prefs.** Baseline:
  blocks on GPS, then 339 KB to draw three cards, twice. —
  [explore.tsx](src/app/(tabs)/explore.tsx)
- [ ] **8. Delete the `profile.isSuccess` gate** — three queries waiting on a
  fourth they don't need. —
  [person-profile.tsx:260](src/components/person-profile.tsx:260)
- [ ] **9. `anonymous: true` on public catalogue reads** — stops the public
  catalogue serializing behind a Clerk token. —
  [queries.ts](src/hooks/queries.ts)
