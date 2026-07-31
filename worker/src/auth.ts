/**
 * Who is making this request, if anyone.
 *
 * Identity is Clerk's (see "Accounts" in todo.md for why it was bought rather
 * than built). The Worker's whole job here is to turn an `Authorization: Bearer
 * <session token>` header into a user id it can trust, and to keep a local mirror
 * row so the rest of the schema has something to point a foreign key at.
 *
 * One property this file is written around:
 *
 * **Verification should cost no subrequest, and only does if it's configured
 *    to.** `verifyToken` checks the signature against Clerk's JWKS; given only
 *    `CLERK_SECRET_KEY` it fetches that JWKS from Clerk's API (cached by the SDK
 *    after the first miss), and given `CLERK_JWT_KEY` — the PEM public key from
 *    the dashboard — it never leaves the isolate. A Worker shares one subrequest
 *    budget between ingestion and everything else, so set `CLERK_JWT_KEY` in
 *    production. Both are supported because the PEM is one more thing to
 *    configure, and being unable to sign in is a worse first day than being a
 *    request slower.
 */

import { createClerkClient, verifyToken } from '@clerk/backend';
import { eq } from 'drizzle-orm';

import type { DB } from './db';
import type { Env } from './env';
import { users } from './schema';

/** Everything downstream needs to know about the caller. */
export type Caller = {
  /** The Clerk user id, or null when the request is anonymous. */
  userId: string | null;
};

export const ANONYMOUS: Caller = { userId: null };

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';

/** The bearer token, if the header is present and shaped like one. */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = m?.[1]?.trim();
  return token ? token : null;
}

/**
 * Verify a session token and return its subject.
 *
 * Returns anonymous for every kind of failure — no token, expired, malformed,
 * signed by someone else. The caller cannot act differently on any of them (they
 * all mean "not signed in"), and telling them apart in a response would say which
 * half of a guess was right.
 *
 * A token minted by a *different* Clerk instance fails here on the signature
 * alone: the JWKS being checked against is ours, fetched with our key. What
 * `authorizedParties` adds on top is the subdomain-cookie-leak case, where a
 * genuine token for a different frontend of ours gets replayed at this one — so
 * it is set when we know our own origins and simply omitted when we don't, since
 * an empty allowlist would reject everything.
 *
 * Do not set `CLERK_AUTHORIZED_PARTIES` on a hunch. `@clerk/backend`'s check is
 * `if (!azp || !authorizedParties.includes(azp)) throw` — a *missing* `azp` throws
 * as hard as a wrong one, and only the web frontend is guaranteed to send one. So
 * a well-meaning allowlist of `marquee.rocks` would lock out the iOS and Android
 * apps and look exactly like every other "not signed in". Set it only once a real
 * native token has been inspected and shown to carry an `azp` we can name.
 *
 * Throws — rather than returning anonymous — when `CLERK_SECRET_KEY` is missing.
 * Making the field required in `Env` was only a compile-time claim; without this the
 * runtime still quietly treated every caller as signed out, which is the exact
 * failure that took two deploys to notice on the client. The blast radius is checked
 * and small: nothing outside `/api/me*` calls this, so a deploy that loses the
 * secret 500s the account endpoints and leaves browsing, search and every page
 * working.
 */
export async function callerFrom(env: Env, authorization: string | undefined): Promise<Caller> {
  if (!env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not set; the Worker cannot verify sessions');
  }

  const token = bearerToken(authorization);
  if (!token) return ANONYMOUS;

  const parties = (env.CLERK_AUTHORIZED_PARTIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    // Rejects rather than resolving to an error object. Worth stating because the
    // package also has an internal `verifyToken` that returns `{ data, errors }`,
    // and reading the wrong one's docs gets you `const { data } = await …` — which
    // type-checks against neither but fails *open* if it ever compiled: an
    // undefined subject read as a valid caller.
    const claims = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      ...(env.CLERK_JWT_KEY ? { jwtKey: env.CLERK_JWT_KEY } : {}),
      ...(parties.length ? { authorizedParties: parties } : {}),
    });
    return { userId: typeof claims.sub === 'string' && claims.sub ? claims.sub : null };
  } catch (err) {
    // Expected constantly in normal operation — an expired token is how a session
    // ends — so this is not an error-level event. It also covers the genuinely
    // wrong cases (bad signature, wrong party, unreachable JWKS), which is
    // acceptable because the answer to all of them is the same: not signed in.
    console.debug('auth: token rejected:', err instanceof Error ? err.message : err);
    return ANONYMOUS;
  }
}

/**
 * Make sure a mirror row exists for this user, and return it.
 *
 * Called on the authenticated write paths rather than on every read: the row's
 * only purpose is to be a foreign-key target, so it is needed the first time
 * somebody logs a show, not the first time they load one.
 *
 * The profile fields are left null here on purpose. Filling them means asking
 * Clerk, and the moment to do that is when the client tells us what it already
 * knows (it holds the signed-in user object) — not inside a write the person is
 * waiting on.
 */
export async function ensureUser(db: DB, userId: string): Promise<void> {
  const now = nowIso();
  await db
    .insert(users)
    .values({ id: userId, createdAt: now, syncedAt: now })
    // Not `doNothing`: an existing row should still record that we saw them, and
    // a returning account that Clerk has since restored should lose its tombstone.
    .onConflictDoUpdate({
      target: users.id,
      set: { syncedAt: now, deletedAt: null },
    });
}

/**
 * Refresh the denormalised profile from Clerk itself, not from the client.
 *
 * This used to accept a display name and avatar in the request body — bounded
 * trust, since the identity still came from the token — but the handle could
 * never join them: it is public, it goes in URLs, and it is the one field where
 * a lie lands on somebody else. Once *one* field has to come from Clerk's
 * Backend API anyway, fetching all three from the same answer costs nothing
 * extra and deletes the trust question entirely.
 *
 * The subrequest is paid once per sign-in (the client calls `POST /me` when a
 * session appears), not per request — reads come from the mirror row.
 *
 * `username` is null for everyone today: the instance has usernames disabled
 * (checked 2026-07-31 via `/v1/environment`). Handle policy is an open decision
 * in docs/social.md; the day usernames are switched on, handles start filling in
 * here with no code change.
 */
export async function syncProfileFromClerk(env: Env, db: DB, userId: string): Promise<void> {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const account = await clerk.users.getUser(userId);

  const blankToNull = (s: string | null | undefined) => {
    const t = s?.trim();
    return t ? t : null;
  };
  const profile = {
    handle: blankToNull(account.username),
    displayName: blankToNull(account.fullName ?? account.username),
    avatarUrl: blankToNull(account.imageUrl),
  };

  const now = nowIso();
  await db
    .insert(users)
    .values({ id: userId, ...profile, createdAt: now, syncedAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { ...profile, syncedAt: now, deletedAt: null },
    });
}

/** The mirror row, or null if this user has never written anything. */
export async function findUser(db: DB, userId: string) {
  return (
    (await db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        deletedAt: users.deletedAt,
        radiusMiles: users.radiusMiles,
        remindersEnabled: users.remindersEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get()) ?? null
  );
}
