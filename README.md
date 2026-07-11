# Marquee 🎪

Follow music artists and get notified when they book a concert near you — plus discover artists you *don't* follow who are playing in your area.

See [TECH_STACK.md](TECH_STACK.md) for the full architecture writeup. Short version: Expo (React Native + TypeScript) app on a Supabase backend (Postgres + PostGIS, Edge Functions), with concert data ingested nightly from Ticketmaster and Bandsintown and artist metadata from Spotify.

## Project layout

```
src/
  app/            expo-router screens (tabs: Following, Near Me, Settings; search modal; artist detail)
  components/     UI building blocks (EventCard, FollowButton, EmptyState, themed primitives)
  lib/            supabase client, TanStack Query hooks, location/notifications/format helpers
supabase/
  migrations/     schema: profiles, artists, follows, venues, events + RPCs (PostGIS)
  seed.sql        dev data: 12 fictional artists, real venues, ~8 weeks of events
  functions/
    search-artists/   Spotify search proxy (user-facing)
    ingest-events/    nightly Ticketmaster+Bandsintown ingest + push notifications (cron)
  schedule.sql    pg_cron setup for the nightly job (run once against hosted project)
```

## Getting started

Prereqs: Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`), Docker (for local Supabase).

**Quick start (one command):**

```sh
npm install
npm run dev                     # brings up Supabase, writes .env, launches Expo
```

`npm run dev` ([scripts/dev.sh](scripts/dev.sh)) checks for the Supabase CLI,
starts Docker if needed, runs `supabase start` (migrations + seed), writes `.env`
from the local credentials, then launches Expo. Re-runnable and idempotent. Pass
`npm run dev -- --no-app` to bring up only the backend.

**Or step by step:**

```sh
npm install

# 1. Start the backend (applies migrations + seed data automatically)
supabase start

# 2. Configure the app
cp .env.example .env            # paste the URL + anon key that `supabase start` printed

# 3. Run the app
npx expo start                  # press i / a, or scan with Expo Go
```

That's enough to use the whole app with **seed data** — no API keys needed. The seed ([supabase/seed.sql](supabase/seed.sql)) ships fictional artists playing real venues, mostly around San Francisco because that's the iOS simulator's default location. Open **Near Me**, tap a show, and follow artists from there (artist search needs a Spotify key, but following from Near Me doesn't).

### Real data (optional)

```sh
# Configure function secrets (Spotify/Ticketmaster keys — see file for links)
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve        # runs search-artists + ingest-events locally
```

Then trigger ingestion by hand:

```sh
curl -X POST http://127.0.0.1:54321/functions/v1/ingest-events \
  -H "x-cron-secret: $CRON_SECRET"
```

## Deploying

1. `supabase link --project-ref <ref>` then `supabase db push`.
2. `supabase secrets set --env-file supabase/functions/.env`
3. `supabase functions deploy search-artists ingest-events`
4. Run [supabase/schedule.sql](supabase/schedule.sql) (with placeholders filled in) in the SQL editor to schedule the nightly ingest.
5. Build the app with EAS (`eas build`) — push notifications require a dev build or store build on a physical device.

## API keys needed

| Key | Where | Used by |
|---|---|---|
| Spotify client id/secret | developer.spotify.com | search-artists |
| Ticketmaster Discovery key | developer.ticketmaster.com | ingest-events |
| Bandsintown app id (optional) | artists.bandsintown.com | ingest-events |

## How it works

- The app signs every device in **anonymously** on first launch; follows, home location, and push tokens hang off that user (upgradeable to email/social later).
- **Following tab** — upcoming shows for artists you follow (`followed_events` RPC), with distance from your home area.
- **Near Me tab** — shows within a radius of your current location from artists you *don't* follow (`nearby_events` RPC, PostGIS `ST_DWithin`).
- **Nightly ingest** — pulls events for every followed artist (Ticketmaster + Bandsintown) and discovery events around every user metro, dedupes on `(source, source_event_id)`, then pushes notifications to followers whose home area is within their alert radius of newly-seen events.
