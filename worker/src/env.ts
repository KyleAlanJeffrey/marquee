import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

/**
 * What both Workers share: the database, the upstream source keys, and the
 * identity of the site they're working for. Ingestion, enrichment and IndexNow
 * are written against this type so they can run from either Worker.
 */
export type CoreEnv = {
  DB: D1Database;
  /**
   * The image mirror (R2 bucket `marquee`) behind `/img/…`. Optional: without
   * it every image route falls back to redirecting at the upstream URL, so a
   * dev setup with no bucket keeps working — it just doesn't mirror.
   */
  IMAGES?: R2Bucket;
  TICKETMASTER_API_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  BANDSINTOWN_APP_ID?: string;
  SEATGEEK_CLIENT_ID?: string;
  /**
   * The one hostname the site should be indexed under, e.g. `marquee.rocks`.
   *
   * The Worker also answers on its `*.workers.dev` name, and every canonical,
   * og:url and sitemap entry used to be built from whichever host asked — so the
   * two hostnames each claimed to be canonical and split the ranking signals of
   * every page between them. Set this and there is one answer. Unset (local dev)
   * falls back to the request's own origin.
   *
   * The jobs Worker needs it too: IndexNow submissions carry absolute URLs.
   */
  PRIMARY_HOST?: string;
  /**
   * IndexNow key — any 8–128 characters of `[A-Za-z0-9-]` that you invent.
   *
   * Set on both Workers, for the two halves of the protocol: the jobs Worker
   * *submits* freshly written URLs after each crawl, and the website answers
   * the ownership check at `/<key>.txt`. Unset (the default, and local dev)
   * and nothing is submitted. Needs `PRIMARY_HOST` too: IndexNow rejects a URL
   * list whose host it can't verify.
   */
  INDEXNOW_KEY?: string;
};

/** The website Worker: static assets, the public API, and Clerk sessions. */
export type Env = CoreEnv & {
  ASSETS: Fetcher;
  /**
   * Clerk's secret key — the one that makes accounts exist at all.
   *
   * Required, not optional. Unset used to mean "everybody is signed out", which
   * read as a working deploy and behaved like a broken one. `.dev.vars` locally,
   * `wrangler secret put` in production.
   */
  CLERK_SECRET_KEY: string;
  /**
   * The PEM public key from the Clerk dashboard (API keys → Show JWT public key).
   *
   * Optional, and worth setting in production: with it, verifying a session is
   * pure computation. Without it the SDK fetches the JWKS from Clerk's API on a
   * cache miss, and a Worker's subrequest budget is shared with everything else.
   */
  CLERK_JWT_KEY?: string;
  /**
   * Comma-separated origins allowed to have minted a session, e.g.
   * `https://marquee.rocks,https://www.marquee.rocks`.
   *
   * Guards the subdomain-cookie-leak case only — a token from somebody else's
   * Clerk instance already fails on its signature. Unset means the check is
   * skipped, because an empty allowlist would reject every request instead.
   */
  CLERK_AUTHORIZED_PARTIES?: string;
};

/** The jobs Worker: the cron crawl, IndexNow, and the admin endpoints. */
export type JobsEnv = CoreEnv & {
  /** Bearer token for /api/admin/* (unset = those routes are off). */
  ADMIN_TOKEN?: string;
};

/** Hono generics for typed `c.env` across the website app. */
export type AppEnv = { Bindings: Env };

/** Hono generics for typed `c.env` across the jobs app. */
export type JobsAppEnv = { Bindings: JobsEnv };
