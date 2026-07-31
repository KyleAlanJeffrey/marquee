-- Going / interested, on upcoming shows.
--
-- A real relation rather than a `user_lists` document, unlike saved shows,
-- because it is read from both ends: your plan is yours, but "12 going" is the
-- event page's — the first number on this site that makes a show feel like a
-- place people will actually be. One row per person per event; changing your
-- mind is an update, and "went" is what the log is for once it has happened.

create table if not exists event_rsvps (
  user_id text not null references users(id),
  event_id text not null references events(id),
  status text not null check (status in ('going', 'interested')),
  created_at text not null,
  primary key (user_id, event_id)
);

-- The event page's count read.
create index if not exists event_rsvps_event_idx on event_rsvps (event_id);
