-- Ticketmaster events carry a price range; capture the low end so the UI can
-- show "$N+". Fictional seed events get deterministic sample prices for the demo
-- (a couple left null → "Tickets" fallback).

alter table events add column price_from real;

update events
set price_from = 15 + (cast(substr(source_event_id, -2) as integer) % 6) * 5
where source = 'seed' and cast(substr(source_event_id, -2) as integer) % 7 != 0;
