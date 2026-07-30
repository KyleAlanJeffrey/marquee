import type { D1Database, Fetcher } from '@cloudflare/workers-types';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TICKETMASTER_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  BANDSINTOWN_APP_ID?: string;
  SEATGEEK_CLIENT_ID?: string;
  /** Bearer token for /api/admin/* (unset = those routes are off). */
  ADMIN_TOKEN?: string;
  /**
   * The one hostname the site should be indexed under, e.g. `marquee.rocks`.
   *
   * The Worker also answers on its `*.workers.dev` name, and every canonical,
   * og:url and sitemap entry used to be built from whichever host asked — so the
   * two hostnames each claimed to be canonical and split the ranking signals of
   * every page between them. Set this and there is one answer. Unset (local dev)
   * falls back to the request's own origin.
   */
  PRIMARY_HOST?: string;
};

/** Hono generics for typed `c.env` across the app. */
export type AppEnv = { Bindings: Env };
