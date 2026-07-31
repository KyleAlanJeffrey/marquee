# Marquee — TODO

## The brief

> I want to pivot a big part of this website to adding features for concerts I've
> been to with a rating of how the concert was, which is a page that other people
> can leave reviews on as well. Like Goodreads but for concerts and bands. This is
> gonna need some actual accounts to be made.
>
> — Kyle, 2026-07-30

Concert discovery + a social concert log. **Cloudflare stack:** Expo app →
Cloudflare Worker (Hono) → D1 (SQLite). Ticketmaster + SeatGeek + Bandsintown for
listings, Spotify/Deezer/Wikipedia for artist detail. Accounts are **Clerk**;
follows, saved shows, the gig log and prefs are all account-bound (nothing is
stored on-device). Production: **https://marquee.rocks**.

Everything the pivot needed underneath is in: auth end to end, the four lists on
the account, the on-demand history backfill (~a decade per artist,
`docs/historical-concerts.md`), and the `/privacy` page. What's left is the thing
itself.

## How to read this file

- [ ] not started · [~] in progress · [x] done
- **P0** — the social layer. Do these.
- **P1** — worth doing next, and nothing is bleeding while it waits.
- **P2** — real, but later. Includes anything needing money, a partner account or
  somebody else's approval.

Finished work isn't kept here — it's in the git log, where the reasoning sits next
to the diff that acted on it. This file is only what's left.

---

## P0 · The social layer

The design is **[`docs/social.md`](docs/social.md)** — object model, privacy
rules, moderation minimum, and why reviews roll up to artist and venue rather than
living per-event. The phases there are the plan; each ships useful alone.
History-backfill has landed, so **nothing below is blocked any more** except D on B.

1. [~] **Phase A — profiles and the person graph.** Built 2026-07-31
   (`87f5969`): `person_follows`, `GET /api/users/:key` (handle or Clerk id),
   follow/unfollow, and `POST /me` refreshes the mirror from Clerk's Backend
   API — no client-supplied identity at all. Usernames are enabled on the
   instance (required at sign-up), so handles flow into profile URLs.
   Hardened by Kyle's live testing the same day:
   - Your profile and "what other people see" are **one component**
     (`person-profile.tsx`) rendered by both the Profile tab and `/user/[key]`
     (`c0c2753`), which also purged every stale "stored on this device" claim
     from the app, manifest and landing page.
   - The web sign-up flow stays onsite (`9e58fbc`): explicit
     signUpUrl/signInUrl/fallbackRedirectUrl, verification inline, lands on
     the Profile tab. The residual Clerk pop-up is `pk_test_` instance
     plumbing — see Operational.
   - **Account deletion** end to end (`8b97812`) — also the store requirement.
   - A fresh sign-up can't be stranded without a mirror row (`4f8d10a`):
     ProfileSync retries, and an own-profile read self-heals server-side.
   What keeps it `[~]`: no discovery surface yet — you reach a profile from
   settings or a shared link, nothing else, until reviews (B) put people on
   pages.
2. [~] **Phase B — public reviews.** Built 2026-07-31: `reviews`, `reports` and
   `user_blocks` (migration 0014, applied local + production, all soft-delete);
   `PUT/DELETE /api/events/:id/review` (one per person per show, edits stamped,
   future shows refused with 422, 20/day brake), `GET .../reviews` (author's own
   rides separately so moderation-hidden reviews don't gaslight their author);
   report → `GET/POST /api/admin/reports` queue (hide/keep with audit trail);
   block severs follows both ways, refuses new ones, and empties both parties'
   review reads of each other. Client: composer + list on past-event pages
   (own form, nothing read from the private log), reviews + block button on
   profiles. Verified against local D1 with a minted session token, every path.
   Still open in B: Kyle's end-to-end pass in the UI; a content *filter* beyond
   report/block/hide if store review demands one; and the store submission
   itself, which this phase shares a deadline with (guideline 1.2).
3. [~] **Phase C — the roll-ups.** First slice 2026-07-31: `GET
   /api/{artists,venues}/:id/review-stats` (indexed aggregate over public
   reviews; artist = performance scores, venue = room scores), rendered in the
   artist hero and venue stat grid behind a 3-review confidence floor. Still
   open: the denormalised `rating_count`/`rating_sum` counters once volume
   justifies them, and `AggregateRating` JSON-LD on the server-rendered pages —
   deliberately deferred until real reviews exist, since fabricated-looking
   review markup is a manual-action category, not a ranking nudge.
   Original brief: **the roll-ups.** Artist live-reputation and venue-quality
   scores on `/artist/[id]` and `/venue/[id]`, which are already server-rendered
   and indexed. Highest-leverage phase: "is X good live" becomes a page that
   answers a question people type into Google. Denormalised `rating_count` /
   `rating_sum`, confidence floor, and review pages with no reviews stay
   `noindex`.
4. [~] **Phase D — the feed.** Built 2026-07-31: `GET /api/me/feed` — one
   indexed query walking your follow edges to their recent public reviews (no
   materialisation; the doc's note stands that a materialised feed earns its
   complexity around a few hundred follows each). Rendered as "FROM PEOPLE YOU
   FOLLOW" on your own profile, since the social graph is reached through you.
   Blocks need no extra filter — they sever the very edge the query walks.
   Still open: pagination beyond 50, and any feed of artist/venue activity
   (this one is people only, by design).
5. [ ] **Phase E — lists.** `lists` + `list_items`. Deliberately last — the most
   fun to build and the least load-bearing.

**Decisions in `docs/social.md` that are Kyle's, not mine** (needed before or
during A/B):

- [ ] What "follow" means with people in the mix. Recommendation: people live on
  a profile, not in the Following tab, which renames nothing.
- [ ] Handle policy — reserved words, changes, squatting. Handles go in URLs and
  are effectively permanent, so decide before the first one is issued.
- [ ] Whether a user-contributed past show is private to the logger or a shared
  object (decides whether moderation gets pulled forward).
- [ ] Store-first or social-first — same project, so really "which order do we
  accept the cost in".

## P1 · Next

- [x] **Going / interested on upcoming shows** (Kyle, 2026-07-31) — built the
  same day: `event_rsvps` (migration 0015, one row per person per show),
  `PUT/DELETE /api/events/:id/rsvp`, public counts + private `mine` on
  `GET .../rsvps`, and two count-carrying pills on upcoming event pages behind
  the write gate. Past shows 422 ("log it instead"). Counts name nobody.

- [ ] **Let people add a show that isn't in the catalogue.** The backfill covers
  ~2014 onward for artists Bandsintown knows; this is the rest. Needs
  `sameShow`/`sameVenue` matching against typed input, private-by-default so it
  needs no moderation on day one.
- [ ] **App-store prep** — mine except the builds and submissions:
  - [ ] **Blocked on Kyle:** the EAS project id (`a9540056-…`) belongs to an
    account `eas whoami` isn't a member of. Either `eas login` as its owner or
    hand over an id under `kyle_jeffrey` / `stout-agtech`.
  - [x] In-app **account deletion** — `8b97812`. `DELETE /api/me` (data first,
    Clerk identity last, retryable partway) behind a two-tap confirm on the
    Your-account screen, exactly where the privacy page points.
  - [ ] Screenshots (simulator + seeded data), the Play feature graphic, and the
    `expo-updates` decision (not installed → no OTA channel).
  - [ ] Then the website advertises the app: store badges on `/`, and a smart
    banner on web pages rather than "Open the app" pointing at itself.
- [ ] **The venue-name bugs**, which are also SEO bugs (titles get rewritten by
  Google when they name two places):
  - [x] **Ingestion maps a new junk-named venue to its same-spot room instead
    of inserting it** (2026-07-31). A tour-title venue unknown to the table is
    looked up by location first; a same-spot match adopts the listing (resolved
    straight to the cluster head) and no row is ever written. Unknown spots
    still insert, because the show needs somewhere to hang. Verified on local
    D1: junk at The Fillmore's coordinates → venue count unchanged, event on
    The Fillmore; junk at empty coordinates → row inserted; re-ingest matched
    without duplicating.
  - [ ] A dash-separated billing ("PROGRESSIVE HOUSE NEVER DIED - Seattle") is
    not caught, deliberately — it reads exactly like "The Eastern-GA" to a
    string rule. Pinned as a known miss in `dedupe.test.ts`; wants a source-side
    fix, not a blunter regex.
  - [ ] **240 venues render as their town** — no real name exists in the table
    to promote. Reverse-geocoding is the only route; same missing capability as
    the 29 placeholder-pinned rows.
- [ ] **Clerk residuals:**
  - [ ] Verify a token minted in the *native* app verifies in the Worker (web is
    confirmed; `CLERK_AUTHORIZED_PARTIES` stays unset until a native token is
    inspected — a missing `azp` throws as hard as a wrong one).
  - [ ] Kyle: sign in on the live site, follow an artist, reload, confirm it
    stuck; check `/settings` remembers a radius. (I can't create a real session.)
  - [ ] When a production Clerk instance exists: `pk_live_` key into
    `.env.production`, delete the startup warning that nags about `pk_test_`.
    This is also what removes the residual Clerk pop-up window during
    email/username sign-up on marquee.rocks: a `pk_test_` instance on a real
    domain has no first-party cookie, so ClerkJS syncs the dev session through
    `accounts.dev` in a separate window. Instance plumbing, not our code —
    verification and redirects are already onsite.
  - [ ] Onboarding copy note: sign-in has no first-run reward any more (there is
    no local data to migrate) — a new account starts empty by design.

## P2 · Later

**Venue pages** (what's left after `ea978b9`):

- [ ] Showbox SoDo keeps "The Showbox" — differently-named sibling rooms 2.3 km
  apart under one operator pass both guards. Needs a rule, or an explicit
  decision to accept it.
- [ ] Support acts at that venue; a "similar rooms nearby" rail.
- [ ] Google Places stays the paid alternative: one Place Details call buys
  photos, ratings *and* the venue's website. 1,000 free events/month covers ~470
  venues refreshed monthly; only if a billing account is ever justified. (Yelp
  costed and declined: $229/mo minimum, 24h cache cap.)

**Event coverage** (order matters — canonical venues before crawl widening):

- [ ] Watch production crawl runs for CPU/subrequest limits; raise `CRAWL_BATCH`
  if there's headroom, and measure where `SG_MAX_PAGES=3` cuts off in *time*
  before deciding it's enough.
- [ ] `time_unknown` column — SeatGeek fills unannounced set times with 03:30
  local; letting `time_tbd` events in needs the column plus a card that renders
  a date with no clock.
- [ ] Venue-calendar adapters for the DIY tier (WP "The Events Calendar" JSON,
  iCal). A subsystem with a robots/ToS judgement call, not an afternoon.
- [ ] Scheduled discovery for launch cities (optional cron sweep).

**Ticketing & enrichment:**

- [ ] StubHub Partner API (needs affiliate account) — swap the search deep link
  for real per-event listings.
- [ ] More resale sources in "Get Tickets" (same `ticketSources()` pattern).
- [ ] Spotify extended quota (dev mode strips genres/popularity, 403s
  top-tracks; routed around via Deezer/Wikipedia meanwhile).
- [ ] In-app 30s track previews (Deezer `preview_url` + expo-av).
- [ ] Setlist.fm as a live-proxied, attributed, never-stored setlist on past-show
  pages — their terms allow that and nothing more, and it's off the table
  entirely once there's revenue.
- [ ] A desktop layout for the server-rendered pages (`worker/src/page.ts` is one
  narrow mobile column; the reference design is a desktop document).

## Operational — Kyle's, not fixable in this repo

- [ ] **Rotate the pasted keys**: `ADMIN_TOKEN`, `TICKETMASTER_API_KEY`, and the
  Clerk secret (all went through chat). `npx wrangler secret put …`, then update
  root `.dev.vars`; the Clerk one rotates in their dashboard.
- [ ] **Run `POST /api/admin/repair-duplicates` on production** — re-evaluates
  existing clusters (Manchester, Dallas) under the fixed comparators. Needs
  `ADMIN_TOKEN`, cursor-paged (`afterArtistId`) until done.
- [ ] **Delete the inert Worker secret `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`** —
  runtime secrets are invisible to `expo export`; it does nothing and reads as
  if it did.
- [x] **Clerk social slots** — resolved 2026-07-31: Apple + Google + Spotify,
  Facebook dropped (verified via `/v1/environment`). The planned three exactly.
- [ ] **Search Console + Bing Webmaster verification.** One-time, worth more
  than further on-page SEO.
- [ ] **IndexNow 429s are origin-level** (Worker egress IPs; the same payload
  succeeds from a laptop). Next: Bing's authenticated URL Submission API, or
  accept sitemap-only discovery.
- [ ] **`EXPO_PUBLIC_MAPBOX_TOKEN` in Workers Builds** (build-time env var).
- [ ] **A Bandsintown app_id issued to this project** — README has both request
  paths.

## Known residuals (fixable, but not by another repair pass)

- Events filed against the wrong venue row before the matcher was fixed stay
  wrong — re-clustering repoints at cluster heads, never re-decides membership.
  Three Outside Lands dates sit on Davies Symphony Hall; a Ticketmaster re-sweep
  fixes them.
- One `source='seed'` venue row remains in production as a cluster head;
  removing it would null real shows' venues (`unseed.sql` refuses,`77f2be3`).
  Harmless duplicate inside a correct cluster; `repair-duplicates` eventually
  tidies it.
- 29 venues are pinned at a source's town-wide default coordinate. Needs a
  geocoder, not a better choice among existing rows.

## Known limitations (by design)

- Browsing needs no account; **keeping things does** — follows, saved shows, the
  log and prefs live on the account, so they need a network and a sign-in.
  "No account needed to browse" is the positioning.
- Dark-only theme.
- D1/SQLite geo is bbox + haversine (fine at city radius).
- Native apps ship via EAS/app stores and point at the deployed Worker.
- Bandsintown has no geographic search — coverage scales with how many artists
  we know, which is why the artist frontier crawl exists.
- Name resolution is fragile both directions: Ticketmaster attractions are
  exact-name-only; Bandsintown is name-keyed and an empty answer is
  indistinguishable from an unknown artist.
- `database_name: "marquee"` stays as-is — `database_id` is pinned next to it;
  renaming without the pin binds a fresh empty database.

_Design source: `stitch_concert_compass/` — `electric_stage/DESIGN.md` is
authoritative for tokens; the screen directories are references, and where they
disagree with the spec, the spec wins._
