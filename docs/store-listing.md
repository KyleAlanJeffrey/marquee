# Store listing copy

*Drafted 2026-07-31. Character limits are the stores' own; every field below is
inside its limit. The positioning follows todo.md's "brief": local-first concert
discovery pivoting to "the log is the product" — lead with what's near you tonight,
close with the log, because discovery is the door and the log is the reason to stay.*

## Names

- **App name (iOS, ≤30):** `Marquee — Concerts Near You` (28)
- **Subtitle (iOS, ≤30):** `Find shows. Log every gig.` (26)
- **Play title (≤30):** `Marquee: Concerts Near You` (26)
- **Play short description (≤80):**
  `Tonight's shows near you — and a log of every gig you've ever been to.` (71)

## Description (both stores)

Marquee finds the shows playing near you tonight — the arena tours and the
$12 club gigs the big apps never surface — and keeps the ones you go to.

**Find what's on.** Open the app and see every upcoming show around you, from
multiple ticketing sources merged into one clean feed. Search by artist or by
town. Follow the artists and rooms you care about and get a heads-up the day
before they play near you.

**Keep every gig.** Were you there? One tap logs it. Rate the set and the room
separately — a brilliant band in a bad-sound venue is two different verdicts —
and add a private note. Your history reaches back about a decade: open an
artist and pick the nights you saw from their real past tour dates.

**Your list follows you.** Sign in and your follows, saved shows and gig log
live with your account, on any device.

- Every show near you, deduplicated across sources
- Follow artists and venues; reminders before nearby shows
- Save shows you're thinking about
- Log past gigs from real historical tour dates
- Two ratings per night: the set and the room
- Venue pages with photos, history and what's coming up

No ads. No tracking. Location is used only to find shows near you and is never
tied to your identity.

## Keywords (iOS, ≤100 chars)

`concerts,live music,gigs,shows,tour dates,setlist,venues,tickets,local,log,diary,tracker` (91)

## Promotional text (iOS, ≤170)

`Every show near you tonight — big rooms and small ones — plus a log of every
gig you've been to, rated your way.` (113)

## What's still needed (not copy)

- [ ] **Screenshots** — 6.7" and 6.5" iPhone, 13" iPad if targeted, Play phone +
  7"/10" tablet. Explore feed, an artist page with "Your history", the log tab, a
  venue page. Needs seeded data that looks alive; do these from the simulator.
- [ ] **Feature graphic (Play, 1024×500)** — the Electric Stage look.
- [ ] **Category:** Music (both). **Content rating:** everyone; the IARC form's
  "user-generated content" answer flips when public reviews ship (docs/social.md).
- [ ] **expo-updates decision** before first submission, because it changes the
  binary: not installed today, so there is no OTA channel; adding it buys same-day
  JS fixes at the cost of a runtime-version policy.
- [ ] **Support URL + marketing URL** — marquee.rocks serves both once a contact
  page exists (the same page App Store guideline 1.2 wants for UGC anyway).
