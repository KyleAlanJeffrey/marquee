/**
 * The image mirror: artist images served from our own R2 instead of hotlinked.
 *
 * Everything visual leans on URLs we don't control — measured on production
 * 2026-07-31, every stored artist image lives on exactly three hosts
 * (s1.ticketm.net ×891, seatgeekimages.com ×591, i.scdn.co ×48) — and
 * hotlinks rot, get resized upstream, and rate-limit. `GET /img/artist/:id`
 * is cache-aside: first request fetches the upstream image (guardedly),
 * stores it in R2, and serves it; every later request is an R2 read behind
 * the edge cache. Any failure at any step falls back to a redirect to the
 * upstream URL, so the mirror can only ever add durability, never subtract
 * an image.
 *
 * The object key ends in a hash of the upstream URL, which is what makes the
 * long `immutable` cache header honest: a changed upstream URL is a new key
 * and a new /img URL, never a stale edge hit. Old objects linger until a
 * pruning pass exists; they're pennies.
 */
import { eq } from 'drizzle-orm';

import { getDb } from './db';
import type { Env } from './env';
import { artists } from './schema';

/**
 * Where we're willing to send a server-side fetch. The first three are every
 * host production actually stores (see module comment); Wikimedia is where
 * venue photos already come from, ahead of mirroring those too. Anything
 * else — including a redirect that lands off-list — is served by redirect
 * only, never fetched.
 */
const ALLOWED_HOSTS = new Set([
  's1.ticketm.net',
  'seatgeekimages.com',
  'i.scdn.co',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  // Artist photos backfilled from the Bandsintown crawl (2026-08-03).
  'photos.bandsintown.com',
]);

/** Big enough for every 640px-ish source image, small enough that a surprise
    video or tarball can't sit in the bucket wearing an image's key. */
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const allowed = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

const urlHash = async (url: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

/**
 * Read a body up to `max` bytes, cancelling the moment it goes over. The
 * declared content-length is a hint, not a promise — a chunked response has
 * none at all — so the cap has to be enforced while reading, not before.
 * Null means "too big or unreadable"; the caller falls back to the redirect.
 */
const readCapped = async (resp: Response, max: number): Promise<Uint8Array | null> => {
  if (!resp.body) return null;
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
};

const cacheHeaders = (contentType: string) => ({
  'Content-Type': contentType,
  // Immutable is honest here — the key hashes the upstream URL — and it's
  // what lets the edge cache do the real serving after the first read.
  'Cache-Control': 'public, max-age=31536000, immutable',
});

/**
 * Serve one artist's image from the mirror, mirroring it on first demand.
 * Returns null only when the artist doesn't exist or has no image — the
 * route turns that into a 404.
 */
export async function artistImage(env: Env, artistId: string): Promise<Response | null> {
  const row = await getDb(env.DB)
    .select({ imageUrl: artists.imageUrl })
    .from(artists)
    .where(eq(artists.id, artistId))
    .get();
  const upstream = row?.imageUrl ?? null;
  // An unparseable stored URL is "no image", not a fallback target —
  // Response.redirect throws on anything it can't parse.
  if (!upstream || !URL.canParse(upstream)) return null;

  const fallback = () => Response.redirect(upstream, 302);

  // No binding (a dev setup without the bucket) or an origin we don't fetch
  // from: the image still shows, it just isn't ours.
  if (!env.IMAGES || !allowed(upstream)) return fallback();

  const key = `artist/${artistId}/${await urlHash(upstream)}`;
  try {
    const hit = await env.IMAGES.get(key);
    if (hit) {
      return new Response(hit.body as unknown as BodyInit, {
        headers: cacheHeaders(hit.httpMetadata?.contentType ?? 'image/jpeg'),
      });
    }

    const resp = await fetch(upstream, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    // A redirect chain that leaves the allowlist doesn't get its bytes stored
    // under our name — resp.url is where the body actually came from.
    if (!resp.ok || !allowed(resp.url)) return fallback();
    const contentType = resp.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (!contentType.startsWith('image/')) return fallback();
    const declared = Number(resp.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return fallback();
    const bytes = await readCapped(resp, MAX_BYTES);
    if (!bytes || bytes.byteLength === 0) return fallback();

    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    return new Response(bytes, { headers: cacheHeaders(contentType) });
  } catch {
    return fallback();
  }
}
