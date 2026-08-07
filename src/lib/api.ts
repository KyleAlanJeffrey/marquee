/**
 * Client for the Marquee Worker API (mounted at /api on the same Worker that
 * serves the web build).
 *
 * EXPO_PUBLIC_API_URL is the Worker origin. On the web build (served by the
 * Worker) it can be left unset — requests go to the same origin. Native builds
 * must set it to the deployed Worker URL, since relative URLs don't resolve
 * off-web. Local dev sets it to http://localhost:8787.
 */
const ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

function url(path: string): string {
  return `${ORIGIN}/api${path}`;
}

/**
 * How a request gets a session token attached.
 *
 * Registered by `<AuthProvider>` at mount rather than read from a module-level
 * import, because the token lives behind React state that only Clerk's hooks can
 * see, and these two functions are called from outside the tree. Unregistered —
 * which is every build with no Clerk key, and every moment before the provider
 * mounts — means no header, which is exactly what a signed-out request is.
 *
 * Deliberately a getter and not a value: Clerk rotates session tokens on a short
 * expiry, so anything cached here would eventually be sent stale and read as a
 * server fault.
 */
type TokenProvider = () => Promise<string | null>;

let getAuthToken: TokenProvider | null = null;

export function setTokenProvider(provider: TokenProvider | null): void {
  getAuthToken = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!getAuthToken) return {};
  try {
    const token = await getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (err) {
    // A token we couldn't mint means this request goes out signed-out. Better a
    // public read than a thrown error on a screen that mostly doesn't need one.
    console.warn('api: could not attach a session token', err);
    return {};
  }
}

/**
 * `anonymous` sends the request with no Authorization header even when signed in.
 *
 * Two reasons, and an endpoint qualifies under either.
 *
 * **Privacy**, for the endpoints that carry the user's location. None of them
 * read identity, and attaching the token anyway would put "who" and "where" in
 * one request — the exact pairing the privacy declaration promises never leaves
 * the device. What the server never receives, no log or breach can disclose.
 *
 * **Latency**, for the public catalogue. `authHeaders()` awaits Clerk's
 * `getToken`, and on web that doesn't resolve until clerk-js has loaded from a
 * third-party CDN and hydrated the session — so an event page was waiting on
 * somebody else's script to render a show that has nothing to do with who's
 * looking. Signed-out visitors paid it too.
 *
 * The bar for adding it is the same either way: the route must read no
 * identity. Verified per route, not assumed — `/events/:id/reviews` and
 * `/events/:id/rsvps` look identity-free from the path and are not (they carry
 * `likedByMe` and `followedByMe`), so they keep their token.
 */
type RequestOpts = { anonymous?: boolean };

/**
 * A failed request, with the status attached so a screen can tell "doesn't
 * exist" (404) from "couldn't reach it" — the two need different copy, and
 * parsing the message string to find out is how that distinction quietly breaks.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await fetch(url(path), { headers: opts.anonymous ? {} : await authHeaders() });
  if (!res.ok) throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, opts: RequestOpts = {}): Promise<T> {
  return send<T>('POST', path, body, opts);
}

export async function apiPut<T>(path: string, body: unknown, opts: RequestOpts = {}): Promise<T> {
  return send<T>('PUT', path, body, opts);
}

/** No body — a DELETE names its target in the path, same as the routes expect. */
export async function apiDelete<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await fetch(url(path), {
    method: 'DELETE',
    headers: opts.anonymous ? {} : await authHeaders(),
  });
  if (!res.ok) throw new ApiError(`DELETE ${path} → ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

async function send<T>(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  opts: RequestOpts = {},
): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.anonymous ? {} : await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`${method} ${path} → ${res.status}`, res.status);
  return res.json() as Promise<T>;
}
