-- Make the cross-source arm of findExistingShows indexable.
--
-- The problem. `findExistingShows` asks, for each incoming listing, "is this
-- show already on file?" as one OR over up to four arms. Three are indexable —
-- the unique (source, source_event_id), and two venue/artist/time-window arms
-- served by events_dedupe_idx. The fourth is not:
--
--     json_extract(sources, '$."ticketmaster"') = ?
--
-- SQLite's OR optimisation needs *every* arm indexable; one function-on-column
-- arm poisons the whole disjunction, so each of these statements was a full
-- scan of `events`. Measured on production 2026-08-07: 59,639 rows read and
-- 59.7ms per call, against 0 rows and 0.28ms for the indexed arm alone. The
-- crawl calls this once per incoming listing — MAX_EVENTS_PER_ARTIST is 200 and
-- CRAWL_BATCH is 8 artists — every 15 minutes, against the same D1 the site
-- reads from. That is on the order of hundreds of full table scans per tick,
-- and it was landing on read latency for everyone.
--
-- Why an expression index rather than restructuring the query. The obvious
-- alternative is to run the three indexable arms first and fall back to this
-- one only on a miss, but a genuinely new listing misses everything, so the
-- scan would still happen on exactly the ingest path that runs most. And the
-- arm can't simply be dropped: 4,117 events carry more than one source id, and
-- 2,289 rows are reachable *only* through it (a bandsintown row found by the
-- ticketmaster id recorded in its sources JSON). SQLite indexes expressions
-- directly, so the arm becomes a seek and the query doesn't change at all —
-- no behaviour to re-verify, no ordering to reason about.
--
-- The expression text must match the query's exactly, including the quoting of
-- the JSON path, or the planner won't use the index. Keep these in step with
-- the `source` values in sources.ts; findExistingShows warns when it sees one
-- that isn't listed here, because the failure mode is silent and slow rather
-- than visible and broken.
--
-- Verified after creation: 0 rows read for a miss, 2 for a real hit, and the
-- full OR that findExistingShows actually issues also reads 0.
CREATE INDEX IF NOT EXISTS events_sources_ticketmaster_idx
  ON events (json_extract(sources, '$."ticketmaster"'));
CREATE INDEX IF NOT EXISTS events_sources_bandsintown_idx
  ON events (json_extract(sources, '$."bandsintown"'));
CREATE INDEX IF NOT EXISTS events_sources_seatgeek_idx
  ON events (json_extract(sources, '$."seatgeek"'));
CREATE INDEX IF NOT EXISTS events_sources_dice_idx
  ON events (json_extract(sources, '$."dice"'));

-- Four new indexes is four new things for the planner to weigh.
ANALYZE;
