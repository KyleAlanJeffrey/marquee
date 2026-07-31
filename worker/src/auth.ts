/**
 * Who is making this request, if anyone.
 *
 * Identity is Clerk's (see "Accounts" in todo.md for why it was bought rather
 * than built). The Worker's whole job here is to turn an `Authorization: Bearer
 * <session token>` header into a user id it can trust, and to keep a local mirror
 * row so the rest of the schema has something to point a foreign key at.
 *
 * Two properties this file is written around:
 *
 * 1. **Unset keys mean anonymous, not broken.** `CLERK_SECRET_KEY` is absent in
 *    local dev and on any fork, and the app it is bolted onto works perfectly well
 *    with no account at all — browsing, following, saving and the private log are
 *    all on-device. So a missing key resolves every request to "signed out" and
 *    nothing throws. The failure mode of the whole feature is the status quo.
 * 2. **Verification should cost no subrequest, and only does if it's configured
 *    to.** `verifyToken` checks the signature against Clerk's JWKS; given only
 *    `CLERK_SECRET_KEY` it fetches that JWKS from Clerk's API (cached by the SDK
 *    after the first miss), and given `CLERK_JWT_KEY` — the PEM public key from
 *    the dashboard — it never leaves the isolate. A Worker shares one subrequest
 *    budget between ingestion and everything else, so set `CLERK_JWT_KEY` in
 *    production. Both are supported because the PEM is one more thing to
 *    configure, and being unable to sign in is a worse first day than being a
 *    request slower.
 */

import { verifyToken } from '@clerk/backend';
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
 * Returns anonymous for every kind of failure — no key, no token, expired,
 * malformed, signed by someone else. The caller cannot act differently on any of
 * them (they all mean "not signed in"), and telling them apart in a response
 * would say which half of a guess was right.
 *
 * A token minted by a *different* Clerk instance fails here on the signature
 * alone: the JWKS being checked against is ours, fetched with our key. What
 * `authorizedParties` adds on top is the subdomain-cookie-leak case, where a
 * genuine token for a different frontend of ours gets replayed at this one — so
 * it is set when we know our own origins and simply omitted when we don't, since
 * an empty allowlist would reject everything.
 */
export async function callerFrom(env: Env, authorization: string | undefined): Promise<Caller> {
  const secret = env.CLERK_SECRET_KEY;
  const token = bearerToken(authorization);
  if (!secret || !token) return ANONYMOUS;

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
      secretKey: secret,
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

/** Refresh the denormalised profile from what the client says Clerk told it. */
export async function syncProfile(
  db: DB,
  userId: string,
  profile: { handle?: string | null; displayName?: string | null; avatarUrl?: string | null },
): Promise<void> {
  const now = nowIso();
  const blankToNull = (s: string | null | undefined) => {
    const t = s?.trim();
    return t ? t : null;
  };
  await db
    .insert(users)
    .values({
      id: userId,
      handle: blankToNull(profile.handle),
      displayName: blankToNull(profile.displayName),
      avatarUrl: blankToNull(profile.avatarUrl),
      createdAt: now,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        handle: blankToNull(profile.handle),
        displayName: blankToNull(profile.displayName),
        avatarUrl: blankToNull(profile.avatarUrl),
        syncedAt: now,
        deletedAt: null,
      },
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
      })
      .from(users)
      .where(eq(users.id, userId))
      .get()) ?? null
  );
}
