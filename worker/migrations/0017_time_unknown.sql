-- Shows whose set time isn't announced yet. Both feeds mark these rather than
-- omit them — SeatGeek with `time_tbd` (and a 03:30-local filler timestamp),
-- Ticketmaster by leaving `dateTime` out while still publishing the local date.
-- Until now such listings were skipped entirely, which hid real, buyable shows.
-- Now they land with `starts_at` pinned to noon at the venue and this flag set,
-- and the clients render the date without inventing a clock. The flag clears
-- the moment any source publishes a real time.
alter table events add column time_unknown integer not null default 0;
