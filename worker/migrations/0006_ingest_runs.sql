-- Bandsintown contributed zero events for weeks because its key was unset and
-- every code path no-oped politely. Counting rows per source told us that *after*
-- someone thought to look; a run log says it on its own.
create table if not exists ingest_runs (
  id text primary key,
  source text not null,
  -- crawl | backfill | discover | refresh-artists | refresh-venue
  kind text not null,
  started_at text not null,
  finished_at text,
  scanned integer not null default 0,
  inserted integer not null default 0,
  failed integer not null default 0,
  -- Short note: an abort reason, or a rejected credential.
  note text
);

create index if not exists ingest_runs_recent_idx on ingest_runs (source, started_at);
