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

1. [x] **Phase A residual closed** (Kyle, 2026-08-03) — people are now
   findable: `GET /api/users/search` (name/handle, block-aware, escaped
   LIKE, 2-char floor, 20-row cap) and a PEOPLE section on the search
   screen; review rows were already linking authors to profiles. What's
   left of discovery is *suggestion*, not lookup — "people who reviewed
   this show" style rails, once there are enough people to suggest.
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

- [~] **Letterboxd-style logging of past shows** (Kyle, 2026-08-05) — landed
  the same day: a `/log-show` modal in three steps — WHO (artist search,
  with an always-reachable by-hand branch that keeps what you typed),
  WHICH NIGHT (their history, with the one upstream fetch fired on entry
  instead of after the list is found; already-logged nights are marked and
  reopen for editing), HOW WAS IT (the point: summary card, big stars, one
  text field, save). The text field is owned by the toggle — off it's the
  private note, on it posts as the public review instead; the note still
  never crosses over silently. Entry points: LOG A SHOW on the Log tab
  (button + empty state), and the artist page's "Seen them before?" now
  opens the modal at that artist's nights. Subsumed and deleted: the
  in-page past-shows list that logged with a silent checkmark, and the
  standalone by-hand form. Verified in the browser through the write gate
  (signed-out save routes to sign-in and the draft survives the round
  trip). Residuals:
  - [ ] Kyle: one signed-in save end-to-end (I can't sign in) — rating +
    note should land in the log, and the toggle should post a review
    visible on the event page.
  - [ ] The review toggle only offers itself on catalogue nights; when a
    manual show is later promotable to a real event (open product
    decision), it inherits the toggle.
- [~] **Share concerts** (Kyle, 2026-08-05) — first cut landed the same day:
  a share button in the event page's top bar, next to the bookmark. The
  link is always `marquee.rocks/event/<id>` whatever host the sender is on
  (the SSR pages behind it already unfurl with real titles and the mirrored
  artist image); the message is what · where · when. Native gets the share
  sheet (iOS url field, Android link-in-message), mobile web gets
  `navigator.share`, desktop web copies to the clipboard and says so with a
  checkmark. The pure payload builder is pinned by tests. Residuals:
  - [ ] Adopt on the other pages — artist, venue, profile, list — the
    component and payload builder are already generic enough.
  - [ ] "Share to a friend on Marquee" (in-app, needs a messaging or
    notification decision) is a different feature; don't confuse the two.
  - [ ] Share cards get much better when the OG-cards item ships (see the
    design pass) — same URLs, richer unfurl.
- [~] **Split the Workers** (Kyle, 2026-08-04) — **live in production
  2026-08-05** (PR #2 merged): the website Worker keeps the site, the API
  and the /img mirror; `marquee-jobs` (`wrangler.jobs.jsonc`, entry
  `worker/src/jobs.ts`) owns the 15-minute cron (crawl + IndexNow) and
  `/api/admin/*` at the same paths, against the same D1. Cutover verified
  against production: marquee-jobs healthy with every source configured,
  the site's admin routes 404, and the 16:30Z tick produced exactly one
  crawl run (the overlap doubles ended once `"crons": []` explicitly
  deleted the website's leftover schedule — omitting the key doesn't).
  Residuals:
  - [x] ADMIN_TOKEN deleted from the website Worker (Kyle, 2026-08-05);
    the fresh token minted for marquee-jobs was the rotation. Operator
    scripts point at the marquee-jobs origin from now on (paths are
    unchanged).
  - [x] Auto-deploy fixed (2026-08-05): the 9106 wasn't a bad token at
    all. Kyle's secret holds an *account-owned* token (`cfat_…`), and
    wrangler discovers the account via GET /memberships — a user-scoped
    call that token type can never make. `account_id` is now pinned in
    `wrangler.jobs.jsonc` so discovery is skipped; the workflow guard
    also rejects the malformed shapes that produce the same 9106
    ("Bearer " prefix, quotes, whitespace) with a legible error. First
    green run: 31069337849. CI owns jobs deploys from here.
    - [x] Kyle rolled the token and updated the secret (2026-08-06); the
      deploy-jobs run after the swap is green, which is the confirmation.

- [~] **Event rich-result warnings** (Kyle, 2026-08-05, from Search
  Console's "Improve item appearance") — fixed the same day: event pages
  gained `description`, `endDate` (= start; nobody publishes concert end
  times and inventing a duration would be read as fact) and `organizer`
  (the venue, as an Organization at its canonical URL — Google's Event
  docs describe organizer as who *hosts*). City hubs switched to the summary-page
  pattern (ListItem = position + url only), which is what Google's
  carousel docs prescribe and removes the ~209 hub items that were being
  counted as Events missing image/offers/everything. What stays
  deliberately unfixed:
  - price/priceCurrency stay absent unless the feed's local currency is
    USD — no currency column; asserting USD abroad is the lie CodeRabbit
    already caught once.
  - `validFrom` stays absent — no on-sale dates in any feed.
  - [ ] Watch Search Console after the next recrawl; counts should fall
    toward the ~107 detail pages, then to only the price warnings.
- [~] **Smarter ranking for area shows** (Kyle, 2026-08-03) — first cut
  landed the same day: a `notability` score in `nearbyEvents` behind
  `sort=featured` (TM id +3, Spotify id +2, image +1, genres +1, RSVPs up
  to +6), coarse integer bands so date order still rules within a band.
  Weights measured against production SF: the ranked top reads Toto / Tori
  Amos / J. Cole / Noah Kahan / David Byrne / Childish Gambino where date
  order read "Official Dailey & Vincent" and "Open Mic Night"; 187 id-less
  long-tail rows sink. Browse defaults to TOP with a BY DATE toggle beside
  the grid/list one. Second cut 2026-08-05 closed two residuals:
  - [x] **Artist-scale signal** — the venue proxies were measured against
    production SF and both failed: upcoming-show count ranks The
    Independent (53) above Oakland Arena (40); average price ranks The
    Chapel ($120) above the arena ($86) on sparse resale-noisy coverage.
    What works is the headliner's own draw: Deezer fan count (keyless API;
    Spotify's popularity is behind the quota wall). Migration 0020 adds
    `artists.deezer_fans`; notability gains decade bands (+3 ≥200k, +2
    ≥20k, +1 ≥2k — measured: Kesha 4.2M, Toto 974k, IVE 265k, Aldous
    Harding 22.5k, club acts in the hundreds). Deezer's search index is
    littered with blank impostor duplicates that outrank the real page
    (search "Kesha" → a 12-fan blank first, the 4.2M one further down), so
    `pickDeezerArtist` takes max-fans among exact name matches — pinned by
    tests, and it fixes artist-page top tracks too, which had the same
    bug. Fill paths: 10/crawl-run on marquee-jobs (ask-once, 0 = asked and
    unknown), fresh store on artist-page views, and
    `POST /api/admin/backfill-deezer-fans?limit=40` on marquee-jobs.
    Verified in production 2026-08-05: the first marquee-jobs tick stored
    8 real counts (Dimmu Borgir 201k lands the +3 band, Satyricon 97k the
    +2).
    - [ ] Kyle: run the backfill against production (needs the new
      ADMIN_TOKEN) if you don't want to wait ~1 week for the crawl to
      fill ~6k artists at 960/day. TM-id'd artists fill first either way.
  - [x] **Explore rails ranked** — Explore's one nearby query now asks for
    `sort=featured`, so the hero and the two secondary cards are the most
    notable acts in range; the COMING UP rail re-sorts itself back to date
    order client-side (a "coming up" that isn't soonest-first reads
    broken). Maps share the query and don't care about pin order.
  - [ ] Revisit weights when RSVPs/reviews have volume — the social term is
    capped at +6 and should eventually dominate the metadata guesses.

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
    - [x] The likes batch's owed CodeRabbit pass ran 2026-08-03 (base
      `9e6f786`, spanning it plus people search and RSVP-count surfacing):
      four findings, all confirmed and fixed in `146b8d8` — ensureUser
      before the like insert, tap-while-pending guard, optimistic no-op
      when the cache already agrees, eventsByIds row type admitting the
      counts.
  - [x] **Feed placement** (`9e6f786`) — the follow feed now leads your own
    profile instead of sitting under the follower lists. A PEOPLE segment on
    Following stays open as the bolder option (Kyle's "what does follow
    mean" decision below).
  - [x] **People search** (Kyle, 2026-08-03; `a964b09`) — see the phase A
    residual above.
  - [x] **Blank artist images** (Kyle, 2026-08-03; `8598964`) — measured:
    4,447/6,050 artists imageless; 2,152 of 2,208 Bandsintown-linked ones
    were blank because the crawl held a photo in every payload and never
    wrote it. Now backfilled fill-if-null at `rememberBitIdentity` (stock
    silhouettes at `photos.bandsintown.com/artist<Size>.jpg` filtered — a
    "no photo" wearing a URL), closing organically as the 15-min crawls
    re-sweep; watch the imageless count fall. Cards draw a designed
    musical-notes tile (`ArtistArt`) instead of an empty box for the rest.
    Residual: the ~570 id-less artists with no BIT identity stay imageless
    until enrichment or a SeatGeek re-sweep names them.
  - [x] **RSVP counts on events** (Kyle, 2026-08-03; `b6a0704`) — every
    event payload carries live going/interested counts; cards and the event
    hero wear "2 GOING · 5 INTERESTED" in cyan, hidden at zero, upcoming
    shows only. Next rung when the numbers justify it: *whose* faces —
    "3 going, including @x" needs a join to public profiles and a privacy
    read of docs/social.md first (RSVPs are public counts, private answers
    today).
  - [ ] **Generated OG cards from R2** — per-entity share images; the
    highest-leverage share/SEO item left.
  - [x] **Four favorites** (2026-08-03) — migration 0019, `PUT
    /api/me/favorites` (max four, ids checked against the artists table,
    unknown ids drop out), resolved tiles on every profile GET, and a strip
    under the profile header with an owner-side picker over followed
    artists. Verified end-to-end against local D1 with a minted session.
  - [ ] Delight tier remainder: list cover collages, year-in-review stats.
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
- [x] **Simulator dead inputs** (Kyle, 2026-08-05) — the log-show and /search
  modal search fields took taps but never kept the keyboard. Root cause found
  by probing, not the theories that came first: on iOS, flipping React state
  during the focus window (the `onFocus={() => setFocused(true)}` glow) makes
  the field resign first responder immediately — probes showed FOCUS → BLUR
  back-to-back, and even a `setTimeout(0)` deferral lands inside the responder
  handoff and dies the same way. Keystroke re-renders after focus settles are
  fine. Fix: shared `SearchBar` component (`src/components/search-bar.tsx`)
  whose focus glow is web-only; both screens' bars also moved inside their
  FlatLists as header elements. Verified on fresh Expo Go mounts: both fields
  type, search, and keep focus; web still glows. `autoCorrect` off on artist
  fields ("Aldous" was becoming "Aldo is").
  - [x] Follow-up (same day): the deep-linked full-screen presentation laid its
    header under the status bar — fixed with a native SafeAreaView around the
    header (the insets *hook* reports the window inset even inside a sheet and
    double-padded it; the own-frame SafeAreaView pads only when full-screen).
    Verified both presentations on the simulator.
  - The blue gear bubble covering the TopBar search icon and the modal X is
    Expo Go's dev-menu overlay — dev-only, not a bug to fix.
- [ ] **App-store prep** — mine except the builds and submissions:
  - [x] EAS project unblocked: `app.json` owner is `kyle-jeffreys-team` and
    Kyle submitted the first iOS build (2026-08-05).
  - [x] CI builds (Kyle, 2026-08-06): `.github/workflows/eas-build.yml` runs
    `eas build` on version tags (`v*` → both platforms, production profile,
    `--auto-submit`) or by hand from the Actions tab (choose platform/profile/
    submit). `--no-wait` hands the build to EAS's servers, so the Action is
    done in a minute and progress lives on expo.dev.
    - [x] `EXPO_TOKEN` is set and proven — the v1.0.4 tag run built through
      it.
    - [x] `ascAppId` corrected to **6798407800** (Kyle, 2026-08-06, "the ios
      submission got submitted to the wrong app"): the pinned 6798406543 was
      misread from a screenshot when non-interactive submits were first wired
      up, and both v1.0.4 and the first v1.0.5 submission landed on that
      record. The right one is "marquee rocks" (bundle rocks.marquee, Apple
      ID from its App Information page); v1.0.5 was resubmitted there —
      same binary, no rebuild. Kyle: expire the stray builds on the old
      record's TestFlight page if it bothers anyone.
    - [ ] Kyle: the Google Service Account key is still NOT in EAS — the
      v1.0.5 CLI release (2026-08-06) died at "Google Service Account Keys
      cannot be set up in --non-interactive mode" after queuing the builds,
      which is direct evidence EAS can't find one. Run `eas credentials`
      → Android → Google Service Account and upload the JSON key file, then
      remove the guard in eas-build.yml (the comment marks the spot).
      Whatever was added on 2026-08-06, it wasn't this.
  - [x] Auto-tag releases (Kyle, 2026-08-06): bump `expo.version` in
    `app.json`, push to main, and `.github/workflows/auto-tag-release.yml`
    tags the commit `v<version>` and dispatches the EAS production
    build+submit. It dispatches instead of relying on the tag trigger because
    tags pushed with a workflow's own `GITHUB_TOKEN` never fire other
    workflows (GitHub's recursion guard; `workflow_dispatch` via API is the
    documented exception). Idempotent — if the tag exists or the version
    doesn't beat the highest release tag, app.json edits do nothing. Proven
    same day: Kyle bumped to 1.0.4 (`a1d9d8f`) and the chain ran itself —
    auto-tag → v1.0.4 → EAS build+submit, all green.
  - [ ] Screenshots (simulator + seeded data), the Play feature graphic, and the
    `expo-updates` decision (not installed → no OTA channel).
  - [ ] Then the website advertises the app: store badges on `/`, and a smart
    banner on web pages rather than "Open the app" pointing at itself.
  - In-app account deletion (a store requirement) is done — `8b97812`.
- [x] **Native map rebuilt** (Kyle, 2026-08-06, "doesn't load the actual map,
  not full screen, easier to click on the venue"): `map.tsx` is now a
  full-screen interactive `react-native-maps` MapView (Apple Maps on iOS — no
  token) with one glowing pin per venue group and a glass sheet whose venue
  name links to `/venue/{id}` (web sheet too). Pin taps are hit-tested in JS
  from `MapView.onPress`'s coordinate — under Expo Go's New Architecture the
  Markers' native press events never arrive and image-based default pins
  don't render at all (measured on SDK 56); nearest pin within 28 screen
  points wins. Verified on the simulator end-to-end (pin → sheet → venue
  page). `c60b74a`.
  - [x] Mapbox `pk.` token: GitHub push protection blocked committing it to
    `.env.production` (public repo — GitHub flags any Mapbox token, even the
    public-by-design kind). Kyle resolved it the env-var way (2026-08-06,
    `a1d9d8f` removed the line): the token lives in EAS/Workers Builds
    environment variables, not in git. Worth confirming the static maps
    render in the next TestFlight build.
  - [ ] Android standalone builds need `android.config.googleMaps.apiKey` in
    app.json before the map screen works there (Expo Go Android is fine).
- [x] **Social surfacing: the Activity tab** (Kyle, 2026-08-06, "I want to
  see what other people have seen or are going to in an easy way… consolidate
  some existing tabs", PR branch `social-activity-tab`): Letterboxd's exact
  consolidation — the diary lives on the profile, the friends feed gets the
  tab. Log left the tab bar (still at `/log`, fronted by a YOUR LOG card on
  Profile); Activity took its slot with two scopes: FRIENDS (`/me/feed`, now
  reviews **and** RSVPs) and EVERYONE (new `GET /activity`, the cold-start
  answer — works signed out). RSVPs became **named** (deliberate reversal of
  "counts name nobody" — an integer answers "who's going" for nobody):
  `/events/:id/rsvps` returns `people`, going-first then followed-first, and
  the Your Plans card renders them as tappable chips. Feed authors are
  tappable now too (they never were). The mixed stream is two indexed
  queries JS-merged on a compound (createdAt, id) cursor; the RSVP id is
  synthesised (`r:<user>:<event>`), and RSVP items only stream for shows
  still to come. Verified on the simulator against local D1 end to end.
- [x] **v1.0.4 launch crash** (Kyle, 2026-08-06, "crashes immediately on
  trying to open the app"): the EAS production env var
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` carried the `.env.production` line's
  trailing `# production — …` comment inside the value — env vars are not
  shell — and Clerk throws on an unparseable key before the first frame.
  Diagnosed by elimination: a local Release build of the identical code
  launched clean on the committed fallback key, so the difference had to be
  the EAS-side override (`eas env:list` showed the polluted value).
  Three-part fix: the dashboard value corrected via `eas env`; `auth.tsx`
  now cuts the key at the first whitespace so the same paste accident
  builds a working app (keys never contain whitespace); v1.0.5 cut through
  the auto-tag chain. (Android auto-submit stayed blocked — the release run
  itself proved EAS has no Google Service Account key; see the app-store
  prep item.) Kyle confirmed the TestFlight build opens and works,
  2026-08-06 — incident closed.
  Lesson for next time: when a store build misbehaves and local doesn't,
  diff the *build inputs* (`eas env:list --environment production`) before
  the code. `64b3077`.
- [x] **Event titles as venue names, round two** (Kyle, 2026-08-06, Alabama
  Shakes screenshot titled "Buddy Guy 90th Birthday Concert"): a Bandsintown
  event-title row on Radio City Music Hall's exact coordinates held 33 events
  and *won* its cluster's head election — no colon, no tour word, 31 chars, so
  every existing rule passed it. Fixed by rule, each pattern measured on
  production first: birthday (6/6 junk), celebration (25/25), "in concert"
  (20/20 of 97 sampled) joined `TOUR_NAME_PATTERNS` — the clustering tier —
  because a name like that must not vouch or conflict; pipe+"City, ST" (8/8)
  is display-only in `looksLikeEventTitle` since those names carry the real
  venue's tokens and merge correctly on their own. Bare "concert" deliberately
  untouched: 378 rows, dominated by real Concert Halls/Series/Concertgebouw.
  First repair run re-headed the Texas "Buddy Guy 90 |" family onto the real
  Majestic/ACL rows and merged 102 duplicate shows. `a685f63` + `a05c419`.
  - Verified end-to-end: second repair run clustered 52 more rows, the
    Alabama Shakes event page (d8fa6d42…) serves "Radio City Music Hall", and
    Radio City's row now holds the cluster's 42 events.
  - Remaining pipe rows without a ", ST" suffix ("Nik Kershaw | Musings &
    Lyrics 2027", ~98 rows) are still unhandled — they need segment-level
    treatment like `cleanVenueName`, and some pipes are real descriptors
    ("Godfrey Daniels | Live Music Listening Room"). By rule, later.
  - [ ] Found while verifying: **artist names as venue names** are their own
    junk class the string rules can never catch — production has heads named
    "Pink Martini" and "s/Saint Etienne" sitting on symphony-hall coordinates
    (surfaced when "The Muppet Christmas Carol In Concert" rows stopped
    vouching and merged into them). Detecting these needs a cross-reference
    against the artists table (venue.name token-equals a known artist), not a
    pattern. Same-junk-headed clusters only trade one junk name for another,
    so nothing regressed — but the class predates today and is worth a pass.
- [x] **DICE discovery source** (Kyle, 2026-08-05, "we're missing some venues —
  knockdown.center for one"). Measured first: Knockdown's own calendar listed 47
  shows, production carried 29, and all of the missing (Flying Lotus, Boy
  Harsher, L7, Cate Le Bon…) ticketed through DICE alone. `api.dice.fm/
  unified_search` is open (no key): geo+tag search paginates with
  `next_page_cursor`, **sent back as `cursor`** — its response name silently
  replays page one. Geo results are *slim* (no lineup, no perm_name), so the
  sweep is two-phase: enumerate ids (8 pages × `music:gig`+`music:dj`, date-
  interleaved across tags or the cap starves one of them), hydrate only unknown
  ids via `GET /events/{id}` (60/sweep). Artistless listings (season passes,
  open-decks — 411 of 1192 NYC candidates) go in `dice_skips` (migration 0021,
  re-checked weekly) or the date-sorted head wedges the sweep at zero forever —
  measured before the fix. USD-only prices (cents, `amount_from` or `amount`),
  events with no billed act are skipped rather than minting "Horse Meat Disco NY
  Labor Day Weekend" as an artist. Local proof: 48 upcoming Knockdown rows ≈
  the venue's whole calendar. Left for later: parsing bills out of titles
  ("Carrying, Ok King, Stryk9, Ekblad") would recover the artistless half of
  the catalogue, but string-minted artists are the exact trap the venue-name
  work spent weeks digging out of.
- [x] **Nearby radius filtered after the LIMIT** (Kyle, 2026-08-05: "100 miles
  has less than 10"). The feed boxed on lat/lng, took its 400 rows, then dropped
  the box's corners (radius ×1.4) in JS — so under `featured` sort a notable
  show 130 mi out took a page seat from an in-radius show and was thrown away.
  Measured on production New York: 398 items at 10 mi, 380 at 25, 391 at 100.
  Fix: the radius is an equirectangular predicate inside the SQL where LIMIT
  can see it (`withinMilesSql`), for both nearbyEvents and nearbyVenues; the JS
  post-filters are gone. Fixing it surfaced a second bug the old filter had
  been hiding: a cluster head with junk coordinates put "319 mi" on the 100-mi
  feed (Archer Music Hall, Allentown — headed by a Bandsintown "Arrow" row
  placed in Pittsburgh). The head's coordinates are now guarded in SQL too, and
  the Arrow head's coords were corrected in production to its cluster's spot.
  - [ ] Residual (CodeRabbit, pre-existing): concert reminders sync off the
    nearby page's follow intersection, and that page caps at 400 — a followed
    artist's show ranked past the cap gets no reminder. The Following tab
    already asks the right question (`useUpcomingForFollowedArtists`, the
    whole horizon inside the radius); reminders should sync from that query
    instead of the feed page.
  - [ ] Residual: the cluster-spread audit found three more clusters whose
    members sit >0.5° apart, all non-US, all Bandsintown coords —
    TivoliVredenburg/Utrecht (108°!), Escenario GNP Seguros/Monterrey (2.6°),
    Unipol Arena/Bologna (1.1°). The SQL guard keeps them out of feeds they
    don't belong in; the rows themselves still want repair, ideally a rule
    (head coords = cluster consensus, or reject a member whose coords disagree
    with its cluster by miles) rather than more hand UPDATEs.
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
  - [~] **Production instance cutover** (Kyle started 2026-08-05; the
    instance exists, key `pk_live_Y2xlcmsubWFycXVlZS5yb2NrcyQ`). Found so
    far: the `redirect_uri: Not matching configuration` sign-up error was
    localhost:8081 talking to the production instance — production Clerk
    only accepts its own domain, so dev stays on `pk_test` (root `.env`
    reverted; live key belongs in `.env.production` + Workers Builds
    only). The Account Portal redirect-fallback fields are placeholders;
    empty = app root, fine. Remaining, in order:
    - [x] DNS (2026-08-05): all five records in Cloudflare as DNS-only —
      the `accounts` record was briefly proxied, which reads as
      Cloudflare error 1000 ("DNS points to prohibited IP", a 403 to
      curl) because Clerk itself sits behind Cloudflare. Verified live:
      ClerkJS 200 from clerk.marquee.rocks, the portal renders sign-in
      at accounts.marquee.rocks with Apple/Google/Spotify buttons.
    - [x] `.env.production`: `pk_live_` key in (47df17b).
    - [ ] Worker secrets: `CLERK_SECRET_KEY` → production `sk_live_…`;
      `CLERK_JWT_KEY` → the production instance's JWT public key. (Kyle
      says updated; still wants an end-to-end check that a write sticks.)
    - [x] **Native app sign-in (2026-08-06)**: the production iOS build's
      hosted-portal sign-in failed with the generic connection error until
      the iOS App ID `ST54366XJ2.rocks.marquee` was registered in Clerk →
      Configure → Native applications. That registration alone fixed it —
      the dashboard rejects a bare `marquee://` redirect entry as invalid,
      and none is needed; the App ID covers the scheme. (Expo Go can never
      exercise this path — the redirect plugin only exists in real builds.)
    - [x] **The post-sign-up portal bounce, diagnosed and fixed
      (2026-08-05)**: sign-up lived at `/sign-in?mode=sign-up`; Clerk's
      hash router navigates to `#/verify-email-address` mid-flow, the
      query param didn't survive, the screen swapped the card back to
      SignIn, and the stranded sign-up bounced to the Account Portal
      (`accounts.marquee.rocks/sign-in?redirect_url=…`). Now `/sign-up`
      is a real route (web card + native hosted-portal alias), the mode
      is the path, and the switcher navigates instead of flipping state.
      Verified: `/sign-up#/verify-email-address` keeps the SignUp card.
    - [ ] Kyle: Clerk dashboard → Configure → **Paths** — set the
      application's sign-in URL to `https://marquee.rocks/sign-in` and
      sign-up URL to `https://marquee.rocks/sign-up`, so any
      ClerkJS-initiated redirect lands on our pages instead of the
      Account Portal (the portal stays for native and account
      management).
    - [ ] Social sign-in needs own OAuth credentials on production —
      Google client with redirect `https://clerk.marquee.rocks/v1/oauth_callback`
      pasted into the SSO connection (Apple likewise). Email works
      without; the buttons fail until this is done.
    - [ ] Then delete the `pk_test_` startup warning in `src/lib/auth.tsx`
      — the swap also removes the accounts.dev pop-up during sign-up on
      the live site (dev instance had no first-party cookie there).
  - [ ] Onboarding copy note: sign-in has no first-run reward any more (there is
    no local data to migrate) — a new account starts empty by design.

## P2 · Later

**Event pages:**

- [ ] Decide what a *past* event page leads with. CodeRabbit flagged that the
  LIVE EVENT badge, ticket links and the sticky Buy Tickets bar still render
  after the show — deliberately unchanged in the tab-bar pass because it's a
  product call, not a bug: the log card already leads past pages, but a dead
  CTA under it reads sloppy. Probably: swap the buy bar for "log this show"
  and keep the resale link off past pages.

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
