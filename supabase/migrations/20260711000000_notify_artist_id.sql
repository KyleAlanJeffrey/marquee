-- Add artist_id to followers_to_notify so push notifications can deep-link the
-- recipient straight to the artist page on tap. Return-type change requires a
-- drop + recreate (CREATE OR REPLACE can't alter a function's OUT columns).

drop function if exists public.followers_to_notify(uuid[]);

create function public.followers_to_notify(p_event_ids uuid[])
returns table (
  event_id uuid,
  user_id uuid,
  expo_push_token text,
  artist_id uuid,
  artist_name text,
  event_name text,
  venue_name text,
  venue_city text,
  starts_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, p.id, p.expo_push_token, a.id, a.name, e.name, v.name, v.city, e.starts_at
  from events e
  join artists a on a.id = e.artist_id
  join follows f on f.artist_id = e.artist_id
  join profiles p on p.id = f.user_id
  join venues v on v.id = e.venue_id
  where e.id = any (p_event_ids)
    and e.notified_at is null
    and p.expo_push_token is not null
    and p.home_location is not null
    and v.location is not null
    and st_dwithin(v.location, p.home_location, p.notify_radius_miles * 1609.34);
$$;

revoke execute on function public.followers_to_notify(uuid[]) from public, anon, authenticated;
grant execute on function public.followers_to_notify(uuid[]) to service_role;
