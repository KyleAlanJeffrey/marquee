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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(url(path), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return send<T>('POST', path, body);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return send<T>('PUT', path, body);
}

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
