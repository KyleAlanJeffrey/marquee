-- Curated lists — phase E of docs/social.md, the last phase of the roadmap.
-- "Best rooms in Oakland", "every act I saw in 2019", "who to catch at the
-- festival". Named `lists`/`list_items` per the design doc; not to be confused
-- with `user_lists`, which is the private follows/saved/log storage.
--
-- Hard delete, unlike reviews: nothing hangs off a list yet (reactions and
-- comments target them in a later phase), so a deleted list can simply go.
-- When reactions arrive, deletion here becomes a tombstone like everywhere
-- else — that migration is the moment to add deleted_at, not before.

create table if not exists lists (
  id text primary key,
  user_id text not null references users(id),
  title text not null,
  description text,
  -- 'public' or 'private'. Private is a scratchpad; public appears on the
  -- owner's profile. No 'hidden' until lists are reportable.
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at text not null,
  updated_at text not null
);

create index if not exists lists_user_idx on lists (user_id);

create table if not exists list_items (
  list_id text not null references lists(id) on delete cascade,
  -- What the entry points at. The id is resolved against the matching table on
  -- read; a ref whose row has vanished simply drops out of the rendered list.
  ref_kind text not null check (ref_kind in ('artist', 'venue', 'event')),
  ref_id text not null,
  position integer not null,
  note text,
  created_at text not null,
  primary key (list_id, ref_kind, ref_id)
);
