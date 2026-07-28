-- Remove the development seed (worker/seed.sql) from a database that has it.
-- Everything the seed inserts is tagged source='seed'; artists carry a
-- 'seed-' spotify_id. Events go first (they reference the other two).
delete from events where source = 'seed';
delete from venues where source = 'seed';
delete from artists where spotify_id like 'seed-%';
