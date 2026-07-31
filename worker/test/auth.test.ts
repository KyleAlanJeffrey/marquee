import { describe, expect, it, vi } from 'vitest';

import { bearerToken, callerFrom, ANONYMOUS } from '../src/auth';
import type { Env } from '../src/env';

const env = (over: Partial<Env> = {}) => ({ ...over }) as Env;

describe('bearerToken', () => {
  it('reads the token out of a well-formed header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    // Clients are inconsistent about the case and the spacing, and the scheme is
    // case-insensitive per RFC 7235.
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('  Bearer   abc  ')).toBe('abc');
  });

  it('returns null for anything that is not one', () => {
    expect(bearerToken(undefined)).toBe(null);
    expect(bearerToken(null)).toBe(null);
    expect(bearerToken('')).toBe(null);
    // A bare token with no scheme is not a bearer header, and treating it as one
    // would mean accepting `Authorization: <secret>` from anywhere.
    expect(bearerToken('abc.def.ghi')).toBe(null);
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBe(null);
    // The scheme with nothing after it.
    expect(bearerToken('Bearer')).toBe(null);
    expect(bearerToken('Bearer   ')).toBe(null);
  });
});

describe('callerFrom', () => {
  it('refuses to answer at all when the secret key is missing', async () => {
    // The key is required now, and this is what enforces it. Making the field
    // non-optional in `Env` was a compile-time claim only: without this throw the
    // runtime went on treating everybody as signed out, which is indistinguishable
    // from a working deploy where nobody happens to be logged in.
    //
    // Safe to be this blunt because nothing outside `/api/me*` calls `callerFrom`,
    // so a deploy that loses the secret breaks the account endpoints and leaves
    // browsing alone.
    await expect(callerFrom(env(), 'Bearer whatever')).rejects.toThrow(/CLERK_SECRET_KEY/);
    // Including when there is no token to check — otherwise a misconfigured deploy
    // looks healthy right up until somebody signs in.
    await expect(callerFrom(env(), undefined)).rejects.toThrow(/CLERK_SECRET_KEY/);
  });

  it('is anonymous when there is no token', async () => {
    await expect(callerFrom(env({ CLERK_SECRET_KEY: 'sk_test_x' }), undefined)).resolves.toEqual(ANONYMOUS);
    await expect(callerFrom(env({ CLERK_SECRET_KEY: 'sk_test_x' }), 'Bearer ')).resolves.toEqual(ANONYMOUS);
  });

  it('is anonymous when the token does not verify, rather than throwing', async () => {
    // A garbage token is a signed-out request, not a 500. This also pins the
    // failure *direction*: `verifyToken` rejects rather than resolving to an
    // error object, so a mishandled result would fail open instead of closed.
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await expect(
      callerFrom(env({ CLERK_SECRET_KEY: 'sk_test_x' }), 'Bearer not.a.jwt'),
    ).resolves.toEqual(ANONYMOUS);
    debug.mockRestore();
  });

  it('never reports a caller without verifying a signature', async () => {
    // The shape of a real Clerk session token, with a plausible `sub`, unsigned.
    // If this ever returns a user id, verification has been bypassed.
    //
    // Slow (~3s) because a well-formed header sends the SDK looking for the JWKS
    // that matches its `kid`, and the fake secret key gets it nowhere. The result
    // is the same offline — an unreachable JWKS is one more way not to verify —
    // so this is a slow test rather than a flaky one.
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_x' }));
    const payload = btoa(JSON.stringify({ sub: 'user_2abcdef', exp: 4102444800 }));
    const forged = `${header}.${payload}.`;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const caller = await callerFrom(env({ CLERK_SECRET_KEY: 'sk_test_x' }), `Bearer ${forged}`);
    expect(caller.userId).toBe(null);
    debug.mockRestore();
  });
});
