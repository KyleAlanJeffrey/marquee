-- The crawl looks artists up by folded name for every support act it finds in a
-- lineup (dozens per run, against a table that grows with every discovery), and
-- that was a full scan.
--
-- Not unique on purpose: two different bands can legitimately share a name, and
-- the table already holds duplicates from Ticketmaster attraction ids that were
-- never reconciled. A unique index here would fail to create today and would be
-- wrong tomorrow.
create index if not exists artists_name_folded_idx on artists (lower(trim(name)));
