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

-- ---------------------------------------------------------------------------
-- Dev seed: fictional artists, real venues, upcoming events (dates relative to
-- now so it never goes stale). Prices are deterministic samples (a couple null
-- → "Tickets" fallback).
-- ---------------------------------------------------------------------------
insert or ignore into artists (id, name, spotify_id, image_url, genres) values
  ('a0000000-0000-0000-0000-000000000001', 'The Midnight Reels',  'seed-midnight-reels',  'https://api.dicebear.com/9.x/glass/png?seed=midnight-reels',  '["indie rock","shoegaze"]'),
  ('a0000000-0000-0000-0000-000000000002', 'Neon Harbor',         'seed-neon-harbor',     'https://api.dicebear.com/9.x/glass/png?seed=neon-harbor',     '["synthpop","electronic"]'),
  ('a0000000-0000-0000-0000-000000000003', 'Juniper & The Foxes', 'seed-juniper-foxes',   'https://api.dicebear.com/9.x/glass/png?seed=juniper-foxes',   '["folk","americana"]'),
  ('a0000000-0000-0000-0000-000000000004', 'Static Bloom',        'seed-static-bloom',    'https://api.dicebear.com/9.x/glass/png?seed=static-bloom',    '["garage rock","punk"]'),
  ('a0000000-0000-0000-0000-000000000005', 'Velvet Antenna',      'seed-velvet-antenna',  'https://api.dicebear.com/9.x/glass/png?seed=velvet-antenna',  '["dream pop"]'),
  ('a0000000-0000-0000-0000-000000000006', 'DJ Marrow',           'seed-dj-marrow',       'https://api.dicebear.com/9.x/glass/png?seed=dj-marrow',       '["house","techno"]'),
  ('a0000000-0000-0000-0000-000000000007', 'The Paper Lanterns',  'seed-paper-lanterns',  'https://api.dicebear.com/9.x/glass/png?seed=paper-lanterns',  '["indie pop"]'),
  ('a0000000-0000-0000-0000-000000000008', 'Coyote Choir',        'seed-coyote-choir',    'https://api.dicebear.com/9.x/glass/png?seed=coyote-choir',    '["alt-country"]'),
  ('a0000000-0000-0000-0000-000000000009', 'Glass Atlas',         'seed-glass-atlas',     'https://api.dicebear.com/9.x/glass/png?seed=glass-atlas',     '["post-rock","instrumental"]'),
  ('a0000000-0000-0000-0000-000000000010', 'Mona Vex',            'seed-mona-vex',        'https://api.dicebear.com/9.x/glass/png?seed=mona-vex',        '["r&b","soul"]'),
  ('a0000000-0000-0000-0000-000000000011', 'Subduction Zone',     'seed-subduction-zone', 'https://api.dicebear.com/9.x/glass/png?seed=subduction-zone', '["metal","doom"]'),
  ('a0000000-0000-0000-0000-000000000012', 'Honey Pilot',         'seed-honey-pilot',     'https://api.dicebear.com/9.x/glass/png?seed=honey-pilot',     '["power pop"]');

insert or ignore into venues (id, source, source_venue_id, name, city, region, country, lat, lng) values
  ('b0000000-0000-0000-0000-000000000001', 'seed', 'fillmore',        'The Fillmore',              'San Francisco', 'CA', 'US', 37.7842, -122.4332),
  ('b0000000-0000-0000-0000-000000000002', 'seed', 'gamh',            'Great American Music Hall', 'San Francisco', 'CA', 'US', 37.7849, -122.4187),
  ('b0000000-0000-0000-0000-000000000003', 'seed', 'independent',     'The Independent',           'San Francisco', 'CA', 'US', 37.7756, -122.4376),
  ('b0000000-0000-0000-0000-000000000004', 'seed', 'warfield',        'The Warfield',              'San Francisco', 'CA', 'US', 37.7825, -122.4098),
  ('b0000000-0000-0000-0000-000000000005', 'seed', 'fox-oakland',     'Fox Theater',               'Oakland',       'CA', 'US', 37.8080, -122.2711),
  ('b0000000-0000-0000-0000-000000000006', 'seed', 'greek-berkeley',  'Greek Theatre',             'Berkeley',      'CA', 'US', 37.8735, -122.2542),
  ('b0000000-0000-0000-0000-000000000007', 'seed', 'catalyst',        'The Catalyst',              'Santa Cruz',    'CA', 'US', 36.9722, -122.0263),
  ('b0000000-0000-0000-0000-000000000008', 'seed', 'shoreline',       'Shoreline Amphitheatre',    'Mountain View', 'CA', 'US', 37.4267, -122.0807),
  ('b0000000-0000-0000-0000-000000000009', 'seed', 'troubadour',      'The Troubadour',            'West Hollywood','CA', 'US', 34.0816, -118.3892),
  ('b0000000-0000-0000-0000-000000000010', 'seed', 'hollywood-bowl',  'Hollywood Bowl',            'Los Angeles',   'CA', 'US', 34.1122, -118.3391),
  ('b0000000-0000-0000-0000-000000000011', 'seed', 'bowery-ballroom', 'Bowery Ballroom',           'New York',      'NY', 'US', 40.7204, -73.9934),
  ('b0000000-0000-0000-0000-000000000012', 'seed', 'msg',             'Madison Square Garden',     'New York',      'NY', 'US', 40.7505, -73.9934);

insert or ignore into events (id, artist_id, venue_id, name, starts_at, ticket_url, price_from, source, source_event_id) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'The Midnight Reels',       strftime('%Y-%m-%dT%H:%M:%SZ','now','+3 days','+20 hours'),  'https://example.com/tickets/mr-fillmore',  20,   'seed', 'evt-001'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'Neon Harbor: Signal Tour', strftime('%Y-%m-%dT%H:%M:%SZ','now','+5 days','+21 hours'),  'https://example.com/tickets/nh-indy',      25,   'seed', 'evt-002'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Juniper & The Foxes',      strftime('%Y-%m-%dT%H:%M:%SZ','now','+8 days','+19 hours'),  'https://example.com/tickets/jf-gamh',      30,   'seed', 'evt-003'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Static Bloom',             strftime('%Y-%m-%dT%H:%M:%SZ','now','+11 days','+21 hours'), 'https://example.com/tickets/sb-indy',      35,   'seed', 'evt-004'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Velvet Antenna',           strftime('%Y-%m-%dT%H:%M:%SZ','now','+14 days','+20 hours'), 'https://example.com/tickets/va-fillmore',  40,   'seed', 'evt-005'),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000004', 'DJ Marrow: All Night',     strftime('%Y-%m-%dT%H:%M:%SZ','now','+16 days','+22 hours'), 'https://example.com/tickets/dm-warfield',  15,   'seed', 'evt-006'),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000005', 'The Paper Lanterns',       strftime('%Y-%m-%dT%H:%M:%SZ','now','+19 days','+20 hours'), 'https://example.com/tickets/pl-fox',       NULL, 'seed', 'evt-007'),
  ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000002', 'Coyote Choir',             strftime('%Y-%m-%dT%H:%M:%SZ','now','+22 days','+19 hours'), 'https://example.com/tickets/cc-gamh',      25,   'seed', 'evt-008'),
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000006', 'Glass Atlas',              strftime('%Y-%m-%dT%H:%M:%SZ','now','+26 days','+20 hours'), 'https://example.com/tickets/ga-greek',     30,   'seed', 'evt-009'),
  ('c0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000005', 'Mona Vex: Velour Tour',    strftime('%Y-%m-%dT%H:%M:%SZ','now','+29 days','+20 hours'), 'https://example.com/tickets/mv-fox',       35,   'seed', 'evt-010'),
  ('c0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000004', 'Subduction Zone',          strftime('%Y-%m-%dT%H:%M:%SZ','now','+33 days','+21 hours'), 'https://example.com/tickets/sz-warfield',  40,   'seed', 'evt-011'),
  ('c0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000007', 'Honey Pilot',              strftime('%Y-%m-%dT%H:%M:%SZ','now','+36 days','+20 hours'), 'https://example.com/tickets/hp-catalyst',  15,   'seed', 'evt-012'),
  ('c0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000008', 'The Midnight Reels',       strftime('%Y-%m-%dT%H:%M:%SZ','now','+40 days','+19 hours'), 'https://example.com/tickets/mr-shoreline', 20,   'seed', 'evt-013'),
  ('c0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', 'DJ Marrow: All Night II',  strftime('%Y-%m-%dT%H:%M:%SZ','now','+44 days','+22 hours'), 'https://example.com/tickets/dm-indy',      NULL, 'seed', 'evt-014'),
  ('c0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000006', 'Juniper & The Foxes',      strftime('%Y-%m-%dT%H:%M:%SZ','now','+49 days','+19 hours'), 'https://example.com/tickets/jf-greek',     30,   'seed', 'evt-015'),
  ('c0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000009', 'Neon Harbor: Signal Tour', strftime('%Y-%m-%dT%H:%M:%SZ','now','+9 days','+21 hours'),  'https://example.com/tickets/nh-troub',     35,   'seed', 'evt-016'),
  ('c0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000010', 'Mona Vex: Velour Tour',    strftime('%Y-%m-%dT%H:%M:%SZ','now','+34 days','+20 hours'), 'https://example.com/tickets/mv-bowl',      40,   'seed', 'evt-017'),
  ('c0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000009', 'Static Bloom',             strftime('%Y-%m-%dT%H:%M:%SZ','now','+15 days','+21 hours'), 'https://example.com/tickets/sb-troub',     15,   'seed', 'evt-018'),
  ('c0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000011', 'Neon Harbor: Signal Tour', strftime('%Y-%m-%dT%H:%M:%SZ','now','+13 days','+21 hours'), 'https://example.com/tickets/nh-bowery',    20,   'seed', 'evt-019'),
  ('c0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000012', 'Mona Vex: Velour Tour',    strftime('%Y-%m-%dT%H:%M:%SZ','now','+38 days','+20 hours'), 'https://example.com/tickets/mv-msg',       25,   'seed', 'evt-020'),
  ('c0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000011', 'Velvet Antenna',           strftime('%Y-%m-%dT%H:%M:%SZ','now','+21 days','+20 hours'), 'https://example.com/tickets/va-bowery',    NULL, 'seed', 'evt-021');
