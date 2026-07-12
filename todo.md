# Marquee — TODO

Local-first concert-discovery app. **Cloudflare stack:** Expo app → Cloudflare
Worker (Hono) → D1 (SQLite). Ticketmaster for concert data, Spotify for search.
Follows/prefs on-device (no account). Web → Pages; native → EAS.

## Status legend
- [ ] not started · [~] in progress · [x] done

---

## Done — Cloudflare migration (this pass)

- [x] **Worker API** (`worker/`, Hono): `/nearby`, `/artists/:id`,
  `/artists/:id/events`, `/events/:id`, `/search-artists`, `/discover-events`,
  `/refresh-artist-events`.
- [x] **D1 schema + seed** ported from Postgres (lat/lng columns instead of
  PostGIS; genres as JSON text; UUIDs generated in the Worker).
- [x] **Geo without PostGIS:** bbox prefilter on indexed lat/lng + haversine in
  the Worker, applied in `/nearby`.
- [x] **Client rewired** to the Worker (`src/lib/api.ts`, rewritten `hooks.ts` /
  `discovery.ts`); removed `@supabase/supabase-js` + the supabase client.
- [x] **Supabase removed** (whole `supabase/` dir); `scripts/dev.sh` now runs
  Worker + local D1 + Expo.
- [x] Fixed a latent duplicate-artist / unique-collision bug in the refresh path
  while porting it.
- [x] **Verified end-to-end** against real Ticketmaster: local D1 seeded,
  `/discover-events` ingested 122 NYC shows, `/nearby` served them with correct
  haversine distances, refresh pulled artists' dates, and the app UI rendered
  real data with no console errors. App tsc + lint + web bundle and worker tsc
  all clean.

## Next up

- [ ] **Deploy for real:** `wrangler d1 create marquee` (paste id into
  `wrangler.toml`), apply migrations `--remote`, `wrangler secret put` the keys,
  `wrangler deploy`; then `expo export -p web` + `wrangler pages deploy dist`.
- [ ] **Rotate the Ticketmaster key** (shared in chat) and set the fresh one as a
  Worker secret + in `worker/.dev.vars`.
- [ ] **Refresh a single artist on follow** (currently launch + pull-to-refresh).
- [ ] **Scheduled discovery** (optional): a Cloudflare Cron Trigger that sweeps a
  fixed launch-city list into D1 so feeds are warm before the first visitor.
- [ ] **Same-origin option:** serve the web build from the Worker via Workers
  Static Assets to drop the separate Pages deploy + CORS.

## Design-section placeholders (unchanged, need real data)

- [ ] Top Tracks + galleries from Spotify; support acts from same-venue events;
  ticket price on the event Buy bar.

## Known limitations (by design)

- No account; follows/prefs are per-device.
- Dark-only theme.
- D1/SQLite geo is bbox + haversine (fine at city radius; not true spherical
  indexing). Revisit if radii or data volume grow a lot.
- Native apps aren't hosted on Cloudflare — they ship via EAS/app stores and
  point at the deployed Worker.

_Design source: `stitch_marquee_concert_tracker/` (DESIGN.md + mockups)._
