/**
 * The image mirror: artist images served from our own R2 instead of hotlinked.
 *
 * Everything visual leans on URLs we don't control — measured on production
 * 2026-07-31, every stored artist image lives on exactly three hosts
 * (s1.ticketm.net ×891, seatgeekimages.com ×591, i.scdn.co ×48) — and
 * hotlinks rot, get resized upstream, and rate-limit. `GET /img/artist/:id`
 * is cache-aside: first request fetches the upstream image (guardedly),
 * stores it in R2, and serves it; every later request is an R2 read behind
 * the edge cache. Any failure at any step streams the upstream bytes straight
 * through instead, so the mirror can only ever add durability, never subtract
 * an image — and, unlike the redirect it used to fall back to, without
 * publishing the upstream host to the reader on the way.
 *
 * The object key ends in a hash of the upstream URL, which is what makes the
 * long `immutable` cache header honest: a changed upstream URL is a new key
 * and a new /img URL, never a stale edge hit. Old objects linger until a
 * pruning pass exists; they're pennies.
 */
import { eq } from 'drizzle-orm';

import { getDb } from './db';
import type { CoreEnv } from './env';
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

/** More hops than any real CDN uses; a chain longer than this is a game. */
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL following redirects manually, validating every hop against the
 * allowlist before requesting it. Null means the chain left the list, looped
 * too long, or a redirect arrived without a destination.
 */
const fetchWithinAllowlist = async (url: string): Promise<Response | null> => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(current)) return null;
    const resp = await fetch(current, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (resp.status < 300 || resp.status >= 400) return resp;
    const location = resp.headers.get('location');
    if (!location) return null;
    current = new URL(location, current).toString();
  }
  return null;
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
export async function artistImage(env: CoreEnv, artistId: string): Promise<Response | null> {
  const row = await getDb(env.DB)
    .select({ imageUrl: artists.imageUrl })
    .from(artists)
    .where(eq(artists.id, artistId))
    .get();
  const upstream = row?.imageUrl ?? null;
  // An unparseable stored URL is "no image", not a fallback target —
  // Response.redirect throws on anything it can't parse.
  if (!upstream || !URL.canParse(upstream)) return null;

  /**
   * What to serve when the mirror can't. **Never a redirect.**
   *
   * It used to be `Response.redirect(upstream, 302)`, which showed the photo
   * but put the upstream URL in the reader's network tab — so the one thing
   * this route exists to keep to itself was published by its own fallback,
   * precisely on the requests that failed. Now the bytes are streamed through
   * instead: same picture, and the only host the reader ever sees is ours.
   *
   * An origin we don't fetch from gets nothing rather than a pass-through —
   * this must not become an open proxy for arbitrary hosts — and null becomes
   * a 404 the client answers with its own fallback art.
   */
  const passThrough = async (): Promise<Response | null> => {
    if (!allowed(upstream)) return null;
    try {
      const resp = await fetchWithinAllowlist(upstream);
      if (!resp || !resp.ok || !resp.body) return null;
      const contentType = resp.headers.get('content-type')?.split(';')[0].trim() ?? '';
      if (!contentType.startsWith('image/')) return null;
      // Streamed, not buffered: this path already failed once and shouldn't
      // also hold a 5MB body in memory to prove it.
      return new Response(resp.body, { headers: cacheHeaders(contentType) });
    } catch {
      return null;
    }
  };
  const fallback = passThrough;

  // No binding (a dev setup without the bucket): the image still shows, it
  // just isn't stored.
  if (!env.IMAGES) return await fallback();
  if (!allowed(upstream)) return null;

  const key = `artist/${artistId}/${await urlHash(upstream)}`;
  try {
    const hit = await env.IMAGES.get(key);
    if (hit) {
      return new Response(hit.body as unknown as BodyInit, {
        headers: cacheHeaders(hit.httpMetadata?.contentType ?? 'image/jpeg'),
      });
    }

    // Redirects are walked by hand so every hop is checked *before* it is
    // requested — with `redirect: 'follow'` an off-list target would already
    // have been fetched by the time the final URL failed validation.
    const resp = await fetchWithinAllowlist(upstream);
    if (!resp || !resp.ok) return await fallback();
    const contentType = resp.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (!contentType.startsWith('image/')) return await fallback();
    const declared = Number(resp.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return await fallback();
    const bytes = await readCapped(resp, MAX_BYTES);
    if (!bytes || bytes.byteLength === 0) return await fallback();

    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    return new Response(bytes, { headers: cacheHeaders(contentType) });
  } catch {
    return await fallback();
  }
}
