-- IndexNow answered 429 "Too Many Requests (potential Spam)" on every cron run,
-- while a one-off POST of 200 never-submitted event URLs from the same host and
-- key was accepted. The difference wasn't volume: it was that each run re-sent `/`
-- and every affected city hub, so the same couple of hundred listing URLs were
-- announced 96 times a day.
--
-- This table is what makes "already announced" answerable. Only listing pages go
-- in it — event URLs are new by construction, since the crawl selects on
-- created_at. That bounds the table at the number of towns with shows (~1,700) and
-- keeps it there, because a repeat submission updates the row rather than adding
-- one.
create table if not exists indexnow_log (
  url text primary key,
  submitted_at text not null
);

create index if not exists indexnow_log_submitted_idx on indexnow_log (submitted_at);
