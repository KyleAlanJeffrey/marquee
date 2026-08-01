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
living per-event. **All five phases landed 2026-07-31** (profiles + person graph,
public reviews with report/block/hide moderation, artist/venue review roll-ups,
the follow feed, curated lists), each verified against local D1 with minted
session tokens and the moderation loop demonstrated end-to-end on production.
What's left is the residuals:

1. [~] **Phase A residual** — no discovery surface: you reach a profile from
   settings or a shared link, nothing else, until reviews put people on pages.
2. [~] **Phase B residuals** — Kyle's end-to-end pass in the UI; a content
   *filter* beyond report/block/hide if store review demands one; and the store
   submission itself, which this phase shares a deadline with (guideline 1.2).
3. [~] **Phase C residuals** — the denormalised `rating_count`/`rating_sum`
   counters once volume justifies them, and `AggregateRating` JSON-LD on the
   server-rendered pages — deliberately deferred until real reviews exist, since
   fabricated-looking review markup is a manual-action category.
4. [~] **Phase D residuals** — feed pagination beyond 50; any feed of
   artist/venue activity (this one is people only, by design).
5. [~] **Phase E residual** — reportability once lists join the moderation
   kinds. (Item notes and reordering landed 2026-07-31: `PUT
   /:id/items/:kind/:refId` patches the note and/or swaps a place up or down,
   with owner controls and note display on the list screen.)

**Decisions in `docs/social.md` that are Kyle's, not mine:**

- [ ] What "follow" means with people in the mix. Recommendation: people live on
  a profile, not in the Following tab, which renames nothing.
- [ ] Handle policy — reserved words, changes, squatting. Handles go in URLs and
  are effectively permanent, so decide before the first one is issued.
- [ ] Whether a user-contributed past show is private to the logger or a shared
  object (decides whether moderation gets pulled forward).
- [ ] Store-first or social-first — same project, so really "which order do we
  accept the cost in".

## P1 · Next

- [~] **Social design pass** (Kyle, 2026-07-31) — the thinking is
  **[`docs/design-social.md`](docs/design-social.md)**; the slices, in the
  order the doc argues for:
  - [x] **Unified log/review flow** (`5589ae0`) — the composer lives inside
    the log card as its public step, seeded from the log's stars on first
    open. The note still never crosses over; ReviewSection is now purely
    everyone else's.
  - [x] **Log as poster wall** (`fa204b8`) — artist-image tiles with date +
    stars, years as rules, list view behind a toggle for rating/removing.
    The *profile* stats-line half is parked: a public profile can only count
    public reviews — the log is private — so profile walls wait on Kyle's
    contributed-shows/visibility decisions below.
  - [x] **R2 binding + artist-image mirror** (`ebb8aae`, hardened `62898cf`)
    — `GET /img/artist/:id`, cache-aside with a production-measured
    allowlist (every stored artist image is s1.ticketm.net /
    seatgeekimages.com / i.scdn.co — 891/591/48), a capped body reader, and
    a 302 at the upstream URL on any failure. First consumer: og:image +
    JSON-LD on the SSR pages. **Verified live on marquee.rocks 2026-07-31**:
    the route serves a mirrored 179KB JPEG and artist pages' og:image points
    through it. Next consumers: venue photos (Wikimedia discourages
    hotlinking), Clerk avatars, then the API's artist rows (needs an origin
    at the data.ts mapping layer — native clients want absolute URLs).
  - [x] **Review likes** (`813aa49`) — migration 0018 applied local *and*
    remote (a like is a fact keyed (review_id, user_id); like/unlike are
    idempotent PUT/DELETE, verified double-tap-safe against local D1 with a
    minted session), heart + count on review rows behind the write gate,
    event reviews ordered most-liked-first with newest as tiebreak. The
    production route is live (401s unauthenticated). Remaining trigger:
    likes on *lists* is what 0016 named for turning list deletion into a
    tombstone.
    - [ ] One admin loose end: the likes batch (`813aa49`+`d60c3fe`) hasn't
      had its CodeRabbit pass — the free CLI allowance rate-limited
      (~00:50Z, 33-min reset). A re-run was queued in that session; if it
      never reported, run `coderabbit review --agent -t committed --base
      9e6f786` and judge the findings.
  - [x] **Feed placement** (`9e6f786`) — the follow feed now leads your own
    profile instead of sitting under the follower lists. A PEOPLE segment on
    Following stays open as the bolder option (Kyle's "what does follow
    mean" decision below).
  - [ ] **Generated OG cards from R2** — per-entity share images; the
    highest-leverage share/SEO item left.
  - [ ] Delight tier: four favorite artists on profiles, list cover
    collages, year-in-review stats.
  - User gig photos stay parked behind Kyle's moderation decision.
- [x] **Folder-structure audit** (Kyle, 2026-07-31) — done the same day. The
  real offender was `src/lib/hooks.ts`: 19 catalogue-query hooks in a file
  literally named "hooks" outside the hooks directory; it moved to
  `src/hooks/queries.ts` (11 importers updated). Everything else stays put on
  purpose: the domain modules (reviews, curated, people, the account stores,
  auth, write-gate) each export a hook as their public face *next to* their
  types and requests, and splitting those would trade cohesion for a
  tidier-looking tree; `lib/notifications.ts` keeps its hook because the file
  is a subsystem with module-level side effects, not a misfiled hook. The rule
  is written at the top of `src/hooks/queries.ts`.
- [ ] **App-store prep** — mine except the builds and submissions:
  - [ ] **Blocked on Kyle:** the EAS project id (`a9540056-…`) belongs to an
    account `eas whoami` isn't a member of. Either `eas login` as its owner or
    hand over an id under `kyle_jeffrey` / `stout-agtech`.
  - [ ] Screenshots (simulator + seeded data), the Play feature graphic, and the
    `expo-updates` decision (not installed → no OTA channel).
  - [ ] Then the website advertises the app: store badges on `/`, and a smart
    banner on web pages rather than "Open the app" pointing at itself.
  - In-app account deletion (a store requirement) is done — `8b97812`.
- [ ] **The venue-name bugs**, which are also SEO bugs (titles get rewritten by
  Google when they name two places). Junk-named *new* venues now adopt their
  same-spot room at ingest (2026-07-31); what's left:
  - [~] Dash-separated billings ("MGMT DJ SET - San Francisco") — the
    source-side fix landed 2026-07-31: `dashBillingVenueName` judges the name
    with the listing's own city and artist in the Bandsintown mapping (suffix ≈
    city AND the prefix carries the act or reads as a tour — either guard alone
    junks real rooms, both were measured on production first), and the verdict
    rides `VenueRow.junk_name` into `persist`'s junk-adoption path and the
    name-overwrite guard. Every measured production row is pinned as a test.
    Residuals:
    - "PROGRESSIVE HOUSE NEVER DIED - Seattle" itself still escapes — a
      club-night brand with no artist token; nothing in the listing separates
      it from a room. Accepted, pinned as a known miss.
    - Tour-segment stripping landed 2026-07-31: `cleanVenueName` drops
      tour-shaped dash segments at ingest (guarded so a billing is never
      "rescued" into a room — the cleaned name must not carry the act), and
      the legacy repair recovered **83 production rows** (measured 723 dash
      rows → 123 candidates → guards vs the artist table, each row's own
      acts, and its own city/region cut 40 → hand review culled 6 billing
      families). Ryman Auditorium, York Barbican, the 100 Club et al. now
      wear their names. The renamed rows may duplicate existing rows for the
      same rooms — the production `repair-duplicates` run already on the
      operational list will fold them.
    - Legacy *billing* rows already stored (JOURNEY OF A LIFETIME etc.) stay
      until a repair pass or a re-crawl adoption touches them; the billing fix
      is ingest-side only.
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
- Time-TBD shows landed 2026-07-31 (migration 0017, `time_unknown`) — the one
  residual: rows those sources skipped before it exist only upstream, so flagged
  shows accumulate as the crawls re-sweep. Nothing to do but wait.
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
- Desktop layout for the server-rendered pages landed 2026-07-31 (`80cab8e`) —
  the stale part of the old note was blaming `page.ts`, which was already a
  desktop document; `detail.ts` was the narrow column, and now splits into
  content + sticky facts card at ≥960px.

## Operational — Kyle's, not fixable in this repo

- [ ] **Rotate the pasted keys**: `ADMIN_TOKEN`, `TICKETMASTER_API_KEY`, and the
  Clerk secret (all went through chat). `npx wrangler secret put …`, then update
  root `.dev.vars`; the Clerk one rotates in their dashboard.
- [x] **Run `POST /api/admin/repair-duplicates` on production** — done
  2026-07-31: full cursor-paged sweep (six pages, `?after=` — note the cursor
  is a query param, not a body field), 58 duplicate shows merged, ending
  `truncated: false`. Also folded any duplicates created by the same day's
  83 venue renames.
- [ ] **Delete the inert Worker secret `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`** —
  runtime secrets are invisible to `expo export`; it does nothing and reads as
  if it did.
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
