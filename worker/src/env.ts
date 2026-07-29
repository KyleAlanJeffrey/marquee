import type { D1Database, Fetcher } from '@cloudflare/workers-types';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TICKETMASTER_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  BANDSINTOWN_APP_ID?: string;
  /** Bearer token for /api/admin/* (unset = those routes are off). */
  ADMIN_TOKEN?: string;
};

/** Hono generics for typed `c.env` across the app. */
export type AppEnv = { Bindings: Env };
