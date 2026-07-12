-- Expose venue coordinates from nearby_events so the client can plot the
-- "Nearby Venues" map. Return-type change => drop + recreate.

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
  venue_lat double precision,
  venue_lng double precision,
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
    st_y(v.location::geometry),
    st_x(v.location::geometry),
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
