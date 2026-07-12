-- Per-area throttle for on-demand discovery. The discover-events function
-- stamps a coarse grid cell (rounded lat/lng) here after fetching, and skips
-- areas fetched recently. Service-role only (RLS on, no policies).

create table public.discovery_log (
  cell text primary key,
  fetched_at timestamptz not null default now()
);

alter table public.discovery_log enable row level security;
