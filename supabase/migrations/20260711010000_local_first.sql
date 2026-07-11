-- Local-first pivot.
--
-- Follows now live on the device (AsyncStorage), so the app runs with no user
-- account. Two consequences for the backend:
--
--   1. The client talks to Postgres as the `anon` role, so catalog data
--      (artists / venues / events) must be readable by anon.
--   2. `nearby_events` no longer excludes "artists you follow" (the server
--      doesn't know who you follow anymore). It returns every upcoming nearby
--      show and also exposes the artist's spotify id, so the client can flag
--      the ones you follow locally.

-- 1. Anon read access to the public catalog ---------------------------------
-- RLS needs both a table-level GRANT and a row policy for the anon role.
grant select on public.artists to anon;
grant select on public.venues to anon;
grant select on public.events to anon;

create policy "artists readable by anon"
  on public.artists for select to anon using (true);

create policy "venues readable by anon"
  on public.venues for select to anon using (true);

create policy "events readable by anon"
  on public.events for select to anon using (true);

-- 2. Rework nearby_events (return-type change => drop + recreate) ------------
drop function if exists public.nearby_events(double precision, double precision, integer);

create function public.nearby_events(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles integer default 50
)
returns table (
  event_id uuid,
  event_name text,
  starts_at timestamptz,
  ticket_url text,
  artist_id uuid,
  artist_name text,
  artist_image_url text,
  artist_spotify_id text,
  artist_genres text[],
  venue_name text,
  venue_city text,
  venue_region text,
  distance_miles double precision
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.id,
    e.name,
    e.starts_at,
    e.ticket_url,
    a.id,
    a.name,
    a.image_url,
    a.spotify_id,
    a.genres,
    v.name,
    v.city,
    v.region,
    st_distance(
      v.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
    ) / 1609.34
  from events e
  join artists a on a.id = e.artist_id
  join venues v on v.id = e.venue_id
  where e.starts_at between now() and now() + interval '120 days'
    and st_dwithin(
      v.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius_miles * 1609.34
    )
  order by e.starts_at;
$$;
