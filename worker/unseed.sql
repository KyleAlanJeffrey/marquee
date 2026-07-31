-- Remove the development seed (worker/seed.sql) from a database that has it.
-- Everything the seed inserts is tagged source='seed'; artists carry a
-- 'seed-' spotify_id. Events go first (they reference the other two).
delete from events where source = 'seed';

-- Venue clustering makes this less simple than it looks, and getting it wrong
-- loses real shows.
--
-- The seed names its venues after real rooms ("The Warfield", "Bowery Ballroom"),
-- so once `canonical_venue_id` has been computed those rows cluster with the real
-- ones — and a seed row can end up as the cluster *head*, which is the row real
-- events point at. Measured on production before this was fixed: of 12 seed
-- venues, eleven were harmless cluster members, and "The Catalyst" was a head
-- carrying three real Santa Cruz shows. `events.venue_id` is `on delete set null`,
-- so deleting it would have left those three shows with no venue at all: no
-- location, no venue page, and gone from "near me" entirely.
--
-- So a seed venue is only removed when nothing real depends on it. The rest are
-- left in place; they are a duplicate row inside a correct cluster, which costs
-- nothing visible, and `repair-duplicates` is what tidies those.
delete from venues
where source = 'seed'
  and not exists (select 1 from events e where e.venue_id = venues.id)
  and not exists (
    select 1 from venues m
    where m.id <> venues.id
      and coalesce(m.canonical_venue_id, m.id) = venues.id
  );

-- Same shape of problem: a seed artist that a real event somehow points at must
-- not be deleted, because artist_id is `on delete cascade` and would take the
-- real event with it.
delete from artists
where spotify_id like 'seed-%'
  and not exists (select 1 from events e where e.artist_id = artists.id);
