# Marquee — TODO

The app is a local-first, discovery-centric concert finder: one **Near Me** feed
of upcoming shows with an animated **Nearby / Following** toggle, follows stored
on-device (no account), and on-device reminders for followed shows. Modern UI
built with reanimated (spring press, staggered list entrances, animated
segmented control), a spotlight-gradient hero, haptics, and a refreshed theme.

## Status legend
- [ ] not started  · [~] in progress  · [x] done

---

## Done (this pass — local-first + redesign)

- [x] **Local follows.** Follows live in AsyncStorage (`follows-store.tsx`); no
  account, no server-side follow rows. Follow from a show, the artist page, or
  search. Matching to events is by catalog UUID or Spotify id.
- [x] **No auth.** Removed the anonymous sign-in gate. The app talks to Postgres
  as `anon`; migration `20260711010000_local_first.sql` grants + RLS-opens the
  catalog to anon and reworks `nearby_events` (returns every nearby show + the
  artist's spotify id; no server-side follow exclusion).
- [x] **Near Me home.** Single feed with an animated segmented control
  (Nearby / Following), spotlight-gradient hero with location + radius chips, a
  followed-artist rail, following highlight (★ + accent stripe) and a Following
  count badge.
- [x] **On-device reminders.** `reminders.ts` schedules local notifications the
  day before followed shows near you; toggle in Settings, permission-gated.
- [x] **Redesign.** New theme/tokens (Radius/Shadow/Spring, gradient), animated
  `PressableScale` (+ haptics), `SegmentedControl`, `FollowButton`, image-forward
  `EventCard` with calendar date chips, restyled search / artist / settings /
  empty states.
- [x] **Settings.** Local prefs (search radius, reminders switch) + manage-follows
  list with unfollow.
- [x] **Verified end-to-end** in the browser against local seed data: feed loads,
  follow persists, Following filter + badge + rail work, distances correct,
  artist detail + ticket links, no console errors. Fixed a web crash
  (`getLastNotificationResponseAsync` guarded off web).

## Next up

- [ ] **Keep followed artists' events fresh.** Ingest currently pulled events for
  server-side follows, which no longer exist. Options: (a) rely on the metro
  discovery sweep (followed artists appear when they play a covered metro), or
  (b) have the client register followed Spotify/artist ids for ingestion. Decide
  and wire up. Until then, a followed artist only surfaces if they're in the
  nearby discovery data.
- [ ] **Collapsing hero on scroll.** The gradient hero is currently fixed; a
  scroll-driven collapse would be a nice touch.
- [ ] **New-announcement pings.** Reminders fire the day before a show; also fire
  an immediate local notification when a *newly seen* followed show appears
  (diff against a stored set of seen event ids).
- [ ] **Automated tests.** Unit-test `format.ts` and the follow-matching logic in
  `follows-store.tsx`.
- [ ] **CI.** GitHub Actions: `tsc --noEmit` + `expo lint` on PR. (Lint is
  configured; `npm run lint` passes.)
- [ ] **Account upgrade path.** When accounts return, migrate local follows to a
  server table and re-enable server push (schema still has profiles/follows).
- [ ] **Remove now-dead push token helper** (`registerForPushNotifications` in
  `notifications.ts`) or repurpose it for the account-upgrade push path.

## Known limitations (by design for now)

- No account; follows/prefs are per-device.
- Discovery ingest still sweeps per stored `profiles.home_location` metro — with
  no accounts, seed data + the client's live location drive the feed.
