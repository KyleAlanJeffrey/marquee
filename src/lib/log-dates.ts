/**
 * Validation for hand-entered show dates (the log's manual-add path).
 *
 * Pure and import-free so vitest can exercise it without dragging
 * react-native into a Node test run — same rule as `list-schemas.ts`.
 */

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A past calendar date, or the reason it isn't. */
export function dateProblem(raw: string): string | null {
  if (!DATE_SHAPE.test(raw)) return 'Date reads as YYYY-MM-DD, like 2019-07-21.';
  const [y, m, d] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC normalises overflow (Feb 30 becomes Mar 2), so a date that
  // doesn't round-trip never existed.
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    return "That date doesn't exist.";
  }
  // Compare calendar days, not instants: noon UTC "today" is still hours away
  // at breakfast west of Greenwich, and the matinee is already over.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  if (raw > today) return 'The log is for shows that already happened.';
  return null;
}
