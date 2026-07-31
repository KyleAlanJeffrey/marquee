-- The four lists a person owns, stored so they survive the device.
--
-- Follows, followed venues, saved shows and the attendance log have always lived
-- in AsyncStorage. That is still where they are read from — the app opens instantly
-- and works on a plane because of it — and this table is the copy that means a lost
-- phone is not a lost history.
--
-- One row per (user, list), holding the list as a JSON array: the same array the
-- client already keeps, byte for byte.
--
-- **Why a document and not four tables.** The job here is portability, not
-- querying. Nothing asks "who follows this artist" yet; what gets asked is "give me
-- back my list", and for that a document is the whole feature — one table, one pair
-- of routes, no column-per-field mapping to keep in step with four client types,
-- and no working around SQLite's 999-variable statement limit when somebody with
-- 400 follows signs in.
--
-- **When to stop using it.** The moment a list has to be read by somebody other
-- than its owner. Public reviews (phase 3) and a friends feed (phase 4) both need
-- real columns and indexes, and neither is a migration of this table — a review is
-- a different object from a private log entry, with moderation, an author and a
-- visibility. This table is the private copy; that one is the published one.
--
-- `kind` is closed and checked, so a typo in a route becomes an error here instead
-- of a fifth list nobody reads.

create table if not exists user_lists (
  user_id text not null references users(id),
  kind text not null check (kind in ('follows', 'venues', 'saved', 'attendances')),
  -- A JSON array. Validated by the route before it lands, and validated again by
  -- the client on the way out, because the device's copy is merged into it and a
  -- device's JSON is only as trustworthy as the device.
  payload text not null,
  -- Epoch milliseconds, matching the `followedAt` / `savedAt` / `loggedAt` stamps
  -- inside the payload rather than the ISO strings the ingestion tables use. The
  -- client mints those numbers, and converting to text on the way in and back on
  -- the way out is two chances to be wrong about a timezone for no gain.
  updated_at integer not null,
  primary key (user_id, kind)
);
