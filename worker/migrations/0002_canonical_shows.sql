-- One physical show listed by two sources was becoming two rows: `events` is
-- unique per (source, source_event_id), and Ticketmaster and Bandsintown each
-- create their own `venues` row for the same room. Measured on a 10-artist
-- Bandsintown backfill: 17 duplicated shows out of 203, with venue names that
-- disagree ("Moody Center ATX" vs "Moody Center") but coordinates that agree to
-- within ~250m. So venues cluster on geography, and shows key off the cluster.

-- Every venue points at the row that represents its physical location — itself,
-- for the first one seen at that spot.
alter table venues add column canonical_venue_id text references venues (id);
create index if not exists venues_canonical_idx on venues (canonical_venue_id);

update venues set canonical_venue_id = id where canonical_venue_id is null;

-- Which upstream ids contributed to a merged show, as {"ticketmaster":"...",
-- "bandsintown":"..."}. `source`/`source_event_id` stay as the row's first
-- source; features that need a specific upstream id (Ticketmaster lineups) read
-- this instead of assuming the row belongs to them.
alter table events add column sources text;

-- Finding an existing show for an incoming one is a lookup by venue + artist
-- over a time window (Bandsintown datetimes are venue-local, Ticketmaster's are
-- UTC, so the same show can differ by hours), not an equality key.
create index if not exists events_dedupe_idx on events (venue_id, artist_id, starts_at);
