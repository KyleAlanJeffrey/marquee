-- Dev seed data: fictional artists, real venues, upcoming events.
-- Applied automatically by `supabase start` / `supabase db reset`.
--
-- Venues are mostly SF Bay Area because that's the iOS simulator's default
-- location, so the Near Me tab works out of the box. Event dates are relative
-- to now(), so the seed never goes stale. Follow artists from the Near Me tab
-- (tap a show -> Follow) — no Spotify key needed.

-- ---------------------------------------------------------------------------
-- Artists (fictional)
-- ---------------------------------------------------------------------------
insert into public.artists (id, name, spotify_id, image_url, genres) values
  ('a0000000-0000-0000-0000-000000000001', 'The Midnight Reels',  'seed-midnight-reels',  'https://api.dicebear.com/9.x/glass/png?seed=midnight-reels',  '{indie rock,shoegaze}'),
  ('a0000000-0000-0000-0000-000000000002', 'Neon Harbor',         'seed-neon-harbor',     'https://api.dicebear.com/9.x/glass/png?seed=neon-harbor',     '{synthpop,electronic}'),
  ('a0000000-0000-0000-0000-000000000003', 'Juniper & The Foxes', 'seed-juniper-foxes',   'https://api.dicebear.com/9.x/glass/png?seed=juniper-foxes',   '{folk,americana}'),
  ('a0000000-0000-0000-0000-000000000004', 'Static Bloom',        'seed-static-bloom',    'https://api.dicebear.com/9.x/glass/png?seed=static-bloom',    '{garage rock,punk}'),
  ('a0000000-0000-0000-0000-000000000005', 'Velvet Antenna',      'seed-velvet-antenna',  'https://api.dicebear.com/9.x/glass/png?seed=velvet-antenna',  '{dream pop}'),
  ('a0000000-0000-0000-0000-000000000006', 'DJ Marrow',           'seed-dj-marrow',       'https://api.dicebear.com/9.x/glass/png?seed=dj-marrow',       '{house,techno}'),
  ('a0000000-0000-0000-0000-000000000007', 'The Paper Lanterns',  'seed-paper-lanterns',  'https://api.dicebear.com/9.x/glass/png?seed=paper-lanterns',  '{indie pop}'),
  ('a0000000-0000-0000-0000-000000000008', 'Coyote Choir',        'seed-coyote-choir',    'https://api.dicebear.com/9.x/glass/png?seed=coyote-choir',    '{alt-country}'),
  ('a0000000-0000-0000-0000-000000000009', 'Glass Atlas',         'seed-glass-atlas',     'https://api.dicebear.com/9.x/glass/png?seed=glass-atlas',     '{post-rock,instrumental}'),
  ('a0000000-0000-0000-0000-000000000010', 'Mona Vex',            'seed-mona-vex',        'https://api.dicebear.com/9.x/glass/png?seed=mona-vex',        '{r&b,soul}'),
  ('a0000000-0000-0000-0000-000000000011', 'Subduction Zone',     'seed-subduction-zone', 'https://api.dicebear.com/9.x/glass/png?seed=subduction-zone', '{metal,doom}'),
  ('a0000000-0000-0000-0000-000000000012', 'Honey Pilot',         'seed-honey-pilot',     'https://api.dicebear.com/9.x/glass/png?seed=honey-pilot',     '{power pop}');

-- ---------------------------------------------------------------------------
-- Venues (real places, real coordinates) — location is POINT(lng lat)
-- ---------------------------------------------------------------------------
insert into public.venues (id, source, source_venue_id, name, city, region, country, location) values
  ('b0000000-0000-0000-0000-000000000001', 'seed', 'fillmore',        'The Fillmore',              'San Francisco', 'CA', 'US', 'POINT(-122.4332 37.7842)'),
  ('b0000000-0000-0000-0000-000000000002', 'seed', 'gamh',            'Great American Music Hall', 'San Francisco', 'CA', 'US', 'POINT(-122.4187 37.7849)'),
  ('b0000000-0000-0000-0000-000000000003', 'seed', 'independent',     'The Independent',           'San Francisco', 'CA', 'US', 'POINT(-122.4376 37.7756)'),
  ('b0000000-0000-0000-0000-000000000004', 'seed', 'warfield',        'The Warfield',              'San Francisco', 'CA', 'US', 'POINT(-122.4098 37.7825)'),
  ('b0000000-0000-0000-0000-000000000005', 'seed', 'fox-oakland',     'Fox Theater',               'Oakland',       'CA', 'US', 'POINT(-122.2711 37.8080)'),
  ('b0000000-0000-0000-0000-000000000006', 'seed', 'greek-berkeley',  'Greek Theatre',             'Berkeley',      'CA', 'US', 'POINT(-122.2542 37.8735)'),
  ('b0000000-0000-0000-0000-000000000007', 'seed', 'catalyst',        'The Catalyst',              'Santa Cruz',    'CA', 'US', 'POINT(-122.0263 36.9722)'),
  ('b0000000-0000-0000-0000-000000000008', 'seed', 'shoreline',       'Shoreline Amphitheatre',    'Mountain View', 'CA', 'US', 'POINT(-122.0807 37.4267)'),
  ('b0000000-0000-0000-0000-000000000009', 'seed', 'troubadour',      'The Troubadour',            'West Hollywood','CA', 'US', 'POINT(-118.3892 34.0816)'),
  ('b0000000-0000-0000-0000-000000000010', 'seed', 'hollywood-bowl',  'Hollywood Bowl',            'Los Angeles',   'CA', 'US', 'POINT(-118.3391 34.1122)'),
  ('b0000000-0000-0000-0000-000000000011', 'seed', 'bowery-ballroom', 'Bowery Ballroom',           'New York',      'NY', 'US', 'POINT(-73.9934 40.7204)'),
  ('b0000000-0000-0000-0000-000000000012', 'seed', 'msg',             'Madison Square Garden',     'New York',      'NY', 'US', 'POINT(-73.9934 40.7505)');

-- ---------------------------------------------------------------------------
-- Events: spread over the next ~8 weeks, evenings local-ish (8pm UTC-7).
-- A few artists are "on tour" and hit multiple cities.
-- ---------------------------------------------------------------------------
insert into public.events (artist_id, venue_id, name, starts_at, ticket_url, source, source_event_id) values
  -- Bay Area shows (these power the Near Me tab on the simulator)
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'The Midnight Reels',          now() + interval '3 days'  + interval '20 hours', 'https://example.com/tickets/mr-fillmore',   'seed', 'evt-001'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'Neon Harbor: Signal Tour',    now() + interval '5 days'  + interval '21 hours', 'https://example.com/tickets/nh-indy',       'seed', 'evt-002'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Juniper & The Foxes',         now() + interval '8 days'  + interval '19 hours', 'https://example.com/tickets/jf-gamh',       'seed', 'evt-003'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'Static Bloom',                now() + interval '11 days' + interval '21 hours', 'https://example.com/tickets/sb-indy',       'seed', 'evt-004'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Velvet Antenna',              now() + interval '14 days' + interval '20 hours', 'https://example.com/tickets/va-fillmore',   'seed', 'evt-005'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000004', 'DJ Marrow: All Night',        now() + interval '16 days' + interval '22 hours', 'https://example.com/tickets/dm-warfield',   'seed', 'evt-006'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000005', 'The Paper Lanterns',          now() + interval '19 days' + interval '20 hours', 'https://example.com/tickets/pl-fox',        'seed', 'evt-007'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000002', 'Coyote Choir',                now() + interval '22 days' + interval '19 hours', 'https://example.com/tickets/cc-gamh',       'seed', 'evt-008'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000006', 'Glass Atlas',                 now() + interval '26 days' + interval '20 hours', 'https://example.com/tickets/ga-greek',      'seed', 'evt-009'),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000005', 'Mona Vex: Velour Tour',       now() + interval '29 days' + interval '20 hours', 'https://example.com/tickets/mv-fox',        'seed', 'evt-010'),
  ('a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000004', 'Subduction Zone',             now() + interval '33 days' + interval '21 hours', 'https://example.com/tickets/sz-warfield',   'seed', 'evt-011'),
  ('a0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000007', 'Honey Pilot',                 now() + interval '36 days' + interval '20 hours', 'https://example.com/tickets/hp-catalyst',   'seed', 'evt-012'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000008', 'The Midnight Reels',          now() + interval '40 days' + interval '19 hours', 'https://example.com/tickets/mr-shoreline',  'seed', 'evt-013'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', 'DJ Marrow: All Night II',     now() + interval '44 days' + interval '22 hours', 'https://example.com/tickets/dm-indy',       'seed', 'evt-014'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000006', 'Juniper & The Foxes',         now() + interval '49 days' + interval '19 hours', 'https://example.com/tickets/jf-greek',      'seed', 'evt-015'),

  -- LA dates (tour stops — visible on artist pages, filtered out of Near Me)
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000009', 'Neon Harbor: Signal Tour',    now() + interval '9 days'  + interval '21 hours', 'https://example.com/tickets/nh-troub',      'seed', 'evt-016'),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000010', 'Mona Vex: Velour Tour',       now() + interval '34 days' + interval '20 hours', 'https://example.com/tickets/mv-bowl',       'seed', 'evt-017'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000009', 'Static Bloom',                now() + interval '15 days' + interval '21 hours', 'https://example.com/tickets/sb-troub',      'seed', 'evt-018'),

  -- NYC dates
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000011', 'Neon Harbor: Signal Tour',    now() + interval '13 days' + interval '21 hours', 'https://example.com/tickets/nh-bowery',     'seed', 'evt-019'),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000012', 'Mona Vex: Velour Tour',       now() + interval '38 days' + interval '20 hours', 'https://example.com/tickets/mv-msg',        'seed', 'evt-020'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000011', 'Velvet Antenna',              now() + interval '21 days' + interval '20 hours', 'https://example.com/tickets/va-bowery',     'seed', 'evt-021');
