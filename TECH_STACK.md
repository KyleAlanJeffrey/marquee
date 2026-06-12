# Marquee — Tech Stack

Marquee lets you follow music artists and get notified when they book a show near you. It also surfaces artists you *don't* follow who are playing in your area right now.

Those two features drive every choice below: we need **location**, **push notifications**, **a reliable source of concert data**, and **geo-aware queries** — on a stack one person can build and run cheaply.

## At a glance

| Layer | Choice |
|---|---|
| Mobile app | Expo (React Native) + TypeScript |
| Navigation | Expo Router |
| Server state | TanStack Query |
| Styling | React Native StyleSheet + theme constants |
| Backend | Supabase (Postgres, Auth, Edge Functions) |
| Geo queries | PostGIS extension |
| Job scheduling | pg_cron + Edge Functions |
| Concert data | Ticketmaster Discovery API + Bandsintown API |
| Artist metadata | Spotify Web API |
| Push notifications | Expo Push Notifications |

## Client: Expo (React Native + TypeScript)

A concert alert is only useful if it reaches you, and the discovery feature needs your location — both are native-mobile strengths, so Marquee is mobile-first.

- **Expo** gives us one TypeScript codebase for iOS and Android, with first-class modules for the two capabilities we depend on: `expo-location` and `expo-notifications`. EAS handles builds and store submission without local Xcode/Android Studio wrangling.
- **Expo Router** for file-based navigation. The app is small — roughly four screens: Following, Near Me, Artist Detail, Settings.
- **TanStack Query** for all server data (followed artists, upcoming events, nearby events). Caching and pull-to-refresh come nearly free, which matters for an app people open in bursts.
- **StyleSheet + theme constants** for styling — plain React Native styles with a small light/dark palette (`src/constants/theme.ts`). Zero build-time config; NativeWind can be layered on later if the UI grows.

Expo also targets web, so a browser version stays on the table without a rewrite.

## Backend: Supabase

A solo-friendly backend that's still "just Postgres" underneath:

- **Postgres + PostGIS** — the core query in Marquee is geographic: *events within N miles of the user*. PostGIS makes that a single indexed `ST_DWithin` query over venue coordinates. This is the main reason to prefer Postgres over a document store.
- **Supabase Auth** — email/Apple/Google sign-in with row-level security, so "my followed artists" is enforced at the database layer.
- **Edge Functions (TypeScript)** — thin server-side logic: ingesting events from the concert APIs, matching new events against followers, sending pushes. No standing server to maintain.
- **pg_cron** — schedules the ingestion job (e.g. nightly: refresh events for every followed artist + every metro area with active users).

## Concert data

No single API has complete coverage, so we ingest from two and dedupe into our own `events` table:

- **Ticketmaster Discovery API** — free tier, strong venue/geo data (lat/long on every event), good US/major-market coverage. Supports both query shapes we need: *events by attraction (artist)* and *events by lat/long radius* — the latter powers the "artists near me that I don't follow" feed.
- **Bandsintown API** — artist-centric and strong on smaller/indie acts and club shows that Ticketmaster misses. Used to backfill events for followed artists.

Ingesting into our own table (rather than querying the APIs live from the app) is deliberate: it lets us diff "new event appeared" to trigger notifications, dedupe across sources, and keep the app fast and within API rate limits.

## Artist metadata: Spotify Web API

- Artist search and canonical artist identity (names alone are ambiguous), plus images and genres for the UI.
- Future win: OAuth lets a user import their followed/top artists from Spotify in one tap instead of searching one by one.

## Notifications

- **Expo Push Notifications** — one API for APNs and FCM, no certificate juggling.
- Flow: nightly ingest finds a new event → SQL join of `events` × `follows` × user home location (PostGIS radius) → batch push via Expo's push service.

## Data model (first cut)

```
users      (id, home_location geography, notify_radius_miles)
artists    (id, spotify_id, ticketmaster_id, bandsintown_id, name, image_url, genres)
follows    (user_id, artist_id)
venues     (id, name, location geography, city)
events     (id, artist_id, venue_id, starts_at, ticket_url, source, source_event_id)
```

The two product features map to two queries:

1. **Followed-artist alerts:** new rows in `events` joined to `follows`, filtered by `ST_DWithin(venue.location, user.home_location, radius)`.
2. **Near-me discovery:** `events` in the next ~60 days within radius of the user's current location, `WHERE artist_id NOT IN (user's follows)`, ranked by date/popularity.

## What we're deliberately not using (yet)

- **No dedicated backend server** (Express/Fastify/Rails) — Edge Functions + Postgres cover ingestion and queries until proven otherwise.
- **No Redis/queue** — pg_cron and batch jobs are enough at this scale.
- **No native Swift/Kotlin** — nothing in v1 requires it; Expo modules cover location and push.

## Local development

- `npx create-expo-app` + Expo Go for instant device testing.
- `supabase start` runs the full backend (Postgres/PostGIS, auth, functions) locally via Docker.
- Migrations checked into the repo via the Supabase CLI.
