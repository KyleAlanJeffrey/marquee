import { useState } from 'react';

/**
 * Cap an embedded list — one that shares a page, rather than being the page.
 *
 * A detail page is a summary with sections, and any one section that can run
 * to fifty rows stops being a section: an artist with a forty-date tour turns
 * their page into a scroll of dates with a biography stranded at the top. The
 * rule of thumb this encodes: if a list isn't the full body of the page, it
 * shows `cap` rows and earns the rest behind one tap.
 *
 * Expansion is one-way and per-mount on purpose. Nobody asks to re-hide a
 * list; leaving means the next visit starts summarised again.
 *
 * One hidden row gets no gate: a button row costs the same height as the row
 * it hides, so the floor to actually truncate is two.
 */
export function useCappedList<T>(items: readonly T[], cap: number) {
  const [expanded, setExpanded] = useState(false);
  // Callers pass literals today, but a computed cap that came out fractional
  // or negative would make slice() misbehave quietly — floor it to a sane one.
  const limit = Math.max(1, Math.floor(cap) || 1);
  const capped = !expanded && items.length - limit >= 2;
  return {
    shown: capped ? items.slice(0, limit) : (items as T[]),
    /** How many rows the cap is holding back; 0 when everything is visible. */
    hidden: capped ? items.length - limit : 0,
    expand: () => setExpanded(true),
  };
}
