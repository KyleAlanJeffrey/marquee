# Historical concerts

*Written 2026-07-31. The numbers are from production D1, not estimates.*

Marquee is pivoting to "Goodreads for concerts". The log is the product: what you
have seen, what you thought of it, who else was there. This document is about the
single fact that decides whether that product can exist, and what to do about it.

## The problem, measured

```
events_total       22,675
events_past           623
earliest_event   2026-07-12
artists             3,771   (881 with an MBID — 23%)
venues              8,937   (2,891 canonical clusters)
```

**The catalogue has 19 days of history.** It begins the day the crawl began, because
every source — Ticketmaster, Bandsintown, SeatGeek — sells tickets, and nobody sells
tickets to last year. 623 past events exist only because shows that were upcoming
when we ingested them have since happened.

Now put a real user in front of it. Somebody who has been going to gigs since they
were seventeen has a few hundred nights worth logging. They can log **none of them**.
Not "few" — the rows do not exist. The app asks the one question it exists to ask and
cannot accept the answer.

This is not a data-quality problem to be improved later. For a product whose core
loop is "log what you've seen", a catalogue with no past is a blank page where the
value is supposed to be. Letterboxd works because TMDB already contains every film;
Goodreads works because ISBNs already exist. **There is no TMDB for concerts.** That
absence *is* the moat if it gets solved, and the reason the category is thin.

## What already works, and is easy to miss

The phase-0 log does not depend on the catalogue at all.

`src/lib/attendances-store.tsx` stores a full snapshot per entry — artist name, venue
name, city, start time — and `src/app/(tabs)/log.tsx` renders from that snapshot with
no fetch, no `useEvent`, no revalidation. That was written for offline speed and to
survive event rows being repaired or re-clustered. It has a much more useful
consequence:

> **A logged show does not need to exist in `events`.** Give an entry a synthetic id
> and a snapshot and today's log screen renders it, syncs it, and rates it, with no
> client change at all.

So the catalogue gap blocks **discovery** of past shows, not **logging** them. That
splits one impossible problem into two tractable ones, and it means the first
increment ships without any new ingestion.

It also means the sync built today already carries historical entries: the
`attendances` payload is snapshot-shaped, and `worker/test/lists.test.ts` pins that
shape on both sides.

## The sources, honestly

### Setlist.fm — was the only candidate, now the pre-2014 one

*(Written before the Bandsintown result below, and left standing because the reasoning
still holds — it is just answering a smaller question now.)*


~7M setlists going back decades, contributed by the exact people we want. It is the
closest thing to a concert TMDB that exists.

It was examined earlier this session and **rejected for bulk ingestion**, for two
reasons that have not changed:

1. **The API terms.** Read rather than assumed: they do not permit building a
   competing database out of the feed. Ingesting it wholesale is the thing they
   forbid most specifically.
2. **The join is weak.** Setlist.fm keys artists by MusicBrainz MBID, and only
   **881 of 3,771** of our artists (23%) have one. Even with permission, three
   quarters of the catalogue would not match.

What was *not* assessed, and should be, is a different integration shape: a
**user-initiated lookup** at the moment of logging — "I saw Radiohead, roughly June
2016" → query their API for that artist's dates → user picks one → we store our own
snapshot and attribute the source. That is a search box, not a database clone, and
it is how most of their licensees use it. It needs their terms re-read with *that*
question in mind, and probably an email. **Do not assume the earlier rejection
covers it; it answered a different question.**

### MusicBrainz events

Has an event entity with venue and date. Coverage is thin and skewed to notable
shows. Free, permissive licence (CC0), and shares the MBID keying problem. Worth a
measured coverage check rather than a guess: pick 50 gigs a real person would have
been to and see how many resolve.

### Wikidata / Wikipedia

Tours and famous concerts. Good for "Oasis at Knebworth", useless for a Tuesday at
The Showbox. Not a catalogue.

### Songkick

Had exactly this data. The public API is closed to new keys. Not available.

### Bandsintown past events — **run, and it works**

This was written as "a five-minute experiment nobody has run". It has now been run,
and it is the answer.

`GET /artists/{name}/events?date=past`, `date=all`, and explicit ranges
(`date=2015-01-01,2016-12-31`) all return past events. Measured against **eight
artists drawn at random from our own `artists` table**, not hand-picked:

| artist | past events | range | with coordinates |
| --- | --- | --- | --- |
| Big Richard | 308 | 2022-02 → 2026-09 | 308 |
| Bilmuri | 235 | 2018-08 → 2026-10 | 235 |
| KANA-BOON | 240 | 2017-10 → 2026-10 | 240 |
| Radiohead | 101 | 2014-07 → 2025-12 | 98 |
| Alex Isley | 70 | 2015-12 → 2026-09 | 70 |
| Takuya Nakamura | 69 | 2016-10 → 2026-11 | 68 |
| boygenius | 49 | 2018-11 → 2023-10 | 49 |
| Marti Jones | 20 | 2014-07 → 2019-10 | 20 |

**8 of 8 returned history**, including the obscure ones — Marti Jones is not a name
anybody would have cherry-picked. Mean ~137 past events per artist.

Three properties that matter more than the counts:

1. **Coordinates on ~99.6% of past events** (1,088 of 1,091). That is the join. Our
   2,891 venue clusters are deduped by proximity, so a past event with lat/lng lands
   in an existing cluster through the same `sameVenue` path the live crawl already
   uses. No new matching logic.
2. **Keyed by artist name, not MBID.** The 23%-MBID problem that sank Setlist.fm does
   not apply, and our Bandsintown client already queries by name.
3. **A hard floor at 2014.** An explicit `2005-01-01,2010-12-31` range for Radiohead
   returns `0`, so this is their data horizon rather than a paging limit.

Checked for a silent cap and did not find one. Radiohead's yearly slices give
2016: 23, 2017: 30, 2018: 24 — and **0 for both 2015 and 2019**, which is *correct*:
they were recording *A Moon Shaped Pool* in 2015 and off the road in 2019. Those 77
are most of the 101, so the total looks complete rather than truncated.

### User contribution

What Discogs, RateYourMusic and Letterboxd's own edit queue all do in the end. It is
the only source that scales to the long tail of a Tuesday night in a 200-cap room,
because the only record of that night is in the heads of the people who were there.

## Recommendation

**Backfill 2014-onward from Bandsintown, on demand. Keep user contribution for what
that cannot reach.**

The experiment above rewrote this section. The original plan led with user-contributed
shows because there appeared to be no usable corpus; there is one, we already hold the
credential, and it joins to our venues by coordinates. Building a contribution flow
first would have been a moderation queue we did not need to open.

### The primary path: on-demand backfill

Eagerly crawling 3,771 artists × ~137 past events is roughly **half a million rows**,
against a cron budget the todo already flags as tight on CPU and subrequests. So it is
pulled, not pushed:

- Somebody says "I saw Bilmuri" → fetch *that* artist's past events → they pick the
  night. The first person to care about an artist pays for the fetch, once.
- Cache per artist with a `past_events_fetched_at` stamp, same shape as the existing
  `enrichment_checked_at`.
- Self-limiting by construction: the only artists backfilled are ones a real person
  asked about, which is also the only useful prioritisation available.

Past events land in `events` — they are machine-owned rows from a source we already
ingest, which is exactly what that table is for — flagged so the repair passes and
the feeds can tell "happened" from "cancelled" and so the crawl does not try to
refresh them.

### The fallback: user contribution, for pre-2014 and the missing tail

Still needed, but now for a much smaller job: gigs before Bandsintown's 2014 horizon,
and rooms it does not know. That is where the three-picker flow below belongs, and
scoping it to the residue rather than the whole problem is what keeps it small.

The key observation for that path is that Marquee is not missing the hard parts. A
concert is mostly a pointer at three things:

| part | do we have it? |
| --- | --- |
| the artist | 3,771 rows, with aliases and images |
| the venue | 2,891 canonical clusters, deduped, with coordinates |
| the date | the user remembers it |

So the contribution UI is **three pickers, not a form**. No free-text venue names, no
free-text artist names — those are exactly the fields that produce a garbage
catalogue and a moderation queue. Picking from existing entities means a contributed
show is a triple of foreign keys plus a date, which is cheap to store, cheap to
dedupe, and nearly impossible to vandalise into something libellous.

### Shape

1. **A `past_shows` table**, separate from `events`, holding
   `(artist_id, venue_id, on_date, created_by, created_at, confirmations)`. Separate
   because `events` is machine-owned and reconciled by the crawl on a schedule — a
   human-authored row in there will get repaired, re-clustered or aged out by code
   that has every right to assume it owns the table.
2. **A synthetic event id namespace** (`past:<uuid>`) so an attendance can point at
   one, and every existing screen keeps working. The log already tolerates this.
3. **Convergence by construction.** Two people logging the same gig pick the same
   artist and the same venue from the same catalogue, so the triple collides and they
   land on one row. The `confirmations` count *is* the corroboration signal — a show
   twelve people independently logged is real without anyone moderating it.
4. **A promotion path**: when a `past_shows` row and a real `events` row turn out to
   describe the same night — the crawl backfills, or Bandsintown answers for a past
   date — merge and repoint. This is the same problem `sameShow` already solves for
   cross-source merging, with the same tolerance for venue-local times.
5. **The date is a date, not a timestamp.** Nobody remembers doors at 19:30 in 2016.
   Storing `on_date` avoids inventing a precision the user does not have, and avoids
   the timezone bugs that come from pretending otherwise.

### Deliberately not in the first pass

- Free-text creation of artists or venues. It is the whole moderation burden for the
  thin end of the tail, and it can be added once the pickers are proven.
- Setlists. That is Setlist.fm's product and doing it badly is worse than linking.
- Verifying that anyone actually attended. See `docs/social.md` — it only starts to
  matter when the log becomes public.

## What to build first, in order

1. ~~Run the Bandsintown past-date experiment.~~ **Done** — see above. It changed the
   plan, which is what made it worth doing before anything was built.
2. **On-demand past-event backfill for one artist.** A route that takes an artist,
   fetches their past Bandsintown events, joins venues by coordinates through the
   existing dedupe path, and writes them. This is the increment that makes the pivot
   real: it takes the catalogue from 19 days of history to about a decade, for every
   artist anybody asks about.
3. **"I saw them before" on the artist page** — the past events, pick one, log it. The
   log screen already renders whatever it is handed, so this is a picker over new rows
   rather than a new surface.
4. **Then measure what is left.** With 2014-onward covered, the size of the remaining
   problem is a number rather than a guess, and it decides whether steps 5 and 6 are
   worth anything.
5. **`past_shows` + three pickers + synthetic ids**, for pre-2014 and rooms
   Bandsintown does not know.
6. **Setlist.fm for the pre-2014 corpus**, if step 4 says the residue is big enough to
   be worth an email and a terms review. Much weaker a case than it was an hour ago.

MusicBrainz drops off the list. It was a candidate because the corpus problem looked
unsolved; for 2014-onward it is now strictly worse than a source we already have, and
for pre-2014 it shares Setlist.fm's MBID join problem without its coverage.

## Open, and Kyle's call

- **Does a contributed past show ever become public?** If two strangers can both see
  "The Showbox, 14 March 2017", that is a shared object with a comment thread on it,
  and it needs the moderation story from `docs/social.md`. If it stays private to the
  logger, none of that applies and step 3 ships alone. This decision changes the
  scope of step 3 more than any other.
- **How far back is worth supporting?** A 1994 gig at a venue that closed in 1998 has
  no row in `venues` and never will from a ticketing feed. There is a real cutoff
  where the pickers stop being able to express the truth, and pretending otherwise
  produces wrong data rather than missing data.
