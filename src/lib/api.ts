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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
