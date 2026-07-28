-- Marquee database (Cloudflare D1 / SQLite) — full schema + dev seed in one file.
-- Apply with:  wrangler d1 execute marquee --local --file=schema.sql
--        (or)  wrangler d1 execute marquee --remote --file=schema.sql
--
-- Idempotent: CREATE ... IF NOT EXISTS and INSERT OR IGNORE, so re-running keeps
-- existing data. No PostGIS — venue coords are lat/lng, radius search is a
-- bounding-box prefilter + haversine in the Worker. genres is JSON text.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
create table if not exists artists (
  id text primary key,
  name text not null,
  spotify_id text unique,
  ticketmaster_id text unique,
  bandsintown_name text,
  image_url text,
  genres text not null default '[]',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

create table if not exists venues (
  id text primary key,
  source text not null,
  source_venue_id text not null,
  name text not null,
  city text,
  region text,
  country text,
  lat real,
  lng real,
  unique (source, source_venue_id)
);

create index if not exists venues_latlng_idx on venues (lat, lng);

create table if not exists events (
  id text primary key,
  artist_id text not null references artists (id) on delete cascade,
  venue_id text references venues (id) on delete set null,
  name text not null,
  starts_at text not null,           -- ISO 8601 UTC, e.g. 2026-07-15T20:00:00Z
  ticket_url text,
  price_from real,
  source text not null,
  source_event_id text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  unique (source, source_event_id)
);

create index if not exists events_starts_at_idx on events (starts_at);
create index if not exists events_artist_idx on events (artist_id, starts_at);

create table if not exists discovery_log (
  cell text primary key,
  fetched_at text not null
);
