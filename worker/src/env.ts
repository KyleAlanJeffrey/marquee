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
  /**
   * IndexNow key — any 8–128 characters of `[A-Za-z0-9-]` that you invent.
   *
   * Set it and the hourly crawl announces the shows it just wrote to Bing, Yandex
   * and the rest, and `/<key>.txt` starts answering with the key so they can check
   * we own it. Unset (the default, and local dev) and nothing is submitted. Needs
   * `PRIMARY_HOST` too: IndexNow rejects a URL list whose host it can't verify.
   */
  INDEXNOW_KEY?: string;
};

/** Hono generics for typed `c.env` across the app. */
export type AppEnv = { Bindings: Env };
