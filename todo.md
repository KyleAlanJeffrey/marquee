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

## Next up

- [ ] **Keep followed artists' events fresh** (carried over): ingest no longer
  has server-side follows to pull for. Rely on the metro discovery sweep, or have
  the client register followed artist ids for ingestion.
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
