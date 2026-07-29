-- Bandsintown carries fields Ticketmaster doesn't, and we were dropping them on
-- the floor: the show's end time, whether it's sold out or free, and the lineup
-- (support acts by name) — which is also how the artist crawl finds new bands.
--
-- Artist identity: Bandsintown lookups were keyed on the display name, which is
-- ambiguous (an unknown artist and an artist with no upcoming shows both return
-- an empty list). `bandsintown_id` lets us use the documented `id_{id}` form
-- instead, and `mbid` gives us a cross-source key for matching later.

alter table events add column ends_at text;
alter table events add column sold_out integer;
alter table events add column is_free integer;
alter table events add column lineup text; -- JSON array of artist names

alter table artists add column bandsintown_id text;
alter table artists add column mbid text;

create index if not exists artists_bandsintown_idx on artists (bandsintown_id);
