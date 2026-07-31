import type { ReactNode } from 'react';

import { createCollection, isNullableString } from './local-collection';

/**
 * A show you went to, and what you thought of it. On the device, and nowhere else.
 *
 * This is phase 0 of the reviews pivot (see todo.md), and the point of doing it
 * with no accounts and no server is that it answers the only question that
 * matters — whether people log shows at all — before anything irreversible is
 * built. Nothing here is published, so nothing here needs moderation, a privacy
 * policy or an identity.
 *
 * It is also not throwaway. The shape below is the one the `attendances` and
 * `reviews` tables are sketched around, so migrating a device's log into an
 * account on first sign-in is a translation rather than a rewrite — and that
 * migration is the reward for signing up, which is why it's in phase 2 rather
 * than being left as an afterthought.
 *
 * Ratings are split in two on purpose, and both are optional. A brilliant set in
 * a room with bad sound and a 90-minute bar queue is two different verdicts, and
 * people who aren't given somewhere to put the second one put it in the first.
 */
export type Attendance = {
  eventId: string;
  /**
   * A snapshot of the show, for the same reason saved shows carry one: the log
   * has to open instantly, work offline, and keep meaning something after the
   * event row is repaired, re-clustered or aged out of the feeds.
   *
   * Unlike a saved show it is *not* revalidated against the server. A saved show
   * is a plan, so a moved door time matters; an attendance is a memory, and the
   * night it describes already happened.
   */
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
  /** Private, because in phase 0 there is nowhere for it to be anything else. */
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
 * Exists because the tap target is a row of stars and an off-by-one in the index
 * maths should round down to a real rating rather than persisting a 0 or a 6 that
 * every later reader has to defend against.
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
    isNullableString(a.venueTimezone) &&
    typeof a.loggedAt === 'number' &&
    isRating(a.rating) &&
    isRating(a.venueRating) &&
    isNullableString(a.note)
  );
}

export const sameAttendance = (a: Attendance, ref: AttendanceRef) =>
  !!ref.eventId && a.eventId === ref.eventId;

const collection = createCollection<AttendanceRef, Attendance>({
  storageKey: 'marquee.attendances.v1',
  label: 'shows you went to',
  requiresAccount: "log the shows you've been to",
  isValid: isAttendance,
  matches: sameAttendance,
});

export function AttendancesProvider({ children }: { children: ReactNode }) {
  return <collection.Provider>{children}</collection.Provider>;
}

/** What a caller supplies: the show, without the parts we fill in. */
export type NewAttendance = Omit<Attendance, 'loggedAt' | 'rating' | 'venueRating' | 'note'>;

export function useAttendances() {
  const { items, ready, has, add, remove, toggle, update, replaceAll } = collection.useCollection();

  const blank = (show: NewAttendance): Attendance => ({
    ...show,
    loggedAt: Date.now(),
    rating: null,
    venueRating: null,
    note: null,
  });

  return {
    /** Newest night first, not newest *logged* first — this is a history. */
    attended: [...items].sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    /** Insertion order, which is what the storage holds. */
    raw: items,
    /** For the account sync only — see `list-sync.tsx`. */
    replaceAll,
    ready,
    wasThere: has,
    /** Everything logged about one show, or null. */
    attendanceFor: (ref: AttendanceRef) =>
      items.find((a) => sameAttendance(a, ref)) ?? null,
    log: (show: NewAttendance) => add(blank(show)),
    unlog: remove,
    toggleAttended: (show: NewAttendance) => toggle(blank(show)),
    /**
     * Rate a show. Logs it first if it wasn't — rating something you haven't
     * marked as attended is not a state worth having, and making people tap twice
     * to say one thing is how a log stays empty.
     */
    rate: (show: NewAttendance, patch: { rating?: number | null; venueRating?: number | null; note?: string | null }) => {
      const clean = {
        ...(patch.rating !== undefined ? { rating: toRating(patch.rating) } : {}),
        ...(patch.venueRating !== undefined ? { venueRating: toRating(patch.venueRating) } : {}),
        ...(patch.note !== undefined ? { note: patch.note?.trim() ? patch.note.trim() : null } : {}),
      };
      if (!has(show)) add({ ...blank(show), ...clean });
      else update(show, clean);
    },
  };
}
