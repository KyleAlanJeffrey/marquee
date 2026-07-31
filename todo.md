# Marquee — TODO

## The brief

> I want to pivot a big part of this website to adding features for concerts I've
> been to with a rating of how the concert was, which is a page that other people
> can leave reviews on as well. Like Goodreads but for concerts and bands. This is
> gonna need some actual accounts to be made.
>
> — Kyle, 2026-07-30

That is the direction everything below is now sorted against, and the accounts are
not a footnote to it — reviews need durable identity, so **auth is a hard
dependency of the brief, not an enhancement of it**. It is being bought rather
than built: an off-the-shelf third-party service, chosen and being wired up now
(**Clerk** — the reasoning is under "Accounts" in the pivot section).

The full writeup — what gets rated, the data model, the account decision,
moderation, and the phased build order — is in the **P0 · Pivot** section below.

---

Local-first concert app. **Cloudflare stack:** Expo app → Cloudflare Worker (Hono)
→ D1 (SQLite). Ticketmaster + SeatGeek + Bandsintown for listings,
Spotify/Deezer/Wikipedia for artist detail. Follows/prefs on-device.
Production: **https://marquee.rocks**.

## How to read this file

- [ ] not started · [~] in progress · [x] done
- **P0** — serves the brief, or is being lost by waiting. Do these.
- **P1** — worth doing next, and nothing is bleeding while it waits.
- **P2** — real, but only once the pivot has shape. Includes anything needing
  money, a partner account or somebody else's approval.

Finished work isn't kept here — it's in the git log, where the reasoning sits next
to the diff that acted on it. This file is only what's left.

## Priorities

**P0 — in flight**

1. [x] **Reviews phase 0** — done in `365c9cd`. On-device "been to" log and
   private rating: a past event page asks "Were you there?", saying yes stores a
   full snapshot of the show, and two optional scores — the performance and the
   room — hang off it. New **Log** tab lists them newest night first, grouped by
   year, rateable in place. No accounts, no new tables, no moderation, and the
   copy says "only on this device" because that is the truth. What it still has
   to earn: whether anyone actually rates a show they've already been to.
2. [x] **Stop throwing the past away** — done in `71dff0d`. It was P0 for a reason
   worth remembering: history is only lost *once*, and every day the 24-hour drop
   stayed was a day nothing could re-fetch.
3. [x] **Check Setlist.fm** (phase 0.5) — checked 2026-07-31, and the answer is
   **no**. Their API terms forbid retaining copies of the data, restrict it to
   non-commercial use, and bar competing products; any one of those kills a
   backfill. Write-up under "The blocker nobody would guess". The consequence is
   the item below: **there is no importable past, so let people type one in.**
   - [ ] **Let people add a show that isn't in the catalogue.** Promoted from
     fallback to required. Needs `sameShow`/`sameVenue` matching against typed
     input, and a private-by-default decision so it needs no moderation on day one.
4. [~] **Accounts and auth — an off-the-shelf service, not ours to build.**
   **Clerk**, picked 2026-07-30; reasoning under "Accounts" below. Wiring starts
   now and is deliberately split around the keys, which arrive 2026-07-31:
   - [x] **Everything that doesn't need a key** — done in `78c7497`, reviewed and
     patched in `86582fc`. SDKs, provider, secure token cache, the Worker's
     verification seam, the D1 `users` mirror (migration 0009, applied to
     production 2026-07-31), `/api/me`. All of it inert while the env vars are
     unset, so an unconfigured build behaves exactly like today's no-account app —
     verified against production, not just locally: `GET https://marquee.rocks/api/me`
     answers 200 `{"signed_in":false,"configured":false,"user":null}`, a junk
     bearer token gets the same, and `POST` gets 401 `sign in required`.
   - [ ] **On the keys landing:** create the Clerk app, enable Apple + Google +
     Spotify, set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, and
     prove a token minted in Expo verifies in a Worker before building on it.

**P1 — next**

5. [ ] **App-store prep** — mine except the builds and submissions, which need
   Kyle's Apple and Google credentials.
6. [ ] **Reviews phases 1–3** — the past becomes first-class, then accounts, then
   public reviews. Each is a section below, in order.
7. [ ] **The venue-name bugs**, which are also SEO bugs: ingestion still writes
   tour titles into the venue column, and 240 rooms currently render as their town.

**P2 — later**

8. Event-coverage widening, ticketing partners, paid enrichment, the desktop
   layout, one palette. All below, none urgent.

**Cancelled 2026-07-30: the website/app split.** The two items under it that stood
on their own — a desktop layout for the server-rendered pages, and one palette
rather than two — moved to "Later". Everything else there is dropped.

---

## P2 · Venue pages — what's left after `ea978b9`

The page now has a room in it: a licensed photo hero, Wikipedia prose behind two
guards, a stat grid, genres, and a "recently played here" rail — with stats and
map still carrying the page when no article exists. The reasoning and the
22-venue measurement that calibrated the guards are in `ea978b9`; what remains:

- [ ] **Showbox SoDo keeps "The Showbox"**, a different room 2.3 km away under the
  same operator. Both guards pass, so this needs a rule about differently-named
  sibling rooms — or an explicit decision to accept it.
- [ ] **Support acts at that venue**, and a **"similar rooms nearby"** rail.
- [x] **Enrichment re-checks on a staleness window** (2026-07-31). An empty answer
  is re-asked after 30 days (articles get written), a found one after 180 (articles
  get renamed, rarely deleted) — `shouldRecheckEnrichment`, pinned in
  `enrichment.test.ts`. One guard the window made necessary: `fetchVenueEnrichment`
  answers EMPTY for "no article" and "Wikipedia was unreachable" alike, so a
  re-check that comes back empty over a row with prose keeps the prose and only
  advances the stamp.
- [ ] **Google Places** stays the paid alternative: one Place Details call buys
  photos, ratings *and* the venue's own website (see the costing further down).
  Worth it only if a billing account is ever justified.

## P1 · Bugs

- [~] **Artist and tour names stored as venue names — fixed on display, not at the
  source.** Handled in `195912b`: `looksLikeEventTitle` nulls the name wherever one
  leaves the Worker, and drops the row where a venue is the subject rather than a
  detail (the nearby rail, the city hub's venue list, which also fed the hub FAQ).
  Measured first, because it decided the approach: 7,340 venue rows, 1,054 carrying
  an event title, 283 of them cluster heads with upcoming shows — and **240 of
  those 283 are alone in their cluster**, so there is no correct name in the table
  to promote and no repair pass that could recover one. What's left:
  - [~] **Ingestion still writes them — but no longer at a good name's expense**
    (2026-07-31). The conflict-update was `name = excluded.name` unconditionally,
    and the crawl re-sends every venue on a 15-minute cycle, so a room's real name
    survived only until Bandsintown swapped it for the current tour's title. An
    event-title name now never overwrites a stored one (both directions validated
    against local D1: junk-over-real keeps real, real-over-junk replaces junk).
    Still open: a *new* junk-named row is still inserted rather than being mapped
    to the same-spot venue it means — that needs a lookup-before-insert restructure
    of `persist`'s hot path, and clustering already hides the row meanwhile.
  - [ ] **A dash-separated billing is not caught** and deliberately so —
    "PROGRESSIVE HOUSE NEVER DIED - Seattle" reads exactly like "The Eastern-GA" to
    a string rule. Pinned as a known miss in `dedupe.test.ts`; wants a source-side
    fix, not a blunter regex.
  - [ ] **A name we can't publish is a room we can't name.** 240 venues now render
    as their town. Reverse-geocoding the coordinates is the only route to a real
    name, and it's the same missing capability as the 29 placeholder-pinned rows.
- [x] **A town's own name no longer counts as distinguishing** (2026-07-31). The
  comparators drop the town's words when a caller knows the town, with the escape
  hatch the test suite demanded: token-identical names still match, because "Royal
  Oak Music Theatre" in Royal Oak is nothing *but* town words and stopwords, and
  dropping them split identical twins across a centroid. Measured before landing:
  11 of a 60-cluster sample with 3+ names had a pair sharing only city words
  ("Manchester Club Academy" / "O2 Ritz Manchester" / "O2 Apollo Manchester" as one
  row). The old wording here guessed "most of ~45"; the measured rate is lower.
- [x] **Chained venue clusters** (2026-07-31). `agreesWithCluster` in `dedupe.ts`:
  a candidate joins only if it agrees with every member already in the cluster that
  can be judged — tour-title members have no tokens to disagree with and rows
  without coordinates can't be distance-checked, so neither gets a veto, and a
  token-less candidate joins on location alone (stranding it would strand its
  show). Enforced at both clustering sites: `repairDuplicates`' full-table pass
  (which also retries the next-nearest candidate when a cluster refuses one) and
  ingest's cluster adoption, which checks the members the batch can see. Pinned
  with the real Dallas trio — and one correction to the old text here: "The Bomb
  Factory" *is* "The Factory In Deep Ellum" renamed, one room; Three Links up the
  street is the wrongly-chained one, and the test keeps the twins together while
  refusing it.
- [x] **`findExistingShows` no longer scans the venues table per listing**
  (2026-07-31). Cluster membership resolves once per batch — `clusterIdsByVenue`,
  two indexed reads chunked under D1's 100-bound-parameter ceiling — and each match
  clause binds a plain `in (...)`. Verified by ingesting the same 49-event artist
  twice: second pass matched every row, ingested 0, no duplicates.
- [ ] **Run `POST /api/admin/repair-duplicates` on production** now that the three
  cluster rules above are in: it is what re-evaluates existing clusters (Manchester,
  Dallas) under the new comparators. Needs `ADMIN_TOKEN`, so it is Kyle's to fire,
  cursor-paged (`afterArtistId`) until done.

## P0 · Pivot — concerts you've been to, and what you thought

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

**Resolved 2026-07-31** — the ingest keeps past shows, and the on-demand Bandsintown
backfill (`docs/historical-concerts.md`) fills roughly a decade of history for any
artist somebody asks about. Kept below as the record of why it mattered.

`sanitizeInputs` (`worker/src/data.ts`) drops any listing more than 24 hours old
on the way in, and the comment says why — "one already past is dead weight in a
table whose reads are all 'upcoming'". That was correct for a discovery app and it
is fatal for this one. Measured on production D1 on **2026-07-30** (`select count(*)
from events` split on `starts_at` against now, plus `min(starts_at)`): **17,742
upcoming events, 627 past ones, and the earliest is 2026-07-12** — about two and a half weeks of
history, and only because those rows aged out after being ingested while still
upcoming. Nothing deletes them, so history accumulates from here; but there is no
back-catalogue and no source currently wired that could provide one. You could not
log a gig you went to last year, which is most of what somebody would want to log
on day one.

Three ways out, and the choice shapes the product. **The first one is now closed**
— see below — which means the answer is 3 then 2, and the honest version of the
product is "your history starts now, and you can fill in the rest by hand":

1. ~~**Setlist.fm.**~~ **Checked 2026-07-31. It cannot be the back-catalogue.**
   It looked like the right answer — an archive of *past* concerts per artist, per
   venue, per date, free key, MusicBrainz ids to join on. Then I read the API terms
   ([setlist.fm/help/api-terms](https://www.setlist.fm/help/api-terms)), and three
   clauses each independently rule out the thing we wanted it for:
   - **No storage.** You may not "retain any copies of the Setlist.fm data, except
     for the purposes of retaining cached information for short periods", and you
     must "make direct server calls to the API … and distribute the Setlist.fm data
     to end users … immediately upon receipt". A backfill into D1 *is* retaining
     copies. This one is fatal on its own: the entire premise was populating our
     own past.
   - **Non-commercial only**, where "if the primary purpose of your application is
     to derive revenue, it is considered commercial". True of Marquee today, and
     the ticketing-affiliate item under "Ticketing & enrichment" is exactly the
     thing that would stop it being true. Building the past on a source we'd have
     to rip out the day the app earns a pound is a trap.
   - **No competing use.** setlist.fm already has attendance marking — its API even
     exposes `/1.0/user/{userId}/attended`. A public log of gigs you went to is
     arguably the product they offer. That is their call to make, not ours to
     assume, and it is a poor foundation.

   The join is weak anyway: their artist endpoints are mbid-keyed, and production
   D1 has an mbid for **712 of 3,359 artists (21%)** — and only as a by-product of
   Bandsintown embedding one (`rememberBitIdentity`, `worker/src/sources.ts:339`).
   The other 79% would need a name search per artist, which is the same fuzzy
   matching problem the venue clustering already fights.

   **What it is still good for:** a live-proxied setlist on a past show's page —
   fetched on request, attributed, linked without `nofollow` (their terms require
   both), never stored. That is a nice detail page, not a back-catalogue, and it is
   P2. It also stays off the table entirely once there's revenue.
2. **Let people add a show that isn't in the catalogue.** Unavoidable as a
   fallback — no source has everything, especially the DIY tier this app already
   struggles to cover. But a user-created event is a duplicate waiting to happen
   and a moderation surface, so it needs the same `sameShow`/`sameVenue` matching
   the ingest path uses, run against what the user typed.
3. **Only let people log shows Marquee already knew about.** Cheapest, ships
   soonest, and quietly says "your history starts now" — which for a brand-new
   product is more defensible than it sounds, and is what phase 0 already shipped.
   Its cost is now clearer than it was: with Setlist.fm out, this is not a stopgap
   ahead of a backfill, it is the floor. Every day the app runs is a day of
   catalogue it will have forever, and `71dff0d` is what makes that true — which
   retroactively makes that commit the most valuable thing in this list.

**So option 2 is no longer optional.** It was written above as an unavoidable
fallback; with no importable archive it is the *only* way somebody's first session
contains more than the fortnight of history we happen to hold. It moves up to
phase 1 and needs the design work its entry describes — `sameShow`/`sameVenue`
run against what the user typed, and a decision about whether a user-created past
show is public (a real event other people can log) or private to the log that
created it. Private-first is the safer default: it needs no moderation, and
promoting one later is easier than retracting one.

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

### Accounts — Clerk (decided 2026-07-30, keys arriving 2026-07-31)

Three constraints narrow this fast: no server to run (Workers only), no email
infrastructure (MailChannels stopped being free for Workers, so magic links mean
paying Resend/Postmark and owning deliverability), and App Store rules — if you
offer any third-party sign-in you must also offer Sign in with Apple, and you must
provide in-app account deletion.

Kyle asked for an off-the-shelf service rather than rolling sessions. **Clerk.**
What decided it, checked rather than remembered:

- **The Expo SDK is the binding constraint, and Clerk's is the strongest.**
  `@clerk/clerk-expo` 2.19.31 declares peers `react ^19`, `react-native >=0.73` —
  this repo is React 19.2.3 / RN 0.85.3, so iOS, Android and web come off one
  codebase. Most providers' React Native story is the weak one.
- **It verifies at the edge.** `@clerk/backend` 3.14.0 is a JWT-verification
  library, so the Worker checks a session against cached JWKS with no round trip
  per API call.
- **It already holds the `users` table.** Handle, display name and avatar are
  Clerk's, so D1 keeps a thin mirror keyed by Clerk user id rather than owning
  identity — and `deleted_at`, account deletion and the prebuilt profile screen
  come with it, which is Apple's in-app-deletion requirement satisfied for free.
- **Free tier is 50,000 monthly retained users**, which this will not trouble.
- **The one real limit to design around: 3 social connections on the free plan.**
  Apple + Google + Spotify is exactly three, with no room for a fourth without
  the $25/mo Pro plan. Pro is also what removes Clerk branding from the sign-in
  screen — worth budgeting for at launch, not before.

Runners-up, for the record: **Better Auth** (self-hosted on Workers + D1, no
vendor, but sessions, OAuth callbacks and the Expo integration all become ours)
and **WorkOS AuthKit** (generous free tier, weaker Expo story). **Supabase is
excluded on purpose** — this repo removed it in `302ac64` when the backend moved
to Cloudflare, and bringing it back only for auth re-adds the dependency that move
deleted.

Spotify stays in the plan as a connection, not just a login: it is thematically
right, already has credentials here, and lets a new account arrive with taste data
attached.

Still not optional the moment accounts exist: a privacy policy, terms, and a
decision about what happens to a deleted user's public reviews — anonymise and
keep, or remove. Anonymise-and-keep is the norm and is much kinder to the
aggregate scores.

#### The instance, and what arrived 2026-07-31

Kyle set up a Clerk app and handed over the publishable key. Decoding it names the
instance: **`kind-redfish-41.clerk.accounts.dev`**, a `pk_test_` development
instance. The key lives in `.env` (gitignored) and its name is in `.env.example`.
It is not a secret — a publishable key ships inside the client bundle by design,
names the instance and authorises nothing.

**Half-configured is the state we're in, and it is worth naming**: the client can
now load Clerk and sign somebody in, but the Worker has no `CLERK_SECRET_KEY`, so
it still verifies nothing and answers `configured:false`. A session would be real
in the app and invisible to the API. That is a *worse* state to leave sitting than
having no keys at all, because the app would look signed-in while every write 401s.

- [x] `CLERK_SECRET_KEY` — landed 2026-07-31, both halves (`.dev.vars` + production
  secret). The server has verified sessions ever since.

#### Measured state of the deployment, 2026-07-31

Checked rather than assumed, because the two halves of a Clerk setup fail in
opposite directions and neither one announces itself.

| Where | Publishable key | `CLERK_SECRET_KEY` |
| --- | --- | --- |
| local `.env` / `.dev.vars` | present | **absent** |
| production (marquee.rocks) | **absent from the bundle** | **absent** |

How each was established, so the next person doesn't have to re-derive it:

- The production web bundle (`/_expo/static/js/web/entry-*.js`, 2.99 MB) contains
  `ClerkProvider` 11 times but **zero** occurrences of the instance host
  `kind-redfish` or of the key body `a2luZC1yZWRmaXNo`. The one `pk_test_` hit is
  Clerk's own prefix constant (`s="pk_live_",l="pk_test_"`), not our key. So
  `authConfigured` is false in production.
- Confirmed by behaviour, not just by grep: `https://marquee.rocks/settings`
  renders sections `MARQUEE, REMINDERS, SEARCH RADIUS, BUILT BY` — **no ACCOUNT
  row**. Sign-in is unreachable in production today, and the gate is open, which
  is `OPEN_GATE` doing exactly what it was written to do.
- `GET https://marquee.rocks/api/me` → `{"signed_in":false,"configured":false,"user":null}`.

**The mistake worth writing down**: the publishable key was set as a Worker
*runtime secret* (`wrangler secret list` shows `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
alongside `ADMIN_TOKEN`, `INDEXNOW_KEY`, …). That does nothing. `EXPO_PUBLIC_*` is
read by Metro at **build** time and inlined into the bundle; a Worker runtime
binding is not visible to `npm run build`. The header comment in `wrangler.jsonc`
already says this — "EXPO_PUBLIC_* are build *variables*, not secrets" — it just
isn't where anyone looks while pasting a key into the dashboard.

- [x] Fixed by committing `.env.production` instead — see below. The dashboard build
  variable would also have worked; a tracked file was chosen because it survives a
  fresh clone and a fresh CI runner.
- [ ] **Kyle:** delete the runtime secret `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
  (`npx wrangler secret delete …`). It is inert and reads as if it were doing
  something.
- [x] `CLERK_SECRET_KEY` — set 2026-07-31, both halves:
  `.dev.vars` for local dev and `wrangler secret put` for the deployed Worker.

Order matters: the build variable alone gives a working sign-in whose sessions the
server ignores. The secret key alone gives a server ready to trust sessions nobody
can create. Both, and only then is there anything to sync.

#### The server trusts sessions now, 2026-07-31

`CLERK_SECRET_KEY` is in place. Verified against production rather than assumed:

- `GET https://marquee.rocks/api/me` → `{"signed_in":false,"configured":true,"user":null}`
- Same endpoint with `Authorization: Bearer not.a.jwt` → **`200`**, still
  `signed_in:false`. Garbage stays anonymous instead of 500ing, which is
  `callerFrom`'s "every kind of failure is the same failure" rule holding.
- `POST https://marquee.rocks/api/me` unauthenticated → **`401`**.
- Locally, `http://localhost:8787/api/me` → `configured:true`.

`wrangler dev` **does not reload `.dev.vars`** — the first local check still said
`configured:false` with the var already on disk. Restart the server after editing
it, or you will debug the wrong layer.

**A trap worth not stepping in:** `CLERK_AUTHORIZED_PARTIES` stays unset. Read the
installed `@clerk/backend` rather than guessing, and its check is
`if (!azp || !authorizedParties.includes(azp)) throw`. A *missing* `azp` throws as
hard as a wrong one, and only the web frontend reliably sends one — so an allowlist
of `marquee.rocks` would lock the iOS and Android apps out, presenting as a plain
"not signed in" with nothing in the response to say why. Set it only after
inspecting a real native token. Noted in `worker/src/auth.ts` next to the option.

**Prefix, for whoever copies from Clerk's dashboard next:** it hands out
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, which is the Next.js convention and is read by
nothing here. Expo inlines `EXPO_PUBLIC_*` only.

#### CodeRabbit on the gate: the loading window was a real hole

Reviewed `d2c1dd1` against `78c7497`, 29 files. **One finding, and it was right.**

The gate said `allowed: !configured || loading || signedIn`. The comment defending
`loading` argued that bouncing somebody mid-check is worse than letting a write
through — but that traded one wrong answer for another, and the window is not
small. Nothing wraps the tree in `ClerkLoaded`; `AuthProvider` renders children
straight into a live `ClerkProvider`, so the app is fully interactive while
`isLoaded` is false, and on web that answer costs a `/v1/client` round trip. A
signed-out user tapping Follow early kept the follow, or didn't, depending on their
network. A gate that fails non-deterministically is the worst kind.

So `loading` is now a third state, `pending`, and the write is **held** rather than
decided: `local-collection` parks the one most recent intent and, when the gate
answers, either applies it or denies it. Late, never wrong. What gets parked is
`applyAdd` and not the public mutator — replaying `toggle` after the wait could find
the item present by then and *remove* it, which is the one outcome nobody asked for.

Measured on a cold web load with the window forced open to 30s (a temporary patch,
reverted; dev-mode boot alone takes ~7s, which is why 6s wasn't enough to see it):

| page age | url | `marquee.follows.v1` |
| --- | --- | --- |
| 8.2s — tapped Follow while pending | event page | `[]` |
| 9.7s / 11.7s / 28.7s / 31.7s | event page | `[]` |
| 33.7s — window closed, held write refused | `/sign-in?why=follow%20artists` | `[]` |

No silent write and no premature bounce, which are the two things being traded
before. With the patch reverted, a cold load tapping Follow at 7.2s denies by 8.05s.

*(The "held write" described above was deleted later the same day with the rest of
the local store — see "No local storage at all". `account-lists.tsx` keeps the
`pending` state but simply refuses the write during the window instead of parking
it, since there is no longer a local list to park it in. The verification item that
sat here is moot.)*

#### Why the deploy had no accounts in it, and the fix, 2026-07-31

Kyle: "not seeing any deployed clerk account logic". Correct, and it wasn't a code
problem. Workers Builds rebuilt fine — the deployed bundle hash moved from
`entry-eff892b0…` to `entry-591381e0…` on the previous pushes — but that build had
no `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in its environment, so `authConfigured` came
out false and every account-shaped thing compiled itself out. Zero occurrences of
the instance host in a 3.0 MB bundle.

Runtime Worker secrets are **not** visible to `expo export`, which is now proven
twice over: the key had been sitting in Variables and Secrets across two rebuilds
and never reached a bundle.

**Fix: `.env.production`, tracked, with a `!.env.production` exception in
`.gitignore`.** A Workers Builds build variable would also have worked, but only in
that one dashboard — a fresh clone, a fork, or a new CI runner would build an
accountless app with nothing to indicate why. Expo's precedence keeps the dashboard
route open anyway: a real environment variable beats the file, so a build variable
or an `eas.json` `env` entry still wins where one exists.

Verified by building rather than by reasoning about it — `npm run build`, then
grepping `dist/_expo/static/js/web/entry-*.js`: key body present once, API origin
present once.

This also fixes native release builds, which `eas.json` never set the key for.

**On committing it to a public repo:** a Clerk publishable key is public by
construction. It is inlined into the bundle every visitor downloads, names the
instance and authorises nothing; the repo is not where it becomes visible. The one
real abuse angle is sign-up spam against the dev instance, and that instance has
CAPTCHA enabled. `CLERK_SECRET_KEY` is the half that matters and it is in neither
the repo nor the bundle.

**Deployed and confirmed**, bundle `entry-1a8c0a95…`:

- Key body present in the deployed bundle, and `window.Clerk` is defined on the live site.
- `marquee.rocks/settings` sections are now `MARQUEE, ACCOUNT, REMINDERS, SEARCH
  RADIUS`, with the row reading "Not signed in / NEEDED TO FOLLOW, SAVE AND LOG SHOWS".
- `marquee.rocks/sign-in` renders the Clerk card with three social buttons —
  `cl-button__apple`, `cl-button__facebook`, `cl-button__google` — plus email and
  password. Apple showed up on its own the moment Kyle enabled it; the screen
  renders whatever the instance reports, as designed.

#### No keyless mode any more (decided by Kyle 2026-07-31)

"Make all the logic as simple as possible as well. No logic for whether a key for
clerk is present or not. The website should fail if it isnt."

Every "are accounts switched on" branch is gone. What that removed:

- `authConfigured`, and the `AuthState.configured` field it fed.
- `AuthProvider`'s no-key path that rendered `children` with no Clerk at all, and
  the `SIGNED_OUT` default state that existed only to answer `useAuth()` in that
  case. `useAuth()` now throws outside its provider.
- `OPEN_GATE`, along with the paragraph arguing that an absent provider should mean
  "allowed". `useWriteGate()` throws outside its provider too.
- The `authConfigured ?` wrappers on the Profile ACCOUNT section and on both
  sign-in screens, including two copies of "Accounts aren't switched on in this
  build".
- Server side: `CLERK_SECRET_KEY` is a required `Env` field rather than optional,
  `callerFrom` no longer has a `!secret` branch, and `/api/me` no longer returns a
  `configured` flag. The test asserting the keyless path was deleted rather than
  reworded — it pinned behaviour for a configuration that is no longer supported.

The gate simplified along with it: `allowed: !loading && signedIn`,
`pending: loading`. No `configured` term in either.

`tsc` clean, 215 tests in 14 files (was 216 — the deleted one).

**One platform difference is real and is not the landing page.** Native
`sign-in.tsx` uses Clerk's hosted flow (`useHostedAuth`); web `sign-in.web.tsx` uses
Clerk's prebuilt `<SignIn>`/`<SignUp>` components, which do not exist on native.
Same entry points, same gate, same copy — different last mile, because Clerk ships
different tools for each. Everything else about accounts is now identical by
construction, since there is no longer a branch that could differ.

#### No local storage at all: everything is account-bound (Kyle, 2026-07-31)

> "Don't have any local storage, make all of it account bound. It doesn't need to be
> backwards accountible"

**This supersedes the sync design in the section below.** That section is left standing
because the reasoning is worth keeping — it is why this decision is an improvement and
not just a different shape — but the pull-once policy, the union merge and the
device/account reconciliation described there no longer exist.

**Deleted, not refactored:**

| gone | it existed to |
| --- | --- |
| `local-collection.tsx` | hydrate lists from AsyncStorage and defend the read window |
| `list-sync.tsx` | reconcile a device copy with the account copy |
| `list-merge.ts` + its spec | union two copies without losing anything |
| the `mergeStored` suite in `stores.test.ts` | pin that union |
| five store providers + `<ListSync />` in `_layout.tsx` | hold all of the above |
| the `@react-native-async-storage/async-storage` dependency | be the disk |

Also gone with them: `replaceAll`, the `superseded` flag, `dropped`, `readOk`,
`writable`, the "a failed read must not be treated as an empty list" guard, and the
whole class of bug where a device and an account disagreed about what you had.

**What replaced it.** `account-lists.tsx`: one React Query entry (`['me-lists']`) that
`GET /api/me/lists` fills, so a cold start costs **one** round trip for all four lists
rather than four. Writes are optimistic — a follow button that waits for a round trip
feels broken — and roll back on failure, because a silent optimistic failure is worse
than a visible one: the user believes it saved. Each write `PUT`s only its own key, and
the route writes only the keys it is given, so two lists changing at once cannot clobber
each other.

Prefs moved too, since they were the last thing on disk: `radius_miles` and
`reminders_enabled` are columns on `users` (migration 0012) rather than another
`user_lists` row, because they are two scalars and not a list — and `kind` in
`user_lists` is a CHECK constraint SQLite can't extend without rebuilding the table.

**The trade, stated rather than discovered later:** the lists now need a network and an
account. Offline reads and instant cold starts are gone. Browsing, search, town pages
and every detail page are untouched — none of them were ever account-bound — so what
you *keep* needs somewhere to keep it, and what you *look at* does not.

**One import trap, hit for the second time and now fixed properly.** The store files
became React hooks reaching `@/lib/auth` → `@clerk/expo` → `react-native`, which does
not parse in a Node test run, so `stores.test.ts` and `worker/test/lists.test.ts` both
failed on `Unexpected token 'typeof'`. No vitest config fixes it — the offending module
is `react-native` itself. The shapes and validators now live in **`list-schemas.ts`,
which imports nothing**, and the stores re-export them so no call site changed. Same
split as `write-gate.tsx`, and the reason is written at the top of the file this time.

Verified in the browser with stale local data seeded on purpose:

| check | result |
| --- | --- |
| signed out, `/settings` | **zero** `/api/` requests |
| seeded `marquee.prefs.v1` of 10 miles | ignored — shows the 50-mile default |
| seeded `marquee.follows.v1` entry | invisible on `/following`, still on disk |
| radius pills signed out | all four `disabled`, with a note saying why |
| `npm run build` | succeeds; bundle contains **0** references to async-storage |

A signed-out control that silently does nothing is the failure this session kept
avoiding, so the pills and the reminders switch are disabled with an explanation rather
than left tappable.

- [ ] **Sign-in has no first-run reward now.** Previously signing in merged a month of
  local use into the new account. There is nothing to migrate any more, so a new account
  starts empty by design — worth knowing before writing onboarding copy that promises
  otherwise.
- [ ] **Not verified end to end**, same reason as before: writing to the account needs a
  real session and creating one isn't something I can do. Sign in, follow an artist,
  reload, and confirm it is still there; then check `/settings` remembers a radius.

#### The device-sync interlude (2026-07-31, built and deleted the same day)

For a few hours the lists lived on the device with a server copy synced behind them:
a pull-once-per-device policy, a union merge for first sign-in, and a shared-phone
branch. CodeRabbit reviewed it (five findings; the critical one — a stale closure
that silently reverted writes made during the sync round trip — was real and got
fixed) and then the whole layer was deleted when Kyle decided nothing lives locally.
Two decisions from that interlude still stand:

- `user_lists` **stores a JSON document per list, not four relational tables.** The
  job is portability, not querying; `0010_user_lists.sql` records when to stop —
  the moment a list is read by anyone but its owner. Reviews are a different table.
- The multi-device story is now trivially correct *because* there is no local copy:
  every device reads the same server row. The tombstones-and-versions work the sync
  would have needed is no longer needed by anything.

- [ ] **When a production Clerk instance exists:** put its `pk_live_` key in
  `.env.production` and delete the startup warning that exists to nag about not
  having done it.

#### CodeRabbit on the Clerk work: two findings, both acted on

Reviewed `d2c1dd1..1819bbd`, 16 files.

**1. `.env.production` ships a `pk_test_` key** — accepted the risk, rejected the
prescription. It advised removing the value so builds fail loudly instead of falling
back to the development instance. But there is no production Clerk instance to point
at, and accounts are required now, so an empty value doesn't fail *loudly* — it
throws at startup and takes the site down. That is the exact state Kyle reported
twenty minutes earlier ("not seeing any deployed clerk account logic"). The real
complaint underneath is **silence**, and the key says which instance it is, so
`src/lib/auth.tsx` now warns on startup when a release build is running on a
`pk_test_` key. Noisy, and still deployable.

**2. Nothing tested the missing-`CLERK_SECRET_KEY` path** — accepted, and it exposed
that the earlier "no keyless mode" pass was incomplete. Making the field required in
`Env` was a *compile-time* claim only; at runtime `verifyToken` threw, the catch
swallowed it, and every caller came back anonymous. So the server still did the thing
Kyle had asked to remove: looked healthy while quietly treating everybody as signed
out. `callerFrom` now throws when the secret is absent, asserted by a test.

Safe to be that blunt because the blast radius was checked rather than assumed:
`callerFrom` is called only from `/api/me*` and `/api/me/lists`. A deploy that loses
the secret 500s the account endpoints and leaves browsing, search and every page
working.

- [x] **Lint error fixed**, `src/app/event/[id].tsx` — `Date.now()` in the component
  body tripped `react-hooks/purity`. Now a `useNow()` hook with a lazy `useState`
  initializer, so the clock is read once per mount. Two wrong turns on the way,
  both worth remembering: an effect calling `setNow` trades `purity` for
  `react-hooks/set-state-in-effect`, and moving the call into a module function
  only hides it from the linter without making it pure. `expo lint` now reports
  nothing at all, which it hadn't for a while.

#### The gate: browse open, keeping gated (decided by Kyle 2026-07-31)

Asked how hard the account requirement should be, Kyle chose **gate saving, allow
browsing**. Search, explore, town pages and every detail page work signed out;
following an artist or venue, saving a show and logging one you went to do not.

Enforced in **one place** — `write-gate.tsx` plus the four mutators in
`local-collection.tsx` — rather than at each button, because all four lists are the
same `createCollection`. That gates the eight-odd screens that call them today and,
more usefully, the ninth written later by someone who never read this file.

Two rules inside it worth keeping:

- **Removals are never gated.** Somebody who used the app before accounts existed
  still has their lists; locking them out of their own delete button would be a bug
  wearing a policy's clothes. You need an account to keep things, never to stop.
- **No key means no gate.** With `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` unset the gate
  is open, so a fork or a local run behaves exactly as the app did before accounts.
  Failing closed would turn a missing env var into an app where nothing saves and
  nothing says why.

Verified on web signed out: tapping "Were you there?" routes to
`/sign-in?why=log%20the%20shows%20you%27ve%20been%20to` and
`marquee.attendances.v1` stays `[]` — the write is refused, not silently dropped.

**What this does *not* yet do:** the data still lives only on the device. Signing in
unlocks the button; it does not yet sync anything or make it portable. That half
needs the Worker to trust a session, so it is blocked on `CLERK_SECRET_KEY`.
*(Unblocked and built the same day — see "The lists follow the account now" below.)*

- [x] **Server-side storage for the four lists** — done 2026-07-31, see below.

#### The instance is configured wrong for iOS (found 2026-07-31)

Read off the instance rather than assumed
(`GET /v1/environment` on `kind-redfish-41.clerk.accounts.dev`), confirmed by what
the sign-in screen actually renders:

- **Enabled:** email + password (verified by `email_code`), **Facebook**, **Google**.
- **Not enabled:** **Apple**, **Spotify**.

Two consequences:

1. **This would be rejected from the App Store.** Offering Google and Facebook while
   not offering Sign in with Apple is exactly what guideline 4.8 forbids. Apple is
   not optional here — it is the price of the other two.
2. **Facebook was never in the plan and it costs one of only three slots.** The free
   tier allows 3 social connections; Apple + Google + Spotify was already exactly
   three. Facebook occupying a slot means something planned can't have one.

- [x] **Apple enabled** — Kyle added it 2026-07-31; re-read the instance and the live
  sign-in card now renders `cl-button__apple` alongside Facebook and Google. The
  guideline-4.8 blocker is cleared.
- [ ] **Kyle, still open in the Clerk dashboard:** the free tier's three social slots
  are now Apple + Facebook + Google. If Spotify is still wanted, Facebook has to go.
  No code change either way — the sign-in screen renders whatever the instance
  reports, which is checkable without the dashboard:
  `GET https://kind-redfish-41.clerk.accounts.dev/v1/environment?__clerk_api_version=2025-04-10&_clerk_js_version=5.100.0`
  → `user_settings.social`.

Also visible and expected: "Secured by Clerk" and a "Development mode" badge. The
first goes away on the $25/mo Pro plan, the second when a production instance
replaces this `pk_test_` one.

#### Package correction: `@clerk/expo`, not `@clerk/clerk-expo`

Clerk's own current Expo guide (the one Kyle sent) installs **`@clerk/expo`**.
That is the maintained line — **4.1.2**, against `@clerk/clerk-expo`'s 2.19.31,
which is not marked deprecated but has clearly stopped moving. Peers check out
against this repo: `expo >=54 <58` (we're 56), `react ^19`, `react-native >=0.75`,
`expo-secure-store >=12.4.0`. Migrated on 2026-07-31, and it deletes code: the
package exports a `tokenCache` from `@clerk/expo/token-cache`, so the hand-rolled
SecureStore wrapper in `src/lib/auth.tsx` is gone.

#### Where the guide does *not* fit Marquee

The quickstart is written for an app where being signed in is the point. Two of its
steps would be actively wrong here, so they are deliberately not being followed:

- **It gates the whole app.** Its `(home)/_layout.tsx` does
  `if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />`. Marquee is
  browse-first: exploring, following, saving, reminders and the private log all
  work signed out and must keep working that way. Sign-in is for *publishing*, so
  the gate belongs on the write, not on the app.
- **It builds email/password flows.** We are not doing email/password — there is no
  email infrastructure (see the constraints above), which is most of why Clerk was
  bought. It's Apple + Google + Spotify OAuth, which is a different custom flow.

What *does* transfer directly: `<ClerkProvider publishableKey tokenCache>` at the
root (already done, in `src/lib/auth.tsx` rather than `_layout.tsx` so the keyless
path stays possible), and `useAuth` / `useUser` / `useClerk().signOut`.

- [x] **Day one with the secret key happened 2026-07-31:** `CLERK_SECRET_KEY` is on
  the Worker, Apple + Google are enabled (Spotify pending a free slot — see above),
  and the server verifies sessions. The one un-run confirmation is a token minted in
  the *native* app verifying in the Worker; web is confirmed by construction.

### Moderation, because public writing invites it

- Rate limits per account and per IP on writes, plus a minimum account age.
- Report → queue → hide/remove, with an audit trail. `ADMIN_TOKEN` already gates
  the mutating admin routes, so the queue has somewhere to live.
- A **verified attendance** signal is the strongest quality lever available, and
  only one of the two ways to get it is cheap. Logging the show *before* it
  happened is free and already implied by the data model — a timestamp comparison,
  nothing new collected. Being *inside the venue's radius that night* is not: it
  needs background location from an app whose entire pitch is that it collects
  nothing, it is trivially spoofed by anyone who cares to, and it would need
  explicit opt-in, a stated retention window, deletion on request and a coarse
  enough precision that the log isn't a movement history. Ship the first, and
  treat the second as a separate decision with its own privacy write-up — not as a
  free upgrade to it. Either way "verified" must mean one specific thing on screen,
  because a badge whose meaning is vague is worse than no badge.
- Reviews of shows that haven't happened yet must be refused outright.

### SEO, which this is very good for

This is the first content on the site that is genuinely unique rather than
assembled from feeds, which is exactly what the ranking work has been missing.
`Review` and `AggregateRating` JSON-LD are well supported and make a page *eligible*
for review rich results — eligibility is all any markup buys; whether stars are
drawn is Google's call, per page, and it changes. Two hard rules: the markup must describe real reviews (fabricated or
self-serving review markup is a manual-action category, not a ranking nudge), and
review pages with no reviews yet must be `noindex` like the other thin pages
already are, or this adds thousands of empty URLs to a sitemap that was just
cleaned up.

### Build order

- [x] **Phase 0 — prove the interaction with no accounts and no new tables.**
  Shipped in `365c9cd`. "Were you there?" + two private ratings, stored on-device
  in the existing `local-collection` store next to follows and saved shows, and a
  **Log** tab that is a personal history. Two decisions worth keeping: the stored
  row is a *snapshot* of the show rather than an event id, so a log entry outlives
  the event falling out of the database (and survives phase 1 rewriting how the
  past is stored); and the performance and the room are scored separately, because
  a great band in a bad room is the review people actually want to leave. It
  answers the only question that matters — whether anyone logs shows at all —
  before anything irreversible is built.
- [x] **Phase 0.5 — check Setlist.fm properly** before designing around it. Done
  2026-07-31, and it came back negative: their terms forbid retaining the data, so
  there is no backfill to be had. Details above. The good news is that it was a
  day's reading rather than a month's integration, which is the whole reason this
  was a phase of its own.
- [x] **Phase 1 — the past becomes first-class.** `sanitizeInputs` loosened per-call,
  read paths state their own `starts_at > now`, and the history backfill fills the
  past on demand. Residual: a past-show *page* worth reading (setlist, who else was
  there) belongs to phase 3, not here.
- [x] **Phase 2 — accounts.** Clerk end to end: verified caller on the Worker, a
  `users` mirror, `/api/me`, the write gate, the four lists and both prefs on the
  account, sign-in on web (Clerk components) and native (hosted flow), Apple +
  Google live. The "migrate the device's log up on first sign-in" reward was
  overtaken by events — there is no device log to migrate any more. Residual for
  phase 3: handles, account deletion, privacy policy, terms.
- [x] **Past-show discovery — built 2026-07-31.** `POST /api/artists/:id/history`,
  `GET /api/artists/:id/past-events` and `PastShowsPicker` on the artist page. See
  `docs/historical-concerts.md`; this is what took the catalogue from 19 days of history
  to roughly a decade.
- [ ] **Phase 3 — public reviews.** Write, edit, report, moderate; verified
  attendance; aggregates with a confidence floor; the three read surfaces.
- [ ] **Phase 4 — the social part.** Follow people, a feed of what friends saw,
  year-in-review. Only worth it once phase 3 has content in it.

**Both are designed now, in their own documents** (2026-07-31), because they turned
out to rest on a fact worth its own writeup:

- **[`docs/historical-concerts.md`](docs/historical-concerts.md)** — the catalogue has
  **19 days of history**. Production D1: 22,675 events, **623 in the past**, earliest
  `2026-07-12`. Every source sells tickets, and nobody sells tickets to last year, so
  somebody with 200 gigs behind them can log **none** of them. For a product whose
  loop is "log what you've seen" that is a blank page where the value goes.

  **Then the cheap experiment got run, and it changed the plan.** Bandsintown answers
  for past dates — `date=past`, `date=all`, explicit ranges — and across **eight
  artists drawn at random from our own `artists` table, 8 of 8 returned history**,
  averaging ~137 past events each, back to a floor around 2014 — RUSH came back with a
  2013 show, so the horizon moves per artist. Obscure ones
  included: Marti Jones, 20 shows, 2014–2019. Crucially **~99.6% carry coordinates**
  (1,088 of 1,092), so they join to our 2,891 venue clusters through the same
  proximity path the live crawl already uses, and Bandsintown keys by *name* — so the
  23%-MBID problem that sank Setlist.fm doesn't apply here. Checked for a silent cap
  and found none: Radiohead reads 0 for both 2015 and 2019, which is correct rather
  than broken.

  So the plan is **on-demand backfill, not contribution**: the first person to ask
  about an artist pays for one fetch, which keeps ~half a million rows off a cron
  budget already tight on CPU. User contribution shrinks to pre-2014 and rooms
  Bandsintown doesn't know; Setlist.fm drops to a maybe and MusicBrainz drops off.

  The wedge that makes it cheap is already built: the log renders purely from its own
  snapshot — no `useEvent`, no fetch, not revalidated — so **a logged show does not
  need a row in `events`**, and the picker is new rows behind an existing surface.

- **[`docs/social.md`](docs/social.md)** — the object model, and the structural
  difference that has to drive it: a film is watched by millions separately, a concert
  by a few thousand once. Per-event reviews alone give almost every page one review or
  none, so reviews have to roll up to **artist** (are they good live), **venue** (is it
  a good room) and **tour**. That makes phase 0's two-rating split load-bearing rather
  than a nicety, and it makes phase C the highest-leverage work in the plan, because
  `/artist/[id]` and `/venue/[id]` are already server-rendered and indexed.

  Two things in there that are easy to find out too late:

  - **Shipping the social layer and shipping to the App Store are one project.**
    Guideline 1.2 requires filtering, reporting, blocking and published contact info
    for any UGC app, with no partial credit, and #38 is already in flight.
  - **Phases B and C are blocked on the historical work** even though they look
    independent. Reviews of a catalogue with 19 days in it are reviews of nothing.
    Phase A (profiles and the person graph) is genuinely unblocked and can start now.

- [ ] **Decisions in those documents that are Kyle's, not mine:** what "follow" should
  mean now that it would cover artists, venues *and* people (recommendation: people
  live on a profile, not in the Following tab, which renames nothing); whether a
  contributed past show is private to the logger or a shared object (it decides
  whether moderation gets pulled forward); handle policy, since handles go in URLs and
  are effectively permanent; and store-first or social-first.

Review pages are public server-rendered content, so they land on the same
`shell()` path the city hubs already use — `worker/src/detail.ts` is the awkward
one, since it injects markup into the app shell and rewrites
`__EXPO_ROUTER_HYDRATE__` to stop the bundle clearing it. Phase 3 is the moment
that trick either gets removed or gets a second consumer.

## P1 · Ship it to the stores

Kyle runs the builds and submissions (they need his Apple and Google credentials);
everything else is mine.

**Blocked 2026-07-31: the EAS project id doesn't belong to the logged-in account.**
`eas init --id a9540056-1ade-460c-bc4f-5b93ccae1c61` wrote the id into `app.json`
and then failed reading the project: `Entity not authorized:
AppEntity[a9540056-…] (viewer = RegularUserViewerContext[0c3a767c-…], action =
READ)`. `eas whoami` is `kylejeffrey@stoutagtech.com`, whose accounts are
`kyle_jeffrey` and `stout-agtech` — and since that login is Owner on both, the
project must live under a third account it isn't a member of. Every EAS command
fails until that's resolved, and only Kyle can resolve it: either `eas login` as
the account that owns the project, or hand over an id from one of these two.
Nothing else in this section depends on it.

- [x] **`eas.json`** — done. `preview` (internal distribution, APK on Android) and
  `production`, `appVersionSource: remote` so build numbers aren't committed, and
  `EXPO_PUBLIC_API_URL=https://marquee.rocks` in both native profiles — relative
  URLs don't resolve off-web, so a native build with it unset talks to nothing.
  No `development` profile yet: it wants `expo-dev-client`, which isn't installed
  and is its own decision alongside `expo-updates`.
- [~] **`app.json` gaps that block a build:** `ios.bundleIdentifier` and
  `android.package` are both `rocks.marquee` now — the reverse-DNS of a domain we
  own, which is also what universal links will want later — and
  `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` is set, so export
  compliance isn't asked on every submission (true: the app does HTTPS and nothing
  else cryptographic).
  - [x] **Android notification icon** — done 2026-07-31.
    `assets/images/notification-icon.png`, 96×96 (24dp at xxxhdpi), white on
    transparent, wired up as `["expo-notifications", { icon, color: "#2fff6a" }]`.

    A resize alone would have been wrong, and measuring first is what caught it:
    `android-icon-monochrome.png` is 1024×1024 but its glyph only occupies
    **356×318 at (334,353)–(689,670) — 4.1% of the canvas**. Scaling that straight
    to 96px puts a 33px speck in the middle of a 96px frame, which in a status bar
    is a smudge. So it is cropped to the alpha bounding box first, then fitted into
    80×80 and centred on a transparent 96×96, which brings coverage to **28.5%**.

    Checked rather than assumed, in both directions: the output's own alpha bbox
    reads back as 80×71 at (8,13), it has zero fully-opaque non-white pixels, and
    it was rendered nearest-neighbour on `#131315` and looked at — the Marquee
    frame-and-soundbars mark, intact. `npx expo config --type public --json`
    confirms the plugin entry resolves and the file is on disk.

    Worth knowing rather than fixing: the mark is a thin outline, so at 1x density
    it will be delicate. That is the logo's property, not this asset's.
- [x] **Block background location explicitly** — `blockedPermissions:
  ["android.permission.ACCESS_BACKGROUND_LOCATION"]`. The app asks for foreground
  location only (`Location.Accuracy.Balanced`,
  `requestForegroundPermissionsAsync`), and Play review reads the manifest, not
  the intent.
- [x] **Privacy declarations — drafted, and the code changed to match**
  (2026-07-31, `docs/privacy-declarations.md`). The draft's premise got an upgrade
  before it was written down: coordinates used to travel as `?lat=&lng=` query
  strings (request logs), and since accounts landed every request also carried the
  bearer token — location and identity in one request. Both `/nearby` routes are
  POSTs now, and every coordinate-carrying call goes out **anonymous** (no
  Authorization header; `RequestOpts` in `src/lib/api.ts`), so the server cannot
  link who to where even accidentally. The doc is the answer key for the Apple
  nutrition label and Play Data Safety forms, claims verified by grep and named so
  they can be re-checked at submission.
  - [ ] Still blocking a signature: an in-app **account deletion** entry point
    (required by both stores now that accounts exist) and a hosted **privacy
    policy page** for the forms' URL field.
- [x] **Store listing copy — drafted** (`docs/store-listing.md`): names, subtitle,
  description, keywords, promo text, all inside the stores' limits.
  - [ ] Screenshots (needs the simulator and seeded data), Play feature graphic,
    and the `expo-updates` decision (not installed → no OTA channel; adding it
    buys same-day JS fixes at the cost of a runtime-version policy).
- [ ] **Then the website advertises the app**: store badges on `/`, and a smart
  banner on the web pages rather than "Open the app" pointing at a bundle the
  visitor is already inside.

## P2 · Event coverage — remaining phases

Order still matters: canonical shows/venues before any crawl widening, or the
crawl multiplies duplicates instead of coverage.

- [ ] **Watch the first production crawl runs for CPU/subrequest limits** (the free
  plan is tight) and raise `CRAWL_BATCH` if there's headroom. The same look
  decides whether `SG_MAX_PAGES` can go past 3 — a sweep is 3 pages × 100 events
  soonest-first while a dense metro has ~600 concerts within 25 miles, so a sweep
  reaches the soonest ~300 and everything past that is invisible until it comes
  closer. Where the cut-off lands in *time* isn't known and depends on the metro —
  worth measuring before deciding 3 pages is enough.
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

## P2 · Ticketing & enrichment

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
- [ ] **A desktop layout for the server-rendered pages.** `worker/src/page.ts`
  renders one narrow column because it grew out of a mobile-first landing page,
  while the reference (`souls_of_mischief_venue_details/`) is a desktop document:
  masthead with real nav, full-bleed hero, two-column body, footer with columns.
  Survives the cancelled split — the hubs and the landing page are desktop pages
  either way.
- [x] **One palette, one source** (2026-07-31). The colours moved to
  `src/constants/palette.ts` — a module that imports nothing — and both consumers
  build from it: `theme.ts` for the app, `worker/src/page.ts` interpolating the
  `:root` block for the server pages. Wrangler bundles the cross-boundary import
  fine. The move caught the drift it exists to prevent: `--line-str` had already
  slipped to `.18` against the app's `0.20` borderTop.

## Operational — not fixable in this repo (Kyle's, not mine)

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
  every Worker request failed — which rules out the payload and is consistent with
  an origin-level limit on Cloudflare's shared Worker egress addresses, though
  nothing here proves that is the mechanism. Next: Bing's authenticated URL Submission API (per-site
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
- **One `source='seed'` venue row is still in production.** The dev seed named its
  venues after real rooms, so after clustering "The Catalyst" ended up the *head*
  of a cluster carrying three real Santa Cruz shows. `venue_id` is
  `on delete set null`, so removing it would strip those shows of their venue
  entirely — `unseed.sql` now refuses to (`77f2be3`). It is a duplicate row inside
  a correct cluster, which costs nothing visible; `repair-duplicates` is what
  eventually tidies it.
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
