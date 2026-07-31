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

### Setlist.fm — the only real corpus, and already assessed

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

### Bandsintown past events

We already hold a Bandsintown `app_id` and the client is written. Their artist events
endpoint takes a date range, and whether it will answer for past dates is a
**five-minute experiment nobody has run**. If it returns even a couple of years of
history for artists we already track, it is by far the cheapest partial answer, and
it needs no new credential or agreement. **Run this before designing anything else.**

### User contribution

What Discogs, RateYourMusic and Letterboxd's own edit queue all do in the end. It is
the only source that scales to the long tail of a Tuesday night in a 200-cap room,
because the only record of that night is in the heads of the people who were there.

## Recommendation

**Let people log past shows by picking from what we already have, and treat the event
row as something we derive rather than something we require.**

The key observation is that Marquee is not missing the hard parts. A concert is
mostly a pointer at three things:

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

1. **Run the Bandsintown past-date experiment.** One request. It either changes the
   plan or rules out the cheapest option.
2. **Measure the MusicBrainz join** against 50 realistic gigs, so "coverage is thin"
   is a number rather than a received opinion.
3. **`past_shows` + the three-picker flow + synthetic ids.** Ships value with no new
   data source and no moderation queue, and makes the log usable for somebody with a
   history. This is the increment that makes the pivot real.
4. **Re-read Setlist.fm's terms for the lookup-at-logging shape**, and email them.
   Slow, so start it early even though it lands last.

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
