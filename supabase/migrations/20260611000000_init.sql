-- Marquee initial schema
-- Geo queries are the core of the app, so everything venue/user-location related
-- is a PostGIS geography(point) with a GiST index.

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically on signup
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  home_location geography (point, 4326),
  home_label text,
  notify_radius_miles integer not null default 50 check (notify_radius_miles between 5 and 500),
  expo_push_token text,
  created_at timestamptz not null default now()
);

create index profiles_home_location_idx on public.profiles using gist (home_location);

alter table public.profiles enable row level security;

create policy "users manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- artists
-- ---------------------------------------------------------------------------
create table public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spotify_id text unique,
  ticketmaster_id text unique,
  bandsintown_name text,
  image_url text,
  genres text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.artists enable row level security;

create policy "artists are readable by signed-in users"
  on public.artists for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table public.follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);

create index follows_artist_id_idx on public.follows (artist_id);

alter table public.follows enable row level security;

create policy "users manage own follows"
  on public.follows for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_venue_id text not null,
  name text not null,
  city text,
  region text,
  country text,
  location geography (point, 4326),
  unique (source, source_venue_id)
);

create index venues_location_idx on public.venues using gist (location);

alter table public.venues enable row level security;

create policy "venues are readable by signed-in users"
  on public.venues for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete set null,
  name text not null,
  starts_at timestamptz not null,
  ticket_url text,
  source text not null,
  source_event_id text not null,
  created_at timestamptz not null default now(),
  -- set once followers have been pushed about this event
  notified_at timestamptz,
  unique (source, source_event_id)
);

create index events_artist_starts_idx on public.events (artist_id, starts_at);
create index events_starts_at_idx on public.events (starts_at);

alter table public.events enable row level security;

create policy "events are readable by signed-in users"
  on public.events for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Follow an artist found via Spotify search: upsert the artist row and the
-- follow in one transaction. security definer because clients can't write
-- to artists directly.
create function public.follow_artist(
  p_spotify_id text,
  p_name text,
  p_image_url text default null,
  p_genres text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into artists (spotify_id, name, image_url, genres)
  values (p_spotify_id, p_name, p_image_url, p_genres)
  on conflict (spotify_id) do update
    set name = excluded.name,
        image_url = coalesce(excluded.image_url, artists.image_url),
        genres = case when excluded.genres = '{}' then artists.genres else excluded.genres end
  returning id into v_artist_id;

  insert into follows (user_id, artist_id)
  values (auth.uid(), v_artist_id)
  on conflict do nothing;

  return v_artist_id;
end;
$$;

-- Update the caller's home location (geography is awkward to write from the
-- client, so wrap it).
create function public.set_home_location(
  p_lat double precision,
  p_lng double precision,
  p_label text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
  set home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      home_label = coalesce(p_label, home_label)
  where id = auth.uid();
$$;

-- Feature 1: upcoming events for artists the caller follows.
-- distance_miles is null when the user has no home location set.
create function public.followed_events()
returns table (
  event_id uuid,
  event_name text,
  starts_at timestamptz,
  ticket_url text,
  artist_id uuid,
  artist_name text,
  artist_image_url text,
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
    v.name,
    v.city,
    v.region,
    st_distance(v.location, p.home_location) / 1609.34
  from events e
  join artists a on a.id = e.artist_id
  join follows f on f.artist_id = a.id and f.user_id = auth.uid()
  left join venues v on v.id = e.venue_id
  left join profiles p on p.id = auth.uid()
  where e.starts_at >= now()
  order by e.starts_at;
$$;

-- Feature 2: upcoming events near a point from artists the caller does NOT
-- follow, soonest first.
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
  where e.starts_at between now() and now() + interval '60 days'
    and st_dwithin(
      v.location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius_miles * 1609.34
    )
    and not exists (
      select 1 from follows f
      where f.user_id = auth.uid() and f.artist_id = a.id
    )
  order by e.starts_at;
$$;

-- ---------------------------------------------------------------------------
-- Service-side helpers (called by the ingest-events edge function with the
-- service role key; not reachable with user JWTs)
-- ---------------------------------------------------------------------------

-- Distinct user home areas, rounded to ~0.1 degree, so ingestion knows which
-- metros to pull discovery events for.
create function public.user_metros()
returns table (lat double precision, lng double precision)
language sql
security definer
set search_path = public
stable
as $$
  select distinct
    round(st_y(home_location::geometry)::numeric, 1)::double precision,
    round(st_x(home_location::geometry)::numeric, 1)::double precision
  from profiles
  where home_location is not null;
$$;

revoke execute on function public.user_metros() from public, anon, authenticated;
grant execute on function public.user_metros() to service_role;

-- For freshly ingested events: which followers should be pushed?
-- Only users with a push token AND a home location within their notify radius.
create function public.followers_to_notify(p_event_ids uuid[])
returns table (
  event_id uuid,
  user_id uuid,
  expo_push_token text,
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
  select e.id, p.id, p.expo_push_token, a.name, e.name, v.name, v.city, e.starts_at
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

-- Upcoming events for one artist (artist detail screen).
create function public.artist_events(p_artist_id uuid)
returns table (
  event_id uuid,
  event_name text,
  starts_at timestamptz,
  ticket_url text,
  venue_name text,
  venue_city text,
  venue_region text
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.name, e.starts_at, e.ticket_url, v.name, v.city, v.region
  from events e
  left join venues v on v.id = e.venue_id
  where e.artist_id = p_artist_id and e.starts_at >= now()
  order by e.starts_at;
$$;
