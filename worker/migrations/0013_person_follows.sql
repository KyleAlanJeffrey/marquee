-- The person graph: who follows whom. Phase A of docs/social.md.
--
-- A separate table from artist and venue follows on purpose — those live as JSON
-- documents in `user_lists` because only their owner ever reads them. A person
-- follow is read from both ends (your following list, their follower count), so
-- it has to be a real relation.
--
-- One direction per row, like Letterboxd: following somebody is not a request
-- and needs no acceptance. Mutuals are a join, not a state.

create table if not exists person_follows (
  follower_id text not null references users(id),
  followee_id text not null references users(id),
  created_at text not null,
  primary key (follower_id, followee_id),
  -- Following yourself is refused in the route too, but the constraint is what
  -- makes it impossible rather than merely unhandled.
  check (follower_id <> followee_id)
);

-- The primary key serves "who do I follow"; this serves the other end —
-- "who follows them" and the follower count on every profile read.
create index if not exists person_follows_followee_idx
  on person_follows (followee_id);
