/**
 * Scheduling for the artist crawl.
 *
 * Bandsintown's open API is artist-keyed with no geographic search, so coverage
 * is bounded by how many artists we ask about and how often. A Cron Trigger
 * drains `artist_sources` (see `crawlDue` in sources.ts); everything in here is
 * the arithmetic that decides who is due next, kept pure so it's testable
 * without a database.
 *
 * The budget that matters is D1 writes on the free tier (100k/day), so intervals
 * are deliberately long for the tail and short only where someone is looking.
 */

export type CrawlTier = 'hot' | 'warm' | 'cold' | 'frontier';

/** How long to wait before re-checking an artist, per tier. */
export const TIER_HOURS: Record<CrawlTier, number> = {
  /** A client asked about them recently — someone is watching this page. */
  hot: 6,
  /** On tour: has an upcoming show, so their listing changes. */
  warm: 24,
  /** Known, but nothing coming up. */
  cold: 24 * 7,
  /** Found in a lineup and never confirmed upstream; cheapest tier. */
  frontier: 24 * 14,
};

/** A client request counts as interest for this long. */
export const REQUEST_INTEREST_HOURS = 24 * 7;

export type CrawlSignals = {
  /** `artists.last_requested_at`, if a client has ever asked. */
  lastRequestedAt?: string | null;
  /** Does the artist have any upcoming show already stored? */
  hasUpcoming?: boolean;
  /** Queue state; `discovered` artists are the unconfirmed frontier. */
  state?: string;
};

export function tierFor(signals: CrawlSignals, now = Date.now()): CrawlTier {
  if (signals.state === 'discovered') return 'frontier';
  const requested = signals.lastRequestedAt ? Date.parse(signals.lastRequestedAt) : NaN;
  if (!Number.isNaN(requested) && now - requested <= REQUEST_INTEREST_HOURS * 3_600_000) return 'hot';
  return signals.hasUpcoming ? 'warm' : 'cold';
}

/** Retry delay after a failure: 1h, 2h, 4h … capped at a week. */
export function backoffHours(failCount: number): number {
  const n = Math.max(1, Math.floor(failCount));
  return Math.min(24 * 7, 2 ** (n - 1));
}

/**
 * A 404 from Bandsintown is indistinguishable from an empty response, and the
 * name we hold may simply not be theirs, so "not found" is a long sleep rather
 * than a permanent verdict — a band that plays its first show should eventually
 * appear. This is the negative cache from the plan.
 */
export const NOT_FOUND_HOURS = 24 * 30;

/** When to look at this artist again, as an ISO timestamp. */
export function nextCheckAt(hours: number, now = Date.now()): string {
  // Spread the batch over its interval so a crawl started at one minute doesn't
  // recur as a single spike forever. Deterministic in `hours` — no randomness,
  // which keeps this testable.
  const jitter = ((hours * 0.1) % 1) * 3_600_000;
  return new Date(now + hours * 3_600_000 + jitter).toISOString().slice(0, 19) + 'Z';
}

/**
 * Lookup keys to try for an artist, best first: whatever worked last time, then
 * the display names, then the same names without a leading "The" (Bandsintown
 * matches on their own spelling and returns nothing rather than a near miss).
 */
export function lookupKeys(artist: {
  name: string;
  bandsintownId?: string | null;
  bandsintownName?: string | null;
  sourceKey?: string | null;
}): string[] {
  const keys: string[] = [];
  const add = (k: string | null | undefined) => {
    const v = k?.trim();
    if (v && !keys.includes(v)) keys.push(v);
  };
  add(artist.bandsintownId ? `id_${artist.bandsintownId}` : null);
  add(artist.sourceKey);
  add(artist.bandsintownName);
  add(artist.name);
  for (const k of [...keys]) add(k.replace(/^the\s+/i, ''));
  return keys;
}

/** Names in a lineup that aren't the artist we crawled — the frontier. */
export function frontierNames(lineup: unknown, headliner: string): string[] {
  if (!Array.isArray(lineup)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lineup) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    // Long strings in this field are billing blurbs ("An Evening With…"), not acts.
    if (name.length < 2 || name.length > 80) continue;
    const key = name.toLowerCase();
    if (key === headliner.trim().toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
