import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DB } from './db';
import type { Env } from './env';
import { artists, events } from './schema';

/**
 * A signed-in listener's own Spotify — the artists they follow and the ones they
 * actually play — turned into "these acts are playing near you".
 *
 * Distinct from the Spotify use in `sources.ts`, which is app-level
 * (`client_credentials`) and can only ask about artists in general. This is
 * user-scoped: it needs a token minted for one person, with their consent.
 *
 * **We never hold that token.** Sign-in is Clerk's hosted portal, so Clerk owns
 * the OAuth dance and the refresh cycle; the Worker asks Clerk for a live access
 * token per request and forgets it. No token column, nothing to leak, nothing to
 * refresh on a cron, and revoking Spotify in Clerk revokes it here with no code.
 *
 * **Development-mode caveat.** The Spotify app is in development mode, which
 * allows 25 users, each added by hand in Spotify's dashboard. Everyone else gets
 * a 403 from Spotify at the *authorize* step, so they never link and never see
 * the entry point — the gate is Spotify's, not ours, and `linked: false` is the
 * honest answer for them. Extended quota (todo.md) opens it with no code change.
 */

/** Spotify pages at 50; both endpoints we use take that as their max. */
const PAGE = 50;

/**
 * How many pages of follows to walk. 10 × 50 = 500 artists, which is past the
 * long tail of real accounts and bounds the subrequests a Worker spends on one
 * request — the budget is shared with everything else on the same invocation.
 */
const MAX_PAGES = 10;

/** How many suggestions come back. More than a screenful, fewer than a chore. */
export const SUGGESTIONS_MAX = 60;

type SpotifyArtist = {
  id: string;
  name: string;
  images?: { url: string }[];
  genres?: string[];
};

/**
 * A live Spotify access token for this account, straight from Clerk.
 *
 * Null means "not linked", which is the common case and not an error: the user
 * hasn't connected Spotify, or their instance has the connection disabled, or
 * (development mode) they were never allowlisted and so could never complete the
 * authorize step.
 */
async function spotifyTokenFor(env: Env, clerkUserId: string): Promise<string | null> {
  if (!env.CLERK_SECRET_KEY) return null;
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/oauth_access_tokens/oauth_spotify`,
      { headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` } },
    );
    // 404 is "no such connection for this user" — the not-linked case.
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string }[] | { token?: string };
    const first = Array.isArray(body) ? body[0] : body;
    return first?.token ?? null;
  } catch {
    return null;
  }
}

async function spotifyGet<T>(token: string, url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Everyone they follow. Cursor-paginated on `after` rather than offset — this is
 * the one Spotify endpoint that doesn't take `offset`, and the cursor is how it
 * says "no more".
 */
type FollowingPage = { artists?: { items?: SpotifyArtist[]; next?: string | null } };

async function followedArtists(token: string): Promise<SpotifyArtist[]> {
  const out: SpotifyArtist[] = [];
  let url: string | null = `https://api.spotify.com/v1/me/following?type=artist&limit=${PAGE}`;
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    // Annotated rather than inferred: `url` is reassigned from this value, and
    // letting both sides infer is a cycle TypeScript resolves to `any`.
    const body: FollowingPage | null = await spotifyGet<FollowingPage>(token, url);
    if (!body?.artists?.items?.length) break;
    out.push(...body.artists.items);
    url = body.artists.next ?? null;
  }
  return out;
}

/**
 * Their top artists. `medium_term` is roughly six months — long enough not to be
 * dominated by one week's obsession, short enough to still be who they're into.
 */
async function topArtists(token: string): Promise<SpotifyArtist[]> {
  const body = await spotifyGet<{ items?: SpotifyArtist[] }>(
    token,
    `https://api.spotify.com/v1/me/top/artists?limit=${PAGE}&time_range=medium_term`,
  );
  return body?.items ?? [];
}

/**
 * A name reduced to what two spellings of the same act have in common.
 *
 * Diacritics folded, punctuation dropped, a leading "the" removed, whitespace
 * collapsed: "Sigur Rós" and "Sigur Ros", "The xx" and "xx". Deliberately not
 * clever beyond that — this is the *fallback* for artists whose Spotify id we
 * don't have yet, and an aggressive normaliser mis-joins distinct acts, which is
 * worse than missing one.
 */
export function artistNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

export type SpotifySuggestion = {
  /** Our artist id, when the act is in the catalogue. Null means Spotify-only. */
  artist_id: string | null;
  spotify_id: string;
  name: string;
  image_url: string | null;
  genres: string[];
  /** Upcoming shows we know about, anywhere. 0 for a Spotify-only match. */
  upcoming: number;
  /** Why it's here — a follow is a stronger claim than a play count. */
  source: 'followed' | 'top';
};

/**
 * Match a listener's Spotify artists to our catalogue, and suggest them.
 *
 * Two-step match, because the ids are sparse where it matters: production has a
 * `spotify_id` on only 920 of the 5,954 artists with upcoming shows (15%),
 * since enrichment runs when somebody opens an artist page rather than across
 * the catalogue. An id-only join would quietly drop 85% of the acts that
 * actually have tickets on sale, which reads as a broken feature rather than a
 * sparse one.
 *
 * So: exact `spotify_id` first, then a normalised-name match — and when the name
 * match lands on a row with no id, **write the id back**. The feature repairs the
 * catalogue as it's used, every later match on that artist is exact, and the
 * notability score (which reads `spotify_id`) gets better for everyone.
 */
export async function spotifySuggestions(
  env: Env,
  db: DB,
  clerkUserId: string,
): Promise<{ linked: boolean; items: SpotifySuggestion[] }> {
  const token = await spotifyTokenFor(env, clerkUserId);
  if (!token) return { linked: false, items: [] };

  const [followed, top] = await Promise.all([followedArtists(token), topArtists(token)]);

  // Follows outrank plays: someone who followed an act said so on purpose. The
  // map dedupes by Spotify id, and because `followed` is inserted first a
  // followed artist keeps that label even if they're also a top artist.
  const wanted = new Map<string, { artist: SpotifyArtist; source: 'followed' | 'top' }>();
  for (const artist of followed) if (artist?.id) wanted.set(artist.id, { artist, source: 'followed' });
  for (const artist of top) if (artist?.id && !wanted.has(artist.id)) wanted.set(artist.id, { artist, source: 'top' });
  if (wanted.size === 0) return { linked: true, items: [] };

  const spotifyIds = [...wanted.keys()];
  // name key -> spotify id, for the fallback match.
  const nameKeys = new Map<string, string>();
  // The lowercased names as Spotify spells them, which is what the SQL below can
  // actually compare against — `artistNameKey` also folds diacritics and drops
  // punctuation, and SQLite has no equivalent, so it cannot appear in the query.
  // The consequence is deliberate and worth knowing: this fallback catches
  // "MOLLY TUTTLE" vs "Molly Tuttle" but not "Sigur Rós" vs "Sigur Ros". Closing
  // that needs a stored normalised-name column to index; see todo.md.
  const lowerNames = new Set<string>();
  for (const { artist } of wanted.values()) {
    const name = artist.name ?? '';
    const key = artistNameKey(name);
    // First spelling wins. Two Spotify artists normalising to one key is a
    // collision we can't resolve from here, and picking arbitrarily beats
    // joining both onto the same catalogue row.
    if (key && !nameKeys.has(key)) nameKeys.set(key, artist.id);
    if (name) lowerNames.add(name.toLowerCase());
  }

  // Upcoming-show counts come along so the list can lead with acts you can
  // actually go and see, which is the entire point of suggesting them.
  const upcoming = sql<number>`(
    select count(*) from ${events}
    where ${events.artistId} = ${artists.id} and ${events.startsAt} > ${sql`datetime('now')`}
  )`;

  const [byId, byName] = await Promise.all([
    db
      .select({ id: artists.id, spotifyId: artists.spotifyId, name: artists.name, upcoming })
      .from(artists)
      .where(inArray(artists.spotifyId, spotifyIds))
      .all(),
    // Only rows still missing an id are worth name-matching: anything with one
    // was either found above or belongs to a different Spotify artist.
    lowerNames.size === 0
      ? Promise.resolve([])
      : db
          .select({ id: artists.id, name: artists.name, upcoming })
          .from(artists)
          .where(and(isNull(artists.spotifyId), inArray(sql`lower(${artists.name})`, [...lowerNames])))
          .all(),
  ]);

  const matched = new Map<string, { artistId: string; upcoming: number }>();
  for (const row of byId) {
    if (row.spotifyId) matched.set(row.spotifyId, { artistId: row.id, upcoming: Number(row.upcoming) });
  }

  // The name match is looser than SQL can express — `lower(name)` narrowed the
  // candidates, `artistNameKey` decides — so the final comparison happens here.
  const backfill: { artistId: string; spotifyId: string }[] = [];
  for (const row of byName) {
    const key = artistNameKey(row.name ?? '');
    const spotifyId = nameKeys.get(key);
    if (!spotifyId || matched.has(spotifyId)) continue;
    matched.set(spotifyId, { artistId: row.id, upcoming: Number(row.upcoming) });
    backfill.push({ artistId: row.id, spotifyId });
  }

  // Write the ids the name match earned. Guarded on `spotify_id is null` so a
  // concurrent enrichment that got there first is never overwritten, and awaited
  // rather than fired off: a Worker that returns first may be torn down before a
  // dangling promise runs.
  if (backfill.length > 0) {
    await Promise.all(
      backfill.map((b) =>
        db
          .update(artists)
          .set({ spotifyId: b.spotifyId })
          .where(and(eq(artists.id, b.artistId), isNull(artists.spotifyId)))
          .run()
          .catch((err) => console.warn('spotify id backfill failed:', err)),
      ),
    ).catch(() => {});
  }

  const items: SpotifySuggestion[] = [...wanted.values()].map(({ artist, source }) => {
    const hit = matched.get(artist.id);
    return {
      artist_id: hit?.artistId ?? null,
      spotify_id: artist.id,
      name: artist.name,
      image_url: artist.images?.[0]?.url ?? null,
      genres: artist.genres?.slice(0, 3) ?? [],
      upcoming: hit?.upcoming ?? 0,
      source,
    };
  });

  // Playing somewhere beats not playing; a follow beats a play count; then
  // alphabetical so the order is stable across refetches rather than shuffling
  // under the reader between two equally-ranked acts.
  items.sort(
    (a, b) =>
      Number(b.upcoming > 0) - Number(a.upcoming > 0) ||
      (a.source === b.source ? 0 : a.source === 'followed' ? -1 : 1) ||
      b.upcoming - a.upcoming ||
      a.name.localeCompare(b.name),
  );

  return { linked: true, items: items.slice(0, SUGGESTIONS_MAX) };
}
