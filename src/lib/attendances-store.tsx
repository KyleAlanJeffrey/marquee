import { createCollection } from './account-lists';
import { isAttendance, isRating, sameAttendance, toRating, RATING_MAX, RATING_MIN, type Attendance, type AttendanceRef } from './list-schemas';

/**
 * Shows you have been to, on your account.
 *
 * The shape and its validators live in `list-schemas.ts` — a module that imports
 * nothing, so the specs and the Worker can share them without dragging
 * `react-native` into a Node test run — and are re-exported here so every existing
 * import path still resolves.
 */
export { isAttendance, isRating, sameAttendance, toRating, RATING_MAX, RATING_MIN };
export type { Attendance, AttendanceRef };

const collection = createCollection<AttendanceRef, Attendance>({
  kind: 'attendances',
  label: 'shows you went to',
  requiresAccount: "log the shows you've been to",
  isValid: isAttendance,
  matches: sameAttendance,
});


/** What a caller supplies: the show, without the parts we fill in. */
export type NewAttendance = Omit<Attendance, 'loggedAt' | 'rating' | 'venueRating' | 'note'>;

export function useAttendances() {
  const { items, ready, has, add, remove, toggle, update } = collection.useCollection();

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
