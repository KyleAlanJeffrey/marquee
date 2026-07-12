-- Grant the service_role full access to the public schema, matching hosted
-- Supabase (which grants this automatically). Our edge functions write with the
-- service-role key; without these grants, inserts fail with "permission denied"
-- on a fresh/local database. Idempotent and a no-op on hosted projects.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
