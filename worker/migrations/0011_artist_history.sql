-- When we last asked a source for an artist's *past* shows.
--
-- The catalogue is built from ticketing feeds, so it only ever knew about shows that
-- had not happened yet: before this, 22,675 events with 623 of them in the past and
-- nothing earlier than 2026-07-12. An app whose point is logging what you have seen
-- cannot be built on 19 days of history.
--
-- Bandsintown answers for past dates (`date=past`), back to about 2014, with
-- coordinates on essentially every row — measured across eight artists drawn at
-- random from this table, all eight of which returned history. So the fix is to ask.
--
-- Separate from `crawl_state`, which schedules the *upcoming* crawl and reschedules
-- an artist every few hours because next month's listings change. History does not
-- change. Once fetched, an artist's past is done, and this column exists so the
-- second person to ask about them costs nothing.
--
-- Nullable, and null means "never asked" rather than "has no history" — the
-- difference matters, because the first is worth one request and the second is not.

alter table artists add column past_events_fetched_at text;

-- Partial: the only question ever asked of this column is "which artists have never
-- been backfilled", so indexing the rows that have been is wasted space.
create index if not exists artists_history_pending_idx
  on artists (id)
  where past_events_fetched_at is null;
