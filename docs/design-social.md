# Making the social layer feel like one thing

_2026-07-31. Prompted by Kyle: make the social aspects more intuitive, consider
a more Letterboxd-style design, and plan what the new R2 bucket (`marquee`)
should carry. This document is the thinking; the actionable slices live in
todo.md under "Social design pass"._

## Where the friction is today

The social features all exist and all work — phases A–E shipped — but they
grew one at a time, and it shows in three places:

**1. Two rating surfaces on one page.** A past show carries the private log
card (rate the set, rate the room) *and* the public review composer (rate the
set, rate the room, write words). Same stars, same axes, different privacy —
and nothing on screen explains why you're being asked twice. Letterboxd's
answer is one act: *log* the film, and rating/review/visibility are fields of
that one act. Ours should read the same way: **logging a night is the act**,
and "say this in public" is a toggle on it, not a second form further down the
page. The privacy design underneath doesn't change (a review stays its own
request and its own row — no code path publishes a log entry): "say this in
public" creates or updates the **review**, and never alters the log's
visibility, which has none to alter. Both writes are upserts keyed on the
entry, so a retry after a dropped response re-lands the same state instead
of duplicating anything. This is purely the presentation collapsing into
one flow.

**2. "Follow" means two unrelated things.** The Following tab is artists and
venues; following *people* happens on profiles and pays off in a feed that
hides at the bottom of your own profile. The feed is the heartbeat of a social
app and ours is buried three scrolls deep on the one tab nobody visits twice a
day. Options, cheapest first:
   - Move the feed to the **top** of the Profile tab (above your own shelves).
   - Give Following a third segment: ARTISTS · VENUES · **PEOPLE** — people
     rows showing their latest review inline. One tab answers "what am I
     following and what has it done lately", for all three kinds.
   - Long-term (Kyle's docs/social.md decision): a real Activity tab.

**3. People are undiscoverable.** You reach a profile from settings or a
pasted link. The fix isn't a directory, it's surfacing authors where they
already are: review rows on event pages should carry the author's avatar and
link to their profile (they carry the name today), and review stats on
artist/venue pages should name a reviewer or two, Letterboxd-style ("popular
reviews").

## What Letterboxd gets right that maps cleanly

The mapping is almost one-to-one, which is why the pivot brief said
"Goodreads/Letterboxd for concerts":

| Letterboxd | Marquee has | Marquee is missing |
|---|---|---|
| Watched (diary) | The log | — |
| Watchlist | Saved | — |
| Rate + review, one flow | Two separate forms | The unified flow (§1 above) |
| Like a review | — | The cheapest social loop there is |
| Four favorites on profile | — | "Four favorite artists" strip |
| Stats header (films, this year) | Follower counts only | Shows seen, this year, venues visited |
| Poster wall | Text rows everywhere | The visual identity (§below) |
| Lists with cover collages | Lists (text rows) | Covers from item artwork |
| Popular reviews on film pages | Newest-first reviews | Ranking needs likes first |
| Year in review | — | "Your year in live music" — the shareable artifact |

**The poster wall is the big one.** Letterboxd's entire feel comes from film
posters as the unit of design — a profile is a wall of what you've seen. Our
equivalent atom is the artist image, and we already have it on most rows. The
moves, in order of impact:

1. **The log becomes a grid.** Each night is a tile: artist image, date
   stamped on it, stars under it. A year of gigs as a wall of posters is the
   screenshot people share, and it's the same data the list renders today.
2. **Profiles lead with the wall.** Stats line (shows · this year · venues ·
   followers), then a four-favorite-artists strip the owner picks, then the
   recent-nights grid, *then* the text sections that exist today.
3. **List covers.** A list's first four items' images composed into a 2×2
   collage — computed client-side at first, pre-composed into R2 later.
4. **Review likes.** One table (`review_likes`, primary key `(review_id,
   user_id)` so a like is a fact, not a counter — like and unlike are
   idempotent PUT/DELETE and a retry can never inflate the ranking), one
   count, one heart. It feeds "popular reviews" ranking on event/artist
   pages, gives the feed a verb, and later gives lists their reaction (which
   is the trigger the 0016 migration named for turning list deletion into a
   tombstone).

None of this requires new data sources — it's the images we already reference,
promoted from decoration to structure.

## What R2 is for (bucket: `marquee`)

Everything visual above leans on images we currently **hotlink**: artist
images from Spotify/Ticketmaster/Deezer CDNs, venue photos from Wikimedia,
avatars from Clerk. Hotlinks rot, get resized upstream, and rate-limit. The
bucket's job is to make the images ours. In build order:

1. **Bind it** (`r2_buckets` in wrangler.jsonc, `env.MARQUEE` in env.ts) and
   serve through the Worker: `GET /img/:key` with immutable cache headers —
   the edge cache does the heavy lifting after first read. Land the binding
   with its first consumer, not before.
2. **Mirror artist images on ingest/enrichment.** Content-addressed key
   (`artist/<id>/<hash>.jpg`), fetched once when an artist row gets an
   image URL, stored, and the API starts serving `/img/…` instead of the
   upstream URL. A dead Spotify URL stops blanking heroes. Same treatment —
   including the content-addressed key, so immutable cache headers stay
   honest and a replaced image is a new URL, never a stale edge hit — for
   venue photos (Wikimedia asks for exactly this — hotlinking is discouraged)
   and Clerk avatars on profile sync. The mirror fetch is the Worker
   fetching URLs that arrived from outside, so it gets the boring armour:
   an origin allowlist (the CDNs we already enrich from), no following
   redirects off-list, a timeout, a response-size cap, and a content-type
   check — and a failed fetch leaves the existing object and the upstream
   URL in place rather than blanking anything.
3. **Generated OG cards.** Today every share shows the same site-wide card.
   Per-entity cards (event: artist image + date + venue; profile: the wall;
   list: the collage) rendered once and stored in R2 make every shared link
   look designed. This is the single highest-leverage share/SEO item left.
   Two rules from day one: a card renders **only from content that is public
   at render time** (never the private log; never a private list), and a
   card's key includes a version of its inputs, so when something goes
   private, gets deleted, or its author blocks — the page re-keys to a fresh
   card and the old object is deleted, not merely orphaned behind a stale
   shared URL.
4. **List cover collages**, pre-composed at write time.
5. **Later, behind Kyle's moderation decision: user gig photos** on reviews.
   R2 is ready for it; the report/hide pipeline isn't scoped for images yet,
   so this stays parked.

Worker-side image *resizing* wants Cloudflare Images or the paid resizing
flag; until then, store one sane size (~800px) at mirror time.

## Suggested order

1. Unified log/review flow (§1) — removes the most confusion per line changed.
2. Log-as-poster-grid + profile stats line — the identity shift, client-only.
3. R2 binding + artist-image mirroring — infrastructure the rest leans on.
4. Review likes (+ popular-review ordering).
5. Feed placement (Following segment or top-of-profile).
6. Generated OG cards from R2.
7. Four favorites, list collages, year-in-review — the delight tier.
