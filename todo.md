# Marquee — TODO

Local-first, discovery-centric concert finder with the **"Stage Black"** design
system: deep dark theme lit by electric-purple / neon-cyan accents,
glassmorphism, gradient CTAs, and image-forward concert cards. Fonts: Sora
(display/headline), Plus Jakarta Sans (body), Space Grotesk (labels/metadata).

## Status legend
- [ ] not started  · [~] in progress  · [x] done

---

## Done — Stage Black redesign (this pass)

- [x] **Design system.** New tokens in `constants/theme.ts` (stage surfaces,
  purple/cyan/orange accents, neon `Glow` presets, purple→cyan gradient). App is
  dark-only. Three Google font families loaded via `@expo-google-fonts/*` and
  gated in the root layout. `ThemedText` rebuilt around the type scale.
- [x] **Primitives.** `MeshBackground` (ambient stage-light wash), `GlassCard`,
  `GradientButton`, `GenreChip`, `DateBlock`, `TopBar` (MARQUEE wordmark),
  `FeaturedCard` (hero concert card), plus reskinned `EventCard`,
  `SegmentedControl`, `FollowButton` (ghost → glowing purple), `EmptyState`.
- [x] **Explore/home.** Glass top bar, "Near Me" + location, radius chips,
  Nearby/Following segmented control, a FEATURED hero card, then the Upcoming
  list. Followed shows highlighted; Following count badge.
- [x] **Event detail (new screen).** Full-bleed hero, genre chips, display
  title, info rows (date/gate, venue, availability), headliner → artist, and a
  sticky purple→cyan Buy Tickets bar with a follow toggle. Event cards now open
  this screen; `useEvent` fetches a single event (anon reads).
- [x] **Artist profile.** Full-bleed hero with FEATURED ARTIST, display name,
  ghost/glow Follow, genre chips, and Upcoming Tours date rows with Tickets.
- [x] **Search + Profile(Settings).** Reskinned: dark search field with cyan
  focus; reminders switch, radius, and manage-follows list.
- [x] **Verified in-browser** against local seed data (mobile viewport): fonts,
  gradient hero card, event-detail screen, sticky Buy Tickets bar, follow
  persistence, segmented toggle — no console errors. tsc + lint + web bundle clean.

## Done — full design sections (this pass)

- [x] **Explore:** genre filter chips (derived from nearby genres, filter the
  feed), Nearby Venues map (dependency-free stylized map, real venue pins via
  `venue_lat/lng` added to `nearby_events`), This Weekend hero + bento secondary
  cards, Coming Up horizontal carousel with per-card Remind Me (one-off local
  notification).
- [x] **Event detail:** The Lineup (headliner + support tiles), The Venue
  (stylized map card + Open in Maps), Fan Gallery strip.
- [x] **Artist:** hero stat row (upcoming shows / genres), Top Tracks, About
  (derived blurb + genre chips), Artist Gallery.
- [x] Verified every section in-browser (mobile viewport) against seed data.

Placeholders where we lack a data source (clearly non-fabricated): support acts
("To be announced"), Top Tracks (skeleton + "streaming previews coming soon"),
galleries (the artist image across varied crops). Wire real data when available:

- [ ] **Top Tracks + galleries from Spotify** (needs an artist-top-tracks edge
  function + real spotify ids; seed artists have placeholder ids).
- [ ] **Support acts** from other events at the same venue/date.
- [ ] **Ticket price** on the event Buy bar (needs a price field from ingest).

## Done — client-driven concert data pipeline (this pass)

- [x] **`discover-events`** edge function: location-driven Ticketmaster pull,
  throttled per grid cell (`discovery_log` table). Near Me calls it on load +
  pull-to-refresh and invalidates the feed when new events land.
- [x] **`refresh-artist-events`** edge function: ingests shows for the on-device
  follow list the client POSTs. Runs on launch + pull-to-refresh.
- [x] Shared ingestion core in `supabase/functions/_shared/ingest.ts`.
- [x] Verified locally: functions boot, JWT-gated (401 unauth), validate input
  (400), and no-key path degrades gracefully. **Ticketmaster fetch itself is
  untested — needs a real `TICKETMASTER_API_KEY`.**

## Next up

- [ ] **Get a Ticketmaster Discovery key**, set it as a function secret, and
  test discovery end-to-end on a device with real location.
- [ ] **Refresh a single artist on follow** (currently launch + pull-to-refresh
  only), so a just-followed artist's shows appear without a manual refresh.
- [ ] **Retire or repurpose `ingest-events`** — it's dormant post-pivot. Either
  delete it or convert it to a cron over a fixed launch-city list using
  `_shared/ingest.ts`.
- [ ] **Live glass blur.** Native has no cheap backdrop-blur for arbitrary
  content, so `GlassCard`/`TopBar` use translucent fills. Consider `expo-blur`
  (BlurView) for the top bar / nav / cards for true glassmorphism.
- [ ] **Deep-link reminders to the event screen.** Reminder taps currently route
  to the artist; route to `/event/[id]` now that it exists.
- [ ] **Richer data the mockups imply** (optional): venue map ("Open in Maps"),
  support acts / lineup, fan gallery, top tracks, monthly listeners, ticket
  price. Needs new data sources.
- [ ] **Tests + CI** (carried over): unit-test `format.ts` + follow-matching;
  GitHub Actions running `tsc` + `expo lint`.
- [ ] **Account upgrade path** (carried over): migrate local follows to a server
  table and re-enable server push when accounts return.

## Known limitations (by design for now)

- No account; follows/prefs are per-device.
- Dark-only theme (matches the "dark venue" brand).
- Discovery ingest still sweeps per stored `profiles.home_location` metro.

_Design source: `stitch_marquee_concert_tracker/` (DESIGN.md + explore / event /
artist mockups)._
