-- Cached description and photo for a venue.
--
-- Cached rather than fetched per view because it costs 3 outbound requests to
-- assemble (article summary, sometimes a title search, then the image licence) and
-- because none of it changes: a room's Wikipedia article and its lead photograph
-- are stable in a way a show's ticket price is not. Venue pages are also rendered
-- server-side for crawlers, where those requests would sit inside the response.
--
-- `checked_at` is the cache key, and it records the *attempt*, not the success —
-- most venues have no article at all, and without it every page view would re-ask
-- Wikipedia about a club it has never heard of. A null description with a recent
-- checked_at means "asked, nothing there".

alter table venues add column description text;
alter table venues add column description_url text;
alter table venues add column photo_url text;
-- Every freely-licensed Wikipedia image still requires attribution, so the credit
-- and the licence are stored with the URL and rendered beside the photo. A row with
-- a photo_url and no photo_credit must not be displayed.
alter table venues add column photo_credit text;
alter table venues add column photo_license text;
alter table venues add column photo_license_url text;
alter table venues add column enrichment_checked_at text;

-- Picks the batch of venues due for a look. Partial, because the rows worth
-- checking are the ones never checked, and those are a shrinking minority.
create index if not exists venues_enrichment_idx
  on venues (enrichment_checked_at)
  where enrichment_checked_at is null;
