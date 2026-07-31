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

**Wikipedia is viable for both prose and a photo, but only behind a guard — and
that was measured, not assumed.** Sampled 22 real venue rows against the REST
summary endpoint: 14 direct title hits, 6 rescued by a search fallback, 2 with no
article. The failures were the dangerous kind, confidently wrong rather than
absent: "Blue Note" (NYC) returned **Blue Note Records**, the record label;
"Riviera" (Burgos) returned an article about the Italian word for coastline;
"Mohawk" (Austin) returned "Music of Austin, Texas"; "Grenswerk" and "Prescott
Park" both returned their *town's* article. Printing any of those as a venue
description is worse than printing nothing.

Two guards fix it, and together they were exactly right on the sample — **14 kept,
all correct; 5 dropped, all correctly dropped**:

1. **The article must carry coordinates within ~25 km of the venue.** This is what
   kills the label, the dictionary word and the city-music article: none of them
   are places, so none have coordinates. The radius is deliberately generous
   because *our* coordinate is sometimes a source's town centroid — Red Rocks sits
   7.6 km from its own article, and that's our error, not Wikipedia's.
2. **The article title must share a distinguishing word with the venue name.** This
   is what kills the town articles, which do have coordinates and are genuinely
   nearby: "Portsmouth, New Hampshire" shares nothing with "Prescott Park".

- [ ] **Description** from the Wikipedia extract behind those two guards, plus a
  minimum length so a one-line stub doesn't become a "description" ("The Showbox"
  returns 109 characters). CC BY-SA, so it keeps the "via Wikipedia" attribution
  the artist bio already uses. Cache it on the venue row — this is 2 subrequests
  and must not run per page view.
- [ ] **Photo** from the same article's lead image. Checked the licence on 13 of
  them and **all 13 were free** — CC BY, CC BY-SA or public domain — but every one
  of those requires **attribution**, so the photographer and licence have to render
  with the image. That's one more API call (`prop=imageinfo&iiprop=extmetadata`)
  and it is not optional: a non-free logo would otherwise get republished as a
  hero. 18 of 21 articles had a lead image.
- [ ] **Known soft spot:** "Showbox SoDo" keeps the article for "The Showbox", a
  different room 2.3 km away run by the same operator. Both guards pass. Needs a
  rule about differently-named sibling rooms, or accept it.
- [ ] **For everything without an article** — which is the whole club tier, and the
  two misses in the sample were both small European rooms — compose from what the
  data already knows: how often it books, which genres actually play there, what's
  coming up. This is the only path that covers every venue, so it should be built
  first and Wikipedia should be the enrichment on top.
- [ ] **Google Places** stays the paid alternative: one Place Details call buys
  photos, ratings *and* the venue's own website (see the costing further down).
  Worth it only if a billing account is ever justified.
- [ ] **Stats worth showing**, in the reference's oversized-numeral treatment:
  upcoming show count, distinct acts, busiest month, first and next show on
  record. All derivable from existing rows, no new source.
- [ ] Support acts at that venue, and a "similar rooms nearby" rail.

## Now — bugs

- [~] **Artist and tour names stored as venue names — fixed on display, not at the
  source.** Handled in `195912b`: `looksLikeEventTitle` nulls the name wherever one
  leaves the Worker, and drops the row where a venue is the subject rather than a
  detail (the nearby rail, the city hub's venue list, which also fed the hub FAQ).
  Measured first, because it decided the approach: 7,340 venue rows, 1,054 carrying
  an event title, 283 of them cluster heads with upcoming shows — and **240 of
  those 283 are alone in their cluster**, so there is no correct name in the table
  to promote and no repair pass that could recover one. What's left:
  - [ ] **Ingestion still writes them.** Nothing rejects the string on the way in,
    so the count grows. The real fix is per-source: when a feed puts the tour title
    in the venue column, find the venue it actually means.
  - [ ] **A dash-separated billing is not caught** and deliberately so —
    "PROGRESSIVE HOUSE NEVER DIED - Seattle" reads exactly like "The Eastern-GA" to
    a string rule. Pinned as a known miss in `dedupe.test.ts`; wants a source-side
    fix, not a blunter regex.
  - [ ] **A name we can't publish is a room we can't name.** 240 venues now render
    as their town. Reverse-geocoding the coordinates is the only route to a real
    name, and it's the same missing capability as the 29 placeholder-pinned rows.
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

## Pivot — concerts you've been to, and what you thought

The direction: log the shows you've been to, rate them, and let other people
review the same show, artist and room. Goodreads for concerts and bands. This is
additive to discovery, not a replacement — the reason to open Marquee becomes
"what did I see, and what was it like" as well as "what's on".

This section is a writeup, not a plan that's been started. Nothing below is built.

### The positioning problem, first

"No account needed" is not a nice-to-have here: it's the tagline on `/`, the
description in `manifest.json`, and the thing that was explicitly asked for when
the design language was set. Reviews need durable identity, so this is in genuine
tension with it — and the resolution has to be a decision, not a drift.

The one that keeps both: **an account is only ever needed to publish.** Everything
that works today keeps working with no account — browsing, following, saving,
reminders, and *privately* logging and rating what you went to, all still
on-device. Signing in is what lets your review carry your name and be seen by
somebody else. The tagline becomes "no account needed to browse", which is still
true and still unusual, and signing up becomes a deliberate upgrade with an
obvious reason rather than a toll gate on the front door.

That framing also decides the build order below: the whole first phase ships
without any auth at all.

### The blocker nobody would guess: there is no past

`sanitizeInputs` (`worker/src/data.ts`) drops any listing more than 24 hours old
on the way in, and the comment says why — "one already past is dead weight in a
table whose reads are all 'upcoming'". That was correct for a discovery app and it
is fatal for this one. Measured on production today: **17,742 upcoming events, 627
past ones, and the earliest is 2026-07-12** — about two and a half weeks of
history, and only because those rows aged out after being ingested while still
upcoming. Nothing deletes them, so history accumulates from here; but there is no
back-catalogue and no source currently wired that could provide one. You could not
log a gig you went to last year, which is most of what somebody would want to log
on day one.

Three ways out, and the choice shapes the product:

1. **Setlist.fm.** The right answer, and worth checking early. It is specifically
   an archive of *past* concerts — per artist, per venue, per date — with a free
   API key, MusicBrainz ids to join on, and the actual setlist, which is both the
   back-catalogue and a genuinely good reason to open a past show's page. Risks to
   check before committing: rate limits, terms on storing their data, and how well
   its venue identity joins to ours (our clustering is coordinate-led, theirs is
   name-led, and it publishes no coordinates).
2. **Let people add a show that isn't in the catalogue.** Unavoidable as a
   fallback — no source has everything, especially the DIY tier this app already
   struggles to cover. But a user-created event is a duplicate waiting to happen
   and a moderation surface, so it needs the same `sameShow`/`sameVenue` matching
   the ingest path uses, run against what the user typed.
3. **Only let people log shows Marquee already knew about.** Cheapest, ships
   soonest, and quietly says "your history starts now" — which for a brand-new
   product is more defensible than it sounds, and is what phase 1 does.

Either way `sanitizeInputs` needs to stop treating the past as garbage, and the
`starts_at > now` filter that is currently *everywhere* in the read paths has to
become a deliberate per-query choice rather than an assumption.

### What gets rated, and what aggregates

The atom is a **show you attended**, not an artist and not a venue. That is the
thing a person has an opinion about, it is dated, and it is the only one they can
have actually been to. Artist and venue scores are then *derived* from show
reviews rather than being separately rated — "how good are they live" is the
average of nights people saw them, which is a more honest number than a standalone
star rating and it needs no extra UI.

That gives three read surfaces from one write: the show's own page, "X live" on the
artist page, and "what it's like here" on the venue page. It also means an artist
with one glowing review doesn't outrank one with two hundred — the aggregate needs
a confidence floor, or the leaderboards are noise.

Worth separating, because people conflate them and then argue in the comments: the
**performance** and the **room**. A brilliant set in a venue with bad sound and a
90-minute bar queue is two different verdicts. Two sub-scores on one review, both
optional, is probably the whole of it.

### Data model sketch

- `users` — id, handle (unique, public), display name, avatar, created_at,
  deleted_at. No email column unless the auth choice below needs one.
- `sessions` — token hash, user_id, created_at, last_seen_at, expires_at,
  user_agent. Hashed, never the raw token.
- `attendances` — user_id, event_id, unique on the pair. "I was there" is a
  separate, lighter act than reviewing, and most people will do only this.
- `reviews` — user_id, event_id, rating, optional venue_rating, body, created_at,
  edited_at, deleted_at, plus `visibility`. Unique on (user_id, event_id): one
  review per person per show, editable.
- `review_reactions` — user_id, review_id, kind. Needed for ordering by anything
  other than recency.
- Aggregates: **not** computed on read. A denormalised `rating_count` /
  `rating_sum` on events, artists and venues, updated on write, because D1 is
  SQLite and an artist page averaging over every review of every show they ever
  played is a table scan on the hot path.
- Reports/moderation: `review_reports` (review_id, reporter, reason, state).

### Accounts, concretely

Three constraints narrow this fast: no server to run (Workers only), no email
infrastructure (MailChannels stopped being free for Workers, so magic links mean
paying Resend/Postmark and owning deliverability), and App Store rules — if you
offer any third-party sign-in you must also offer Sign in with Apple, and you must
provide in-app account deletion.

Recommended: **OAuth only, no passwords, no email.** Apple (required anyway),
Google, and **Spotify** — which is thematically right, already has credentials in
this project, and lets a new account arrive with taste data attached. Sessions as
an opaque random token in an httpOnly, Secure, SameSite=Lax cookie on web and in
`expo-secure-store` on native, with the hash in D1. No password reset flow, no
verification emails, no password storage, which removes most of the ways a small
app leaks user data.

Passkeys are the tempting alternative and the recovery story is the problem: lose
the device, lose the account, unless there's a second factor — which means email,
which is the thing this avoids. Worth revisiting once there's a reason to hold
addresses.

Also needed the moment accounts exist, and they are not optional: a privacy
policy, terms, in-app account deletion (Apple requires it), and a decision about
what happens to a deleted user's public reviews — anonymise and keep, or remove.
Anonymise-and-keep is the norm and is much kinder to the aggregate scores.

### Moderation, because public writing invites it

- Rate limits per account and per IP on writes, plus a minimum account age.
- Report → queue → hide/remove, with an audit trail. `ADMIN_TOKEN` already gates
  the mutating admin routes, so the queue has somewhere to live.
- A **verified attendance** signal is the strongest quality lever available and it
  is nearly free: a review from somebody who logged the show before it happened,
  or who was inside the venue's radius that night, is worth flagging as such.
- Reviews of shows that haven't happened yet must be refused outright.

### SEO, which this is very good for

This is the first content on the site that is genuinely unique rather than
assembled from feeds, which is exactly what the ranking work has been missing.
`Review` and `AggregateRating` JSON-LD are well supported and would put stars in
results. Two hard rules: the markup must describe real reviews (fabricated or
self-serving review markup is a manual-action category, not a ranking nudge), and
review pages with no reviews yet must be `noindex` like the other thin pages
already are, or this adds thousands of empty URLs to a sitemap that was just
cleaned up.

### Build order

- [ ] **Phase 0 — prove the interaction with no accounts and no new tables.**
  "I was there" + a private rating, stored on-device in the existing
  `local-collection` store next to follows and saved shows. A "Been to" tab that
  is a personal log. Ships in days, needs no auth, no moderation and no legal
  page, and it answers the only question that matters — whether people log shows
  at all — before anything irreversible is built.
- [ ] **Phase 0.5 — check Setlist.fm properly** before designing around it: key,
  limits, terms, and how many of our venues and artists it can actually join to.
  Everything about the back-catalogue depends on the answer.
- [ ] **Phase 1 — the past becomes first-class.** Loosen `sanitizeInputs`, make
  every `starts_at > now` an explicit choice, and give a past show a page worth
  reading (who played, the setlist if we have it, who else was there).
- [ ] **Phase 2 — accounts.** OAuth, sessions, handles, deletion, privacy policy,
  terms. Migrating a device's local log into a new account on first sign-in is
  part of this phase, not an afterthought — it is the reward for signing up.
- [ ] **Phase 3 — public reviews.** Write, edit, report, moderate; verified
  attendance; aggregates with a confidence floor; the three read surfaces.
- [ ] **Phase 4 — the social part.** Follow people, a feed of what friends saw,
  year-in-review. Only worth it once phase 3 has content in it.

Interacts with the website/app split below, and the order matters: review pages
are server-rendered public content, so they belong on the web side. Decide the
split first, or these get built twice.

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
