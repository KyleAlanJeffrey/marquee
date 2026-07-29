-- Migration 0002 added `events.sources` but left existing rows null, so the
-- provenance lookup in `findExistingShows` (json_extract(sources, '$.source'))
-- could not see anything ingested before it. `repair-duplicates` fills this in
-- too, but a fresh deploy that never runs the repair should not have to.
update events
   set sources = json_set(coalesce(sources, '{}'), '$.' || source, source_event_id)
 where sources is null
    or json_extract(sources, '$.' || source) is null;
