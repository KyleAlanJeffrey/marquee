/**
 * Thin client for the Marquee Cloudflare Worker API. The base URL comes from
 * EXPO_PUBLIC_API_URL (the deployed Worker, or the local `wrangler dev` URL).
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

function base(): string {
  if (!API_URL) {
    throw new Error(
      'Missing EXPO_PUBLIC_API_URL. Copy .env.example to .env and point it at your Worker (e.g. http://localhost:8787).',
    );
  }
  return API_URL.replace(/\/+$/, '');
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
