# Marquee — TODO

Local-first concert-discovery app. **Cloudflare stack:** Expo app → Cloudflare
Worker (Hono) → D1 (SQLite). Ticketmaster + SeatGeek + Bandsintown for listings,
Spotify/Deezer/Wikipedia for artist detail. Follows/prefs on-device (no account).
Production: **https://marquee.rocks**.

## Status legend
- [ ] not started · [~] in progress · [x] done

Finished work isn't kept here — it's in the git log, where the reasoning sits next
to the diff that acted on it. This file is only what's left.

---

## Now — venue pages worth reading

Today a venue page is a name, a map and a list of dates. It should convey what the
room is actually like. Reference: `stitch_concert_compass/souls_of_mischief_venue_details/`.

- [ ] **Photos.** No current source publishes venue imagery — Ticketmaster and
  SeatGeek return their own venue pages, Bandsintown has no field. Options, in
  order of what they cost:
  - **Wikimedia Commons** by venue name + city — free, licence-clean, needs
    attribution, and will miss the whole club tier.
  - **Google Places Photos** — needs a billing account, but it's the same Place
    Details call already costed for ratings below, so one integration buys photos,
    ratings *and* the venue's own website.
  - **Artist photos from shows in that room** as a stand-in — free and already in
    the table, honest if labelled as such, but it isn't the room.
- [ ] **Description.** Wikipedia extract for rooms that have an article, via the
  same `worker/src/sources.ts` path the artist bio uses. Venue name + city is a
  much weaker key than an artist name, so this needs a disambiguation guard
  (a "The Fillmore" article about the neighbourhood is worse than no article).
  For everything else, compose from what the data already knows: how often it
  books, which genres actually play there, what's coming up.
- [ ] **Stats worth showing**, in the reference's oversized-numeral treatment:
  upcoming show count, distinct acts, busiest month, first and next show on
  record. All derivable from existing rows, no new source.
- [ ] Support acts at that venue, and a "similar rooms nearby" rail.

## Now — bugs

- [ ] **Artist and tour names are stored as venue names.** Measured on production:
  **7,340 venue rows, 1,054** carrying a colon, a "tour" and/or over 64
  characters — and **265 of those are cluster heads with upcoming shows**, which
  is what the app actually renders. Samples: "Horse Jumper of Love: playing their
  Self Titled Debut in its entirety", "Drops of Jupiter: 25 Years in the
  Atmosphere", "The Constellation Tour: Thee Sacred Souls, LA LOM & The Womack
  Sisters". Two separate problems behind it:
  1. **Ingestion accepts them.** `looksLikeTourName` (`worker/src/dedupe.ts`)
     already recognises these well enough to withhold name tokens from clustering,
     but nothing stops the string being written as the venue's name.
  2. **Only the server pages filter them.** `realVenueName` (`worker/src/page.ts`)
     rejects a name containing the act's own name, a colon, or over 64 characters
     — but it's display-only, and the app's venue list and venue screen don't use
     it. The same row therefore looks clean on a hub page and wrong in the app.
  The fix wants to be at ingestion (prefer the real venue when a feed puts the
  tour title in the venue column), with the display guard kept as a backstop for
  rows already written, plus a repair pass over the 265.
- [ ] **A town's own name still counts as distinguishing**, so "Metro Chicago" and
  "Radius Chicago" agree on "chicago" and can merge. Fix is to drop name tokens
  matching the venue's city. Accounts for most of the ~45 remaining clusters that
  hold 3+ distinct real names.
- [ ] **Chained venue clusters.** "Three Links Deep Ellum" is clustered into "The
  Bomb Factory" — two genuinely different Dallas rooms. Individually their names
  conflict, so they can only have merged transitively through an intermediate row
  ("The Factory In Deep Ellum" / "The Studio at the Factory"). `sameVenue` is
  pairwise; clustering is not. Wants a check that a candidate agrees with the
  whole cluster, not just the row it was compared against.
- [ ] **`findExistingShows` scans the venues table per listing.**
  `worker/src/data.ts` matches shows with
  `venue_id in (select id from venues where coalesce(canonical_venue_id, id) = ?)`
  — the exact non-sargable form the read paths were moved away from, one statement
  per incoming show on the hot ingest path. Resolve cluster members once per
  distinct venue id (two indexed lookups, as `clusterVenueIds` does) and bind an
  `in (...)`.

## Next — split the website from the app

One Expo bundle serves both audiences today, and they want opposite things: a
visitor from search wants a page that renders without JavaScript and tells them
what's on; a returning user wants the app. `/` is already a real server-rendered
landing page and the ~1,700 city hubs already prove the pattern — this extends
that to the whole public surface and lets the app stop pretending to be a website.

- [ ] **Decide the boundary and write it down before implementing.** Which URLs are
  web pages (server-rendered, indexable, no app shell) and which are app routes.
  Candidate split: `/`, `/concerts/:town`, `/event/:id`, `/artist/:id`,
  `/venue/:id` and browse-by-town become web; `/explore`, `/following`, `/saved`,
  `/map` and `/settings` stay app. This decides everything below, so it isn't a
  detail to settle while coding.
- [ ] **Give the server pages a desktop layout.** The reference
  (`souls_of_mischief_venue_details/`) is a desktop page, not a phone screen:
  masthead with real nav, full-bleed hero, two-column body, footer with columns.
  `worker/src/page.ts` renders one narrow column because it grew out of a
  mobile-first landing page.
- [ ] **Detail pages become real documents.** `worker/src/detail.ts` injects markup
  into the app shell and then rewrites `__EXPO_ROUTER_HYDRATE__` to stop the
  bundle clearing it. If these are web pages they should be their own documents
  via `shell()`, like the hubs are — which removes that trick entirely.
- [ ] **App Store build.** EAS build + submit for iOS and Android. Needs bundle
  identifiers, store listings, screenshots, an `expo-updates` channel decision,
  and the privacy declarations — which are short and worth stating plainly, since
  the app collects nothing.
- [ ] **Then the website advertises the app** instead of being it: store badges on
  `/`, and a smart banner on the web pages rather than "Open the app" pointing at
  a bundle the visitor is already inside.
- [ ] **Keep one palette.** `src/constants/theme.ts` and the `:root` block in
  `worker/src/page.ts` hold the same values twice and have already drifted once.
  Generate the CSS variables from the TS tokens, or the two surfaces will diverge
  exactly when they're meant to look related.

## Event coverage — remaining phases

Order still matters: canonical shows/venues before any crawl widening, or the
crawl multiplies duplicates instead of coverage.

- [ ] **Watch the first production crawl runs for CPU/subrequest limits** (the free
  plan is tight) and raise `CRAWL_BATCH` if there's headroom. The same look
  decides whether `SG_MAX_PAGES` can go past 3 — a sweep is 3 pages × 100 events
  soonest-first while a dense metro has ~600 concerts within 25 miles, so SeatGeek
  coverage is complete near-term and lags for the far future.
- [ ] **`time_unknown` column.** SeatGeek fills an unannounced set time with 03:30
  local, so `time_tbd` events are skipped entirely — two SF festival passes were
  stored "starting" at half three before it was caught. Because SeatGeek co-owns
  `starts_at`, a placeholder could also overwrite a real Ticketmaster time.
  Letting them in properly needs the column plus a card that renders a date with
  no clock.
- [ ] **Venue-calendar adapters for the DIY tier** (WordPress "The Events Calendar"
  at `/wp-json/tribe/events/v1/events`, or iCal). Reaches shows neither
  Ticketmaster nor Bandsintown lists, but it means fetching from venues' own
  sites: needs a per-venue registry, robots/ToS review, rate limits and a kill
  switch. That's a subsystem and a judgement call about scraping third parties,
  not an afternoon's adapter.
- [ ] Keep the existing per-venue Ticketmaster refresh for arena/club lineups.
- [ ] **Scheduled discovery for launch cities** (optional): a Cron Trigger that
  sweeps a fixed city list so feeds are warm before the first visitor.

## Later — ticketing & enrichment

- [ ] **StubHub Partner API** (Partnerize). Today the event page's StubHub option
  is a **search deep link** (`stubhub.com/explore?q=artist+city`) — there's no
  open listings API without an affiliate account. With Partner creds, swap it for
  real per-event listings and prices.
- [ ] **More resale sources**: SeatGeek / Vivid Seats alongside StubHub in the
  event "Get Tickets" section (same `ticketSources()` pattern in
  `src/lib/tickets.ts`).
- [ ] **Venue ratings, if they ever earn a billing account.** Costed and declined
  in July 2026, and the conclusion is the opposite of how it first looks.
  **Google Places (New)** puts `rating`, `userRatingCount` *and* `websiteUri` on
  one Place Details Enterprise call: 1,000 free events/month, then $20 per 1,000,
  caching allowed for 30 days — so ~470 venues refreshed monthly fits the free
  cap. **Yelp Fusion** has no free tier any more ($229/mo minimum, no review
  excerpts) and its display rules cap caching at 24 hours, which is ~14k
  calls/month just to stop the stars going stale. Google is both cheaper and
  broader. Ties into venue photos + descriptions above.
- [ ] **Spotify extended quota** (optional — routed around via Deezer/Wikipedia):
  the app is in development mode, so `/artists/:id` comes back stripped (no
  genres/popularity) and `top-tracks` is 403.
- [ ] **In-app track previews**: Deezer top tracks carry a 30s `preview_url`
  (`ArtistTrack.preview_url`) — wire an audio player (expo-av) so tapping a track
  plays the preview instead of opening the link.
- [ ] Fan/artist galleries from real images; support acts from same-venue events;
  ticket price on the event Buy bar.

## Operational — not fixable in this repo

- [ ] **Rotate `ADMIN_TOKEN` and the Ticketmaster key.** Both were pasted into
  chat. `npx wrangler secret put ADMIN_TOKEN` /
  `wrangler secret put TICKETMASTER_API_KEY`, then update root `.dev.vars`.
- [ ] **Search Console + Bing Webmaster verification.** Manual, one-time, and
  worth more than any further on-page SEO work. Note that **venue-name quality is
  title quality**: a title reading "Davies Symphony Hall at Golden Gate Park"
  names two different places, and Google rewrites titles it judges inaccurate —
  losing the keyword. The venue bugs above are SEO work, not just correctness.
- [ ] **IndexNow's 429 is about where the request comes from, not what's in it.**
  Measured: from a laptop, `/` alone, three hubs announced ~96×/day for days, and
  a reconstruction of the cron's exact 154-URL payload all returned 200 — minutes
  after the Worker's own 153-URL payload was refused. Every CLI request succeeded,
  every Worker request failed, which leaves a per-IP limit on Cloudflare's shared
  Worker egress addresses. Next: Bing's authenticated URL Submission API (per-site
  quota, not per-IP), or accept that Bing discovery comes via the sitemap. The 24h
  listing throttle stays either way — it's correct behaviour, just not a remedy
  for this.
- [ ] **`EXPO_PUBLIC_MAPBOX_TOKEN` in Workers Builds.** A public `pk.*` token as a
  build-time env var for prod (Expo inlines `EXPO_PUBLIC_*` at build time). Local
  dev reads it from `.env`.
- [ ] **A Bandsintown app_id issued to this project.** Only a couple of `app_id`
  values answer and they aren't ours, so production shouldn't lean on one. README
  has both request paths.

## Known residuals (fixable, but not by another repair pass)

- **An event filed against the wrong venue row before the matcher was fixed stays
  wrong.** Re-clustering repoints events at a cluster *head*; it never re-decides
  which venue an event belongs to. Three Outside Lands dates still sit on the
  Davies Symphony Hall row. A Ticketmaster re-sweep of those areas fixes them.
- **29 venues are pinned at a source's town-wide default** because that's the only
  row we have for them. Ticketmaster answers with one point per town for any venue
  it has no address for — `37.779499,-122.419502` for *both* Golden Gate Park and
  Rickshaw Stop, 4 km and 300 m away from it. Needs a geocoder, not a better
  choice among existing rows.

## Known limitations (by design)

- No account; follows/prefs are per-device. This is the product's positioning, not
  a gap — "no account needed" is the tagline on `/` and in the manifest.
- Dark-only theme.
- D1/SQLite geo is bbox + haversine (fine at city radius; not true spherical
  indexing). Revisit if radii or data volume grow a lot.
- Native apps aren't hosted on Cloudflare — they ship via EAS/app stores and
  point at the deployed Worker.
- **Bandsintown has no geographic search.** `/artists/{name}/events` works;
  `/events/search?location=`, `/venues/{id}/events` and `mbid_` lookups are
  403/error without a partner key. Coverage therefore scales with how many artists
  we know, not how many places we sweep — which is why the artist frontier crawl
  exists.
- **Name resolution is fragile in both directions.** Ticketmaster attraction
  matching is exact-name-only; Bandsintown is name-keyed (`MJ Lenderman` → `0`,
  `MJ Lenderman and the Wind` → NotFound), and an empty answer is
  indistinguishable from an unknown artist.
- **`database_name: "marquee"` stays as-is.** Not branding: `database_id` is
  pinned next to it, and renaming without that pin would bind a fresh empty
  database and orphan the stored events.

_Design source: `stitch_concert_compass/` — `electric_stage/DESIGN.md` is
authoritative for tokens; the screen directories are references, and where they
disagree with the spec, the spec wins._
