-- Marquee schema on Cloudflare D1 (SQLite).
--
-- No PostGIS: venue coordinates are plain lat/lng REAL columns, indexed for a
-- bounding-box prefilter; exact radius is computed with haversine in the Worker.
-- No auth/RLS/follows/profiles — the app is local-first (follows live on-device).
-- genres is a JSON array stored as TEXT.

create table artists (
  id text primary key,
  name text not null,
  spotify_id text unique,
  ticketmaster_id text unique,
  bandsintown_name text,
  image_url text,
  genres text not null default '[]',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

create table venues (
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

create index venues_latlng_idx on venues (lat, lng);

create table events (
  id text primary key,
  artist_id text not null references artists (id) on delete cascade,
  venue_id text references venues (id) on delete set null,
  name text not null,
  starts_at text not null,           -- ISO 8601 UTC, e.g. 2026-07-15T20:00:00Z
  ticket_url text,
  source text not null,
  source_event_id text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  unique (source, source_event_id)
);

create index events_starts_at_idx on events (starts_at);
create index events_artist_idx on events (artist_id, starts_at);

-- Per-area throttle for on-demand discovery.
create table discovery_log (
  cell text primary key,
  fetched_at text not null
);
