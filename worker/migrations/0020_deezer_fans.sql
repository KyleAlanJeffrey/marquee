-- Deezer fan count per artist — the one artist-popularity number available
-- without a paid quota (Spotify's popularity field is stripped in dev mode).
-- Filled organically by the 15-minute crawl and on artist-page views, and by
-- hand via POST /api/admin/backfill-deezer-fans. Feeds the notability score:
-- an arena headliner and a club act used to tie on metadata alone.
ALTER TABLE artists ADD COLUMN deezer_fans INTEGER;
