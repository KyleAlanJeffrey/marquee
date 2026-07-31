/**
 * What the four account lists hold, and how to tell a good entry from a bad one.
 *
 * **This module imports nothing.** That is its whole reason for existing separately
 * from the stores that use it. The store files are React hooks that reach
 * `@/lib/auth` and therefore `@clerk/expo` and therefore `react-native`, none of
 * which parse in a plain Node test run — and both `src/lib/stores.test.ts` and
 * `worker/test/lists.test.ts` need these predicates. The Worker's test needs them
 * especially: it asserts that its own zod schemas agree with these, which is the only
 * thing keeping two validators of one shape from drifting apart.
 *
 * The stores re-export everything here, so importing a type from
 * `follows-store` still works and no call site had to change.
 */

/** Shared shape check: null or a string, which is what every stored id is. */
export const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';

// Number.isFinite, not typeof: NaN and the infinities are numbers to typeof and
// silently poison every comparison made against them later.
const isNullableNumber = (v: unknown): boolean => v === null || Number.isFinite(v);

// --- followed artists --------------------------------------------------------

/**
 * A followed artist. `artistId` is our catalog UUID when known (followed from a
 * nearby show); `spotifyId` is set when followed from search. At least one is always
 * present and forms the identity used to match events to follows.
 */
export type FollowedArtist = {
  artistId: string | null;
  spotifyId: string | null;
  name: string;
  imageUrl: string | null;
  genres: string[];
  followedAt: number;
};

/** Anything with an artist identity can be tested against the follow set. */
export type ArtistRef = {
  artistId?: string | null;
  spotifyId?: string | null;
};

export function isFollowedArtist(v: unknown): v is FollowedArtist {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.name === 'string' &&
    isNullableString(a.artistId) &&
    isNullableString(a.spotifyId) &&
    (!!a.artistId || !!a.spotifyId) &&
    isNullableString(a.imageUrl) &&
    Array.isArray(a.genres) &&
    a.genres.every((g) => typeof g === 'string') &&
    Number.isFinite(a.followedAt)
  );
}

export function sameArtist(a: FollowedArtist, ref: ArtistRef): boolean {
  return (
    (!!a.artistId && a.artistId === ref.artistId) ||
    (!!a.spotifyId && a.spotifyId === ref.spotifyId)
  );
}

// --- followed venues ---------------------------------------------------------

/**
 * A followed venue. Unlike an artist there is only ever one identity — our own
 * canonical venue id — because no upstream venue id survives the cross-source merge.
 * The rest is a snapshot so the list renders before any request lands.
 */
export type FollowedVenue = {
  venueId: string;
  name: string;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  followedAt: number;
};

export type VenueRef = { venueId?: string | null };

export function isFollowedVenue(v: unknown): v is FollowedVenue {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.venueId === 'string' &&
    a.venueId !== '' &&
    typeof a.name === 'string' &&
    isNullableString(a.city) &&
    isNullableString(a.region) &&
    isNullableNumber(a.lat) &&
    isNullableNumber(a.lng) &&
    Number.isFinite(a.followedAt)
  );
}

export const sameFollowedVenue = (v: FollowedVenue, ref: VenueRef) =>
  !!ref.venueId && v.venueId === ref.venueId;

// --- saved shows -------------------------------------------------------------

/**
 * A show the user put aside for later.
 *
 * The snapshot is what makes the Saved tab render immediately, but it is a copy of a
 * row that can move: doors get pushed back, shows get cancelled. So it is a *starting*
 * value only — the screen revalidates the ids against the server and prefers what comes
 * back. Showing a stale door time would be the one failure that actually costs somebody
 * their evening.
 */
export type SavedShow = {
  eventId: string;
  name: string;
  startsAt: string;
  /** Set time not announced when saved — `startsAt` is a noon placeholder.
   *  Optional: snapshots from before the flag existed simply don't have it,
   *  and the revalidated row is the authority either way. */
  timeUnknown?: boolean;
  artistId: string | null;
  artistName: string | null;
  artistImageUrl: string | null;
  venueId: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueTimezone: string | null;
  priceFrom: number | null;
  savedAt: number;
};

export type ShowRef = { eventId?: string | null };

/** The snapshot fields shared by a saved show and an attendance. */
function hasShowSnapshot(a: Record<string, unknown>): boolean {
  return (
    typeof a.eventId === 'string' &&
    a.eventId !== '' &&
    typeof a.name === 'string' &&
    typeof a.startsAt === 'string' &&
    isNullableString(a.artistId) &&
    isNullableString(a.artistName) &&
    isNullableString(a.artistImageUrl) &&
    isNullableString(a.venueId) &&
    isNullableString(a.venueName) &&
    isNullableString(a.venueCity) &&
    isNullableString(a.venueTimezone)
  );
}

export function isSavedShow(v: unknown): v is SavedShow {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    hasShowSnapshot(a) &&
    isNullableNumber(a.priceFrom) &&
    Number.isFinite(a.savedAt) &&
    (a.timeUnknown === undefined || typeof a.timeUnknown === 'boolean')
  );
}

export const sameSavedShow = (s: SavedShow, ref: ShowRef) => !!ref.eventId && s.eventId === ref.eventId;

// --- attendances -------------------------------------------------------------

/**
 * A show you went to, and what you thought of it.
 *
 * Carries a snapshot for the same reason a saved show does, but unlike one it is *not*
 * revalidated against the server: a saved show is a plan, so a moved door time matters;
 * an attendance is a memory, and the night it describes already happened. That is also
 * what lets the log hold a show the catalogue has never heard of.
 *
 * Ratings are split in two on purpose, and both are optional. A brilliant set in a room
 * with bad sound and a 90-minute bar queue is two different verdicts, and people who
 * aren't given somewhere to put the second one put it in the first.
 */
export type Attendance = {
  eventId: string;
  name: string;
  startsAt: string;
  artistId: string | null;
  artistName: string | null;
  artistImageUrl: string | null;
  venueId: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueTimezone: string | null;
  /** When it was logged — not when the show was. */
  loggedAt: number;
  /** The performance, 1–5. Null means "I was there" with no verdict offered. */
  rating: number | null;
  /** The room, 1–5, rated separately from the performance. */
  venueRating: number | null;
  note: string | null;
};

export type AttendanceRef = { eventId?: string | null };

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** A star value we'd store: a whole number in range, or nothing. */
export function isRating(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === 'number' && Number.isInteger(v) && v >= RATING_MIN && v <= RATING_MAX;
}

/**
 * Clamp anything a caller hands us into a storable rating.
 *
 * Exists because the tap target is a row of stars and an off-by-one in the index maths
 * should round down to a real rating rather than persisting a 0 or a 6 that every later
 * reader has to defend against.
 */
export function toRating(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  const n = Math.round(v);
  if (n < RATING_MIN) return null;
  return Math.min(n, RATING_MAX);
}

export function isAttendance(v: unknown): v is Attendance {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    hasShowSnapshot(a) &&
    Number.isFinite(a.loggedAt) &&
    isRating(a.rating) &&
    isRating(a.venueRating) &&
    isNullableString(a.note)
  );
}

export const sameAttendance = (a: Attendance, ref: AttendanceRef) =>
  !!ref.eventId && a.eventId === ref.eventId;
