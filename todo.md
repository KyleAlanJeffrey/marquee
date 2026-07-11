# Marquee — TODO

Tracking what's left to finish. The app is already end-to-end functional (three
tabs, artist search, follow/unfollow, home location, push registration, nightly
ingest + notifications, PostGIS geo queries). It type-checks cleanly and produces
a working web bundle. This file tracks the gaps between "works" and "finished".

## Status legend
- [ ] not started
- [~] in progress
- [x] done

---

## Core gaps (this pass)

- [x] **Notification tap handling / deep-linking.** Pushes carry a payload but
  nothing listened for taps, so tapping a concert alert did nothing — a dead end
  for the app's central promise. Now: tapping a notification (cold start or
  foreground) routes to the relevant artist page.
  - [x] Include `artistId` in the push `data` payload (ingest function).
  - [x] Add `artist_id` to the `followers_to_notify` RPC (migration).
  - [x] Register a response listener in the root layout that navigates on tap.
- [x] **Error states.** Query failures (offline, backend down) fell through to a
  misleading "No artists yet" / "Nothing nearby" empty state or an endless
  spinner. Added a reusable `ErrorState` with retry, wired into the Following and
  Near Me tabs.

## Nice-to-have (not blocking a v1)

- [ ] **Manage-follows UI in Settings.** Today you unfollow from the artist page;
  a list in Settings would be friendlier.
- [ ] **Upgrade anonymous account to email/Apple/Google.** Schema + auth config
  already support it; needs UI in Settings and a link flow.
- [ ] **Import from Spotify.** OAuth to pull a user's followed/top artists in one
  tap (mentioned in TECH_STACK as a future win).
- [ ] **Automated tests.** No test suite yet — at minimum unit tests for
  `src/lib/format.ts` and an ingest dedupe test.
- [ ] **CI.** GitHub Actions: typecheck + lint on PR; optionally `supabase db lint`.
  (ESLint is now configured — `npm run lint` passes — so CI just needs to run it.)
- [ ] **EAS config.** `eas.json` / project id for dev builds so push tokens work
  on device (README already documents the flow).
- [ ] **Event detail screen.** Notifications currently deep-link to the artist;
  a dedicated event screen could show map + full details.

## Known limitations (by design for v1)

- Anonymous-only auth; data is per-device until account upgrade lands.
- Discovery ingest sweeps a 75mi Ticketmaster radius per distinct user metro
  (rounded to ~0.1°); fine at small scale, revisit if user base grows.
