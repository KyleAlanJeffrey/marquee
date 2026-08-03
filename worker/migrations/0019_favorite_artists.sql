-- Four favorites, Letterboxd's signature: the acts a profile leads with.
--
-- A JSON array of artist ids on the user row rather than a join table: it is
-- one small ordered list, read and written whole, capped at four by the route
-- - exactly the shape a column holds better than rows. Public by intent (the
-- point is to wear them on the profile), unlike the private prefs beside it.

alter table users add column favorite_artists text;
