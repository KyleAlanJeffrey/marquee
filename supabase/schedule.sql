-- Schedule the nightly ingestion job with pg_cron + pg_net.
-- Run this ONCE against your hosted project (SQL editor or psql) after
-- deploying the ingest-events function. It is not a migration because it
-- embeds project-specific values.
--
-- Replace:
--   <PROJECT_REF>  your Supabase project ref (abc123 in https://abc123.supabase.co)
--   <CRON_SECRET>  the same value you set with `supabase secrets set CRON_SECRET=...`

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'marquee-nightly-ingest',
  '0 9 * * *', -- 09:00 UTC daily (~1-2am US)
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ingest-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
