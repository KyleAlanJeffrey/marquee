import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useWriteGate } from '@/lib/write-gate';

/**
 * A list the user owns, kept on the account.
 *
 * Follows, followed venues, saved shows and the attendance log are all the same
 * object: a set of things identified by some reference, belonging to whoever is signed
 * in. This is the one place that is implemented.
 *
 * ## There is no local copy, and that is the point (decided 2026-07-31)
 *
 * These lists used to live in `AsyncStorage` with a server copy synced behind them.
 * That bought offline reads and instant cold starts, and it cost a merge policy, a
 * pull-once-per-device rule, a "what if a different account signs in on this phone"
 * branch, and a class of bug where a device and an account disagreed about what you
 * had. All of that is gone. The server is the only copy.
 *
 * What that trades away, stated plainly rather than discovered on a plane: **the lists
 * need a network and an account.** Signed out, they are empty — not hidden, empty —
 * and browsing, search and every detail page still work exactly as before, because
 * those were never account-bound. What you *keep* now requires somewhere to keep it.
 *
 * No migration path, by decision: a device's old `AsyncStorage` entries are simply
 * left where they are and ignored. Reading them once to upload would mean keeping the
 * merge code this change exists to delete.
 *
 * ## One request, four lists
 *
 * `GET /api/me/lists` returns all four, so every collection reads the same query and a
 * cold start costs one round trip rather than four. Writes `PUT` only their own key —
 * the route writes only the keys it is given — so two lists changing at once cannot
 * clobber each other.
 */

/** The four list names, which are also the server's `kind` values. */
export type ListKind = 'follows' | 'venues' | 'saved' | 'attendances';

const LISTS_KEY = ['me-lists'] as const;

type ListsResponse = { lists: Partial<Record<ListKind, unknown[]>> };

export type Collection<T, Ref> = {
  items: T[];
  /**
   * False only while the account's lists are actually in flight.
   *
   * True when signed out — with no account there is nothing to wait for, and a screen
   * that waited would spin forever instead of showing its empty state.
   */
  ready: boolean;
  has: (ref: Ref) => boolean;
  add: (item: T) => void;
  remove: (ref: Ref) => void;
  toggle: (item: T) => void;
  /**
   * Change an entry in place, leaving its position alone.
   *
   * The other three treat an entry as a membership — you follow an artist or you
   * don't. An attendance isn't like that: you log a show, then rate it, then change
   * your mind about the rating, and each of those is an edit rather than a re-add.
   * Doing it as remove-then-add would move the row to the top every time somebody
   * adjusted a star.
   *
   * A ref that matches nothing is a no-op, not an insert: the caller asked to change
   * something, and inventing a half-populated entry from a patch is how you get a log
   * row with a rating and no show attached.
   */
  update: (ref: Ref, patch: Partial<T>) => void;
};

export type CollectionConfig<Ref, T extends Ref> = {
  /** Which server list this is. */
  kind: ListKind;
  /** Named in the warning when a write fails. */
  label: string;
  /**
   * The action phrase the sign-in screen shows — `'save shows'` → "Sign in to save
   * shows". Every list needs one now: there is nowhere to put an entry without an
   * account, so every *add* is gated.
   *
   * Removals are still never gated. Somebody signed in can always stop keeping
   * something, and a signed-out user has nothing to remove.
   */
  requiresAccount: string;
  isValid: (value: unknown) => value is T;
  matches: (item: T, ref: Ref) => boolean;
};

/**
 * The shared query behind all four lists.
 *
 * Signed out it never runs, so an anonymous visitor makes no authenticated request at
 * all — checked in the browser rather than assumed.
 */
function useLists() {
  const { signedIn, loading } = useAuth();
  return useQuery({
    queryKey: LISTS_KEY,
    enabled: signedIn && !loading,
    // The account is the only writer and this client is the only mutator of it, so a
    // short window of trusting the cache is safe and saves a request per screen.
    staleTime: 30 * 1000,
    queryFn: (): Promise<ListsResponse> => apiGet('/me/lists'),
  });
}

export function createCollection<Ref, T extends Ref>(config: CollectionConfig<Ref, T>) {
  const { kind, label, requiresAccount, isValid, matches } = config;

  function useCollection(): Collection<T, Ref> {
    const { signedIn } = useAuth();
    const gate = useWriteGate();
    const query = useLists();
    const queryClient = useQueryClient();

    /**
     * Entries of the shape we expect, and nothing else.
     *
     * The Worker validates on the way in, so this should never drop anything. It runs
     * anyway because the alternative to a dropped entry is `undefined.name` on a
     * screen, and the two validators are allowed to drift a release apart during a
     * rollout.
     */
    const items = useMemo(() => {
      const raw = query.data?.lists?.[kind];
      return Array.isArray(raw) ? raw.filter(isValid) : [];
    }, [query.data]);

    const save = useMutation({
      mutationFn: (next: T[]) => apiPut(`/me/lists`, { [kind]: next }),
      // Optimistic, because a follow button that waits for a round trip feels broken.
      onMutate: async (next: T[]) => {
        await queryClient.cancelQueries({ queryKey: LISTS_KEY });
        const previous = queryClient.getQueryData<ListsResponse>(LISTS_KEY);
        queryClient.setQueryData<ListsResponse>(LISTS_KEY, (old) => ({
          lists: { ...old?.lists, [kind]: next },
        }));
        return { previous };
      },
      // Rolled back rather than left showing a change that never landed. A silent
      // optimistic failure is worse than a visible one: the user believes it saved.
      onError: (err, _next, context) => {
        console.warn(`failed to save ${label}:`, err);
        if (context?.previous) queryClient.setQueryData(LISTS_KEY, context.previous);
      },
    });

    const has = useCallback((ref: Ref) => items.some((i) => matches(i, ref)), [items]);

    /**
     * True when this write must not proceed, asking for sign-in on the way.
     *
     * Signed out there is nowhere to put the entry, so this is not a policy choice any
     * more — it is where the data would have to go.
     */
    const blocked = useCallback(() => {
      if (gate.allowed) return false;
      // Pending means Clerk hasn't answered yet. Holding the write would need somewhere
      // to hold it; refusing it early would bounce somebody already signed in. So it
      // waits for the gate to settle by simply doing nothing, and the button can be
      // pressed again — the window is one Clerk round trip on a cold start.
      if (!gate.pending) gate.deny(requiresAccount);
      return true;
    }, [gate]);

    const add = useCallback(
      (item: T) => {
        if (blocked()) return;
        if (items.some((i) => matches(i, item))) return;
        save.mutate([item, ...items]);
      },
      [blocked, items, save],
    );

    const remove = useCallback(
      (ref: Ref) => {
        if (!signedIn) return;
        const next = items.filter((i) => !matches(i, ref));
        if (next.length === items.length) return;
        save.mutate(next);
      },
      [signedIn, items, save],
    );

    const toggle = useCallback(
      (item: T) => {
        const present = items.some((i) => matches(i, item));
        if (!present) return add(item);
        return remove(item);
      },
      [items, add, remove],
    );

    const update = useCallback(
      (ref: Ref, patch: Partial<T>) => {
        if (blocked()) return;
        const at = items.findIndex((i) => matches(i, ref));
        if (at === -1) return;
        const next = [...items];
        next[at] = { ...next[at], ...patch };
        save.mutate(next);
      },
      [blocked, items, save],
    );

    return {
      items,
      // Signed out settles immediately: there is no account to load a list from.
      ready: !signedIn || query.isSuccess || query.isError,
      has,
      add,
      remove,
      toggle,
      update,
    };
  }

  return { useCollection };
}

/** Shared shape check: null or a string, which is what every stored id is. */
export const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';
