# The social layer

*Written 2026-07-31. Design, not built. Read `docs/historical-concerts.md` first — most
of this is blocked on it in a way that is easy to miss.*

## What transfers from Letterboxd, and what doesn't

Three things transfer cleanly:

- **A log that is useful alone.** Letterboxd is worth using with zero followers. This
  is already true here: phase 0 shipped a private log and rating, and it works today.
- **The list as a first-class object.** "Best rooms in Seattle", "every gig of 2026".
- **A rating that means something because it sits next to hundreds of yours.**

One thing does not transfer, and it should drive the schema rather than being
discovered halfway through:

> **A film is watched by millions of people, separately, forever. A concert is
> attended by a few thousand people, together, once.**

Letterboxd's engine is that everyone can see the same object. 40,000 ratings of
*Heat* make a number worth reading. A Tuesday show at a 300-cap room has at most 300
people who can honestly review it, and realistically four of them are here. Reviewing
per-event, and stopping there, produces a product where almost every page has one
review on it or none.

So the aggregation unit cannot be the event alone. A review of one night is evidence
about three longer-lived things:

| rolls up to | the question it answers | how many reviews it gathers |
| --- | --- | --- |
| **artist** | are they good live? | every show, every city, every year |
| **venue** | is it a good room — sound, sightlines, staff, queues | every show ever held there |
| **tour** | is *this* run good | a few dozen nights |

That is the actual product, and it is *better* than Letterboxd's for this domain,
because "is this band worth seeing live" is a question people genuinely ask and
nowhere answers well. It also means the two-rating split already in the phase-0
schema — `rating` for the performance, `venueRating` for the room — was the right call
and is load-bearing, not a nicety. Those two columns are what let one log entry feed
two different reputations.

**Tour has no representation yet.** It is the one new entity this needs, and it is
inferrable rather than authored: an artist's shows clustered by date proximity, which
is roughly the grouping `looksLikeTourName` already tries to detect and reject from
venue names.

## Object model

Existing, and reused: `users` (Clerk mirror), `artists`, `venues`, `events`,
`user_lists` (the private on-device copies).

New:

```
reviews          id, user_id, event_id, artist_id, venue_id,
                 rating, venue_rating, body, visibility,
                 created_at, updated_at, edited_at, deleted_at
person_follows   follower_id, followee_id, created_at
lists            id, user_id, title, description, visibility, created_at
list_items       list_id, ref_kind ('artist'|'venue'|'event'), ref_id, position, note
reactions        user_id, target_kind ('review'|'list'), target_id, kind
comments         id, user_id, target_kind, target_id, body, created_at, deleted_at
reports          id, reporter_id, target_kind, target_id, reason, created_at, resolved_at
```

Four decisions inside that worth defending:

**1. `reviews` is a different table from the private log, not a `public` flag on it.**
The private log is a memory; a review is a publication. They have different lifecycles
(an edit history matters for one and not the other), different validation, different
deletion semantics, and different moderation exposure. They also live in different
places — the log is on the device with a `user_lists` copy, a review is server-owned
because other people read it. Trying to make one row be both is how you end up
accidentally publishing somebody's private note.

**2. `reviews` denormalises `artist_id` and `venue_id`.** They are derivable from
`event_id`, and they are copied anyway, because the roll-ups above are the main read
path and a two-hop join through `events` and a venue cluster on every artist page is
the query that gets slow first. It also keeps a review meaningful after its event row
is re-clustered, which the crawl does routinely.

**3. `person_follows` is a separate table from artist and venue follows, and needs a
different word in the UI.** "Follow" currently means two things in this app already
(artists, venues); a third would make the Following tab meaningless. See below.

**4. `deleted_at`, not deletion.** Comments hang off reviews and reactions hang off
both. Hard deletion either cascades away other people's writing or dangles. Same
anonymise-and-keep decision already made for `users`, for the same reason.

## The naming collision, which is a real product problem

Today: **Following** is a tab, and it holds artists and venues. Adding people to that
verb breaks the one piece of navigation the app has.

Options, with the trade-off stated:

- **"Friends"** for people, keep "Following" for artists and venues. Clearest, but
  "friends" implies mutual, and this graph is one-directional like Letterboxd's.
- **"Followers/Following" for people, rename the existing tab to "Artists & Venues"**
  — matches every other social app, at the cost of renaming a shipped tab.
- **Letterboxd's own answer:** people live on your profile, not in a tab. The
  Following tab stays exactly as it is, and the social graph is reached through
  **you**. Least disruption, and it also solves where the feed lives.

Recommend the third. It needs no renaming, and it puts the social graph behind a
profile tab that has to exist anyway.

## Privacy, which has to be decided before any of it is built

The phase-0 log is private, and people logged shows under that promise. That
constrains what can happen next:

- **Publishing is per-entry and opt-in, and never retroactive in bulk.** A "make my
  log public" switch that publishes 200 existing private entries — including the
  notes — is the kind of thing that ends a product's reputation in one afternoon.
- **`visibility` on the review, not on the user.** Per-entry is the only granularity
  that matches how people actually feel about this: happy to review the gig, not
  happy to publish "went alone, cried".
- **The private `note` field never becomes a review body implicitly.** If somebody
  wants to publish it they can copy it, deliberately.

## Was anyone actually there?

Letterboxd does not care whether you watched the film. Concerts are different in a way
that matters: a review is testimony about a one-time event, and a fake one cannot be
checked by anybody who wasn't there. Also, a lot of it will be about named
individuals' performances.

Options, cheapest first:

1. **Don't verify.** Fine at small scale, and it is where to start.
2. **Soft signal:** an entry logged *before* the show, or saved then logged, is
   plausible in a way that one back-filled years later is not. Free — we already have
   `savedAt` and `loggedAt` — and it can be shown as a quiet badge rather than a
   gate.
3. **Geolocation at the venue** during the show window. Strong, and the permission is
   already granted for discovery, but it means logging must happen at the gig, which
   is not when people do it.
4. **Ticket-email parsing.** Strongest and by far the most invasive; not worth it.

Recommend 1, with 2 as a display detail. Do not gate on any of them: a gate that
prevents somebody logging their own 2016 gig defeats the historical work entirely.

## Moderation is not optional, and it is coupled to the App Store

This is the part most likely to be discovered too late. **App Store Review Guideline
1.2** requires apps with user-generated content to have all of: a method for filtering
objectionable material, a mechanism to report it, the ability to block abusive users,
and published contact information. There is no partial credit, and #38 (app-store
prep) is already in flight.

Minimum before a single public review ships:

- report on every review and comment (`reports` above)
- block a user, and blocked users' content hidden both ways
- a way for us to hide a row without deleting it (`deleted_at` plus an admin route —
  `ADMIN_TOKEN` already gates the mutating admin surface)
- a published contact address and a content policy page — the server-rendered pages in
  `worker/src/page.ts` already give us somewhere to put them

**Consequence worth stating plainly: shipping the social layer and shipping to the App
Store are the same project.** Doing the social layer first and the store listing later
means a rejection; doing the store first and social later means a second review cycle.

## Phasing

Each phase is useful shipped alone, which is the test for whether the split is real.

**Phase A — profiles and the graph.** A profile page: handle, avatar, counts, and the
public parts of a log. `person_follows`, follow/unfollow, followers and following
lists. No reviews yet, so no moderation surface. Needs a **handle**, which is Clerk's
and which `me.post('/')` deliberately refuses to accept from the client — read it back
from the token claims.

**Phase B — public reviews.** `reviews`, with per-entry `visibility`, plus the whole
moderation minimum above. This is the phase that must land with the App Store work.

**Phase C — the roll-ups.** Artist live-reputation and venue-quality scores on pages
that already exist and already rank in search. Highest leverage in the whole document:
`/artist/[id]` and `/venue/[id]` are server-rendered and indexed, so "is X good live"
becomes a page that answers a question people type into Google.

**Phase D — the feed.** Fan-out-on-read: for each person you follow, their recent
public reviews, merged and sorted. At this graph size that is one indexed query and
it is fine; the note to leave for later is that it stops being fine somewhere around
a few hundred follows each, and that is when a materialised feed earns its complexity.
Do not build the materialised version first.

**Phase E — lists.** `lists` and `list_items`. Deliberately last: it is the most fun
to build and the least load-bearing, and shipping it before reviews gives people an
empty shelf to arrange.

## What this is blocked on

- **Phase A can start now.** It needs the handle and a profile route, nothing else.
- **Phases B and C need `docs/historical-concerts.md` to have landed.** Reviews of a
  catalogue with 19 days of history are reviews of nothing. This is the dependency
  most likely to be missed, because B looks independent and isn't.
- **Phase D needs B.** A feed of nothing is worse than no feed.

## Open, and Kyle's call

1. **The naming collision** — three options above, recommending profile-based.
2. **Does a contributed past show become a shared object?** Also open in the
   historical doc, because it decides whether that work drags the moderation
   requirement forward into it.
3. **Handle policy.** Clerk can supply usernames, and handles go in URLs and are
   effectively permanent. Reserved words, changes, squatting — decide before the first
   one is issued, because they are impossible to take back politely.
4. **Store-first or social-first?** They are the same project (see above), so this is
   really "which order do we accept the cost in".
