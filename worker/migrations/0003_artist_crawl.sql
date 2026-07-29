-- Coverage from Bandsintown scales with how many artists we ask about, not with
-- how many places we sweep (its open API has no geographic search). Ingestion so
-- far only ran when a client asked for something, so coverage tracked traffic.
-- This is the work queue a Cron Trigger drains instead.

create table if not exists artist_sources (
  artist_id text not null references artists (id) on delete cascade,
  source text not null,
  -- The key that actually worked upstream ("id_15495936", or a display name that
  -- differs from ours). Null until the first successful lookup.
  source_key text,
  -- active: crawl on schedule. discovered: found in a lineup, never confirmed.
  -- not_found: the negative cache — upstream has no such artist. disabled: hand
  -- off the queue.
  state text not null default 'active',
  last_checked_at text,
  last_ok_at text,
  fail_count integer not null default 0,
  next_check_at text not null default '1970-01-01T00:00:00Z',
  primary key (artist_id, source)
);

-- The crawl's only read: the oldest due rows for one source.
create index if not exists artist_sources_due_idx
  on artist_sources (source, state, next_check_at);

-- When a client last asked about this artist. The crawl checks artists people
-- are actually looking at more often than the long tail.
alter table artists add column last_requested_at text;

-- Everyone we already know about joins the queue, due immediately, carrying the
-- unambiguous numeric key where phase 1 learned one.
insert into artist_sources (artist_id, source, source_key, state)
select id, 'bandsintown',
       case when bandsintown_id is not null then 'id_' || bandsintown_id else bandsintown_name end,
       'active'
  from artists
 where true
    on conflict (artist_id, source) do nothing;
