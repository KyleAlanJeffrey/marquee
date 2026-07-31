-- Search radius and the reminders switch, moved onto the account.
--
-- These were the last two things living in the device's storage. Everything a person
-- owns is account-bound now — the four lists went to `user_lists`, and the decision
-- (2026-07-31) was that there is no local copy of anything, so a preference has to
-- live here too or it does not live anywhere.
--
-- Columns on `users` rather than another `user_lists` row, because prefs are a fixed
-- pair of scalars and not a list. A JSON document would mean parsing on every read of
-- a value that is one integer and one boolean, and `kind` in `user_lists` is a CHECK
-- constraint that SQLite cannot extend without rebuilding the table.
--
-- Both nullable, and null means "never chosen" rather than zero — the client falls
-- back to its own defaults (50 miles, reminders off), so a new account behaves like a
-- new install and an existing one keeps whatever it picked.

alter table users add column radius_miles integer;
-- SQLite has no boolean: 0 or 1, and null for "never asked".
alter table users add column reminders_enabled integer;
