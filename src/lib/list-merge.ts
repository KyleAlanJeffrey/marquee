/**
 * Folding a device's list together with the account's copy of it.
 *
 * Pure and on its own so the rule can be tested without a renderer, a session or a
 * server — the same reason `mergeStored` lives apart from the provider that calls it.
 */

/**
 * Union two copies of a list, keeping the newer of any entry that is in both.
 *
 * **Union, not replace, and that is the whole design of first sign-in.** Somebody
 * who used the app for a month and then made an account has a list on the device
 * and possibly another on the account from an older phone. Either side winning
 * outright would silently throw away real history, and there is no way to ask which
 * they meant. Adding up is the only answer that never loses something they had.
 *
 * The cost, stated plainly: **a union cannot express a deletion.** An entry removed
 * on one device but still on the account comes back. That is why this runs *once*
 * per account per device — see `list-sync.tsx` — and every write after it is a
 * whole-list replace, where a dropped entry stays dropped.
 *
 * Order follows `local` first, because that is the order the user has been looking
 * at, and entries only on the account are appended rather than interleaved: a
 * timestamp sort would reshuffle a list somebody already knows the shape of.
 */
export function mergeLists<T>(
  local: T[],
  remote: T[],
  same: (a: T, b: T) => boolean,
  stampOf: (item: T) => number,
): T[] {
  const merged: T[] = [];

  for (const item of local) {
    // A duplicate within one side is dropped rather than carried through. Both
    // sides are supposed to be duplicate-free; if one isn't, merging is where it
    // gets noticed, and keeping both copies would make the next merge worse.
    if (merged.some((m) => same(m, item))) continue;
    const twin = remote.find((r) => same(r, item));
    merged.push(twin && stampOf(twin) > stampOf(item) ? twin : item);
  }

  for (const item of remote) {
    if (merged.some((m) => same(m, item))) continue;
    merged.push(item);
  }

  return merged;
}
