-- Two changes that only make sense together: give the planner an index worth
-- choosing, then give it the statistics it needs to choose.
--
-- The index. Every venue-scoped read filters `venue_id AND starts_at` —
-- venueEvents, venueStats, followingEvents' venue arm, the /venue/:id server
-- render, and nearbyEvents once it drives from venues. The closest existing
-- index is events_dedupe_idx (venue_id, artist_id, starts_at), and artist_id
-- sits between the two columns these queries actually constrain, so only the
-- venue_id prefix is usable and the scan then covers every event ever filed at
-- that room, past included — a past that MAX_YEARS_BEHIND deliberately keeps
-- two years of. Measured cost is small today (the busiest venue holds 251
-- events, so 252 rows read for 215 results) and this is cheap insurance for
-- when it isn't. events_dedupe_idx stays: findExistingShows genuinely wants
-- the three-column shape.
CREATE INDEX IF NOT EXISTS events_venue_time_idx ON events (venue_id, starts_at);

-- The statistics. Production had no sqlite_stat1 at all — ANALYZE had never
-- run — so SQLite was guessing selectivity, and on the /api/nearby predicate it
-- guessed badly: it drove from events_starts_at_idx and read 93,049 rows in
-- 277ms where driving from the geo bounding box reads 6,634 in 6.5ms for the
-- identical answer. The trigger was the 120-day cap; adding a filter that
-- *removes* rows made the query 19x slower, which is the signature of a
-- planner working blind. Measured on production 2026-08-07: after ANALYZE the
-- plan flipped on its own, with no query change and nothing pinned.
--
-- Stats are a snapshot, not a subscription — they don't track the crawl. The
-- daily cron re-runs this (see the jobs worker) so they can't drift as the
-- catalogue grows.
ANALYZE;
