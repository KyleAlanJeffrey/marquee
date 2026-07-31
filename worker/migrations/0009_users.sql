-- A local mirror of the identity Clerk owns.
--
-- Clerk is the source of truth for who somebody is: the handle, the display name,
-- the avatar, the email, the OAuth connections and the deletion all live there,
-- and none of that is copied here to be authoritative. What this table exists for
-- is the thing Clerk cannot do — be a foreign key. Attendances, reviews and
-- reactions all point at a user, and D1 cannot join against an API.
--
-- So the columns are deliberately few: an id, the profile fields worth denormalising
-- so rendering a review doesn't need a round trip to Clerk per author, and the
-- timestamps. Anything else stays in Clerk, where it is already correct.
--
-- `id` is the Clerk user id (`user_2abc…`), not a uuid of ours. Two ids for one
-- person is a bug waiting to be written, and every token the Worker verifies
-- carries this one.

create table if not exists users (
  id text primary key,
  -- The public name. Nullable because Clerk does not require a username by
  -- default, and a row has to exist from the first authenticated request whether
  -- or not the person has picked one yet.
  handle text,
  display_name text,
  avatar_url text,
  created_at text not null,
  -- Last time this mirror was refreshed from Clerk, so a stale display name has a
  -- known age rather than being indistinguishable from a current one.
  synced_at text not null,
  -- Set when Clerk says the account is gone. The row stays: reviews are attributed
  -- to a user_id, and deleting it would either cascade away other people's reading
  -- or leave a dangling reference. Anonymise-and-keep is the decision recorded in
  -- todo.md; this column is what implements it.
  deleted_at text
);

-- Handles are public and appear in URLs, so they have to be unique — but only
-- among live accounts, and only when set. A partial unique index says exactly
-- that; a plain `unique` would collide every null on SQLite's behaviour and would
-- also let a deleted account hold its name forever.
create unique index if not exists users_handle_idx
  on users (lower(handle))
  where handle is not null and deleted_at is null;
