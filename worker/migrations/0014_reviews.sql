-- Public reviews, and the moderation surface they drag in. Phase B of
-- docs/social.md, and one project with the App Store submission: guideline 1.2
-- wants report, block and a way to keep objectionable content out, with no
-- partial credit.
--
-- A review is a DIFFERENT table from the private log (`user_lists`), not a
-- visibility flag on it. A log entry is a memory and a review is a publication:
-- different lifecycles, different validation, different deletion semantics,
-- different moderation exposure. Making one row be both is how somebody's
-- private note gets published by accident.

create table if not exists reviews (
  id text primary key,
  user_id text not null references users(id),
  event_id text not null references events(id),
  -- Derivable from event_id and copied anyway: the artist and venue roll-ups
  -- are the main read path (phase C), and a two-hop join through events on
  -- every artist page is the query that gets slow first. Copying also keeps a
  -- review meaningful after its event is re-clustered, which the crawl does
  -- routinely.
  artist_id text references artists(id),
  venue_id text references venues(id),
  -- The performance and the room, scored separately (both optional): a
  -- brilliant set in a venue with bad sound is two different verdicts.
  rating integer check (rating between 1 and 5),
  venue_rating integer check (venue_rating between 1 and 5),
  body text,
  -- 'public' or 'hidden'. There is no 'private' — private is the log. Hidden is
  -- moderation's verb: the row survives (the author can still see their own),
  -- but it stops being served to anyone else.
  visibility text not null default 'public' check (visibility in ('public', 'hidden')),
  created_at text not null,
  -- Set on every edit after the first write; null means never edited.
  edited_at text,
  -- Soft, same anonymise-and-keep policy as users: reactions and comments will
  -- hang off reviews, and hard deletion either cascades away other people's
  -- writing or dangles.
  deleted_at text,
  -- One review per person per show, editable — the second write is an edit,
  -- not a second opinion.
  unique (user_id, event_id)
);

-- The three roll-up read paths (event page, artist page, venue page) and the
-- profile's "their reviews" list.
create index if not exists reviews_event_idx on reviews (event_id);
create index if not exists reviews_artist_idx on reviews (artist_id);
create index if not exists reviews_venue_idx on reviews (venue_id);
create index if not exists reviews_user_idx on reviews (user_id);

-- Guideline 1.2's "report objectionable content". target_kind is text rather
-- than a reviews foreign key because comments and lists will be reportable too.
create table if not exists reports (
  id text primary key,
  reporter_id text not null references users(id),
  target_kind text not null check (target_kind in ('review')),
  target_id text not null,
  reason text not null,
  created_at text not null,
  resolved_at text,
  -- What the resolution was ('hide' | 'keep'), for the audit trail.
  resolution text
);

create index if not exists reports_open_idx on reports (resolved_at);
create index if not exists reports_target_idx on reports (target_kind, target_id);

-- Guideline 1.2's "block abusive users". One direction per row; the read paths
-- hide content in both directions, because "I never want to see them" and
-- "they must not follow my writing" arrive as the same tap.
create table if not exists user_blocks (
  blocker_id text not null references users(id),
  blocked_id text not null references users(id),
  created_at text not null,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);
