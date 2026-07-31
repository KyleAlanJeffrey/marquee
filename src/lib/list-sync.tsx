import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef } from 'react';

import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isAttendance, sameAttendance, useAttendances, type Attendance } from '@/lib/attendances-store';
import {
  isFollowedVenue,
  sameFollowedVenue,
  useFollowedVenues,
  type FollowedVenue,
} from '@/lib/followed-venues-store';
import { isFollowedArtist, sameArtist, useFollows, type FollowedArtist } from '@/lib/follows-store';
import { mergeLists } from '@/lib/list-merge';
import { isSavedShow, sameSavedShow, useSavedShows, type SavedShow } from '@/lib/saved-shows-store';

/**
 * Keeping the four on-device lists and the account's copy of them in step.
 *
 * The device stays the thing the app reads from — that is what makes it open
 * instantly and work on a plane — and this pushes a copy to the Worker so a lost
 * phone is not a lost history. Renders nothing; it is mounted once, inside the
 * stores, purely for the effects.
 *
 * ## The policy, which is deliberately not a sync engine
 *
 * **Pull once per device, push on every change.** On the first sign-in this device
 * has ever done, the account's copy is folded into the local one and the union is
 * kept — see `mergeLists` for why adding up is the only answer that can't lose
 * something real. After that the device is authoritative: it pushes whole lists,
 * so a removal stays removed, and it does not pull again.
 *
 * What that costs, said plainly rather than discovered later: **two devices used in
 * the same period will not see each other's changes** until the second one's first
 * sign-in. Fixing it properly needs per-entry tombstones and versions, which is a
 * real piece of work and is written down in todo.md. Pull-once is the honest
 * version of the small thing, not a broken version of the big thing.
 *
 * ## Signing in as somebody else
 *
 * A device that has synced before and then sees a *different* account adopts that
 * account's lists wholesale instead of merging. Merging would push the previous
 * person's follows and gig history into the new person's account, which on a shared
 * phone is somebody else's private data ending up under your name. The union case
 * is only ever for a device that has never had an account at all, which is exactly
 * the "I used this for a month and then signed up" migration it exists for.
 */

/**
 * Which account this device last synced with. Its *absence* is the signal that
 * matters — that means lists built before any account existed, which are the ones
 * to merge upward.
 */
const SYNC_MARK_KEY = 'marquee.list-sync.v1';

/** Long enough that toggling a few follows in a row is one request, not five. */
const PUSH_DEBOUNCE_MS = 1500;

type Lists = {
  follows: FollowedArtist[];
  venues: FollowedVenue[];
  saved: SavedShow[];
  attendances: Attendance[];
};

/** The server's answer, before we've decided we believe any of it. */
type ListsResponse = { lists: Partial<Record<keyof Lists, unknown[]>> };

/**
 * Keep the entries that are the shape we expect and drop the rest.
 *
 * The Worker validates on the way in, so this should never remove anything. It runs
 * anyway because the alternative to a dropped entry is `undefined.name` on a screen,
 * and because the two validators are allowed to drift a version apart during a
 * rollout.
 */
function only<T>(value: unknown[] | undefined, isValid: (v: unknown) => v is T): T[] {
  return Array.isArray(value) ? value.filter(isValid) : [];
}

export function ListSync() {
  const { signedIn, loading, userId } = useAuth();
  const follows = useFollows();
  const venues = useFollowedVenues();
  const saved = useSavedShows();
  const attendances = useAttendances();

  /**
   * Progress is tracked in refs, not state, because none of it is rendered — this
   * component returns null. State would also mean calling `setPhase` from inside an
   * effect, which `react-hooks/set-state-in-effect` rightly rejects: it schedules a
   * second render to record something no one is looking at.
   */
  /** The account this mount has finished reconciling, so it happens once. */
  const syncedFor = useRef<string | null>(null);
  /** Guards against a second run while the first is still in flight. */
  const running = useRef(false);
  /** The body of the last successful push, so an unchanged list isn't re-sent. */
  const lastPushed = useRef<string | null>(null);

  // Every list has to have finished reading the disk. Pushing before that would
  // send an empty list — the disk read hasn't landed, so there is nothing in memory
  // yet — and a whole-list PUT of `[]` is how you delete somebody's account copy.
  const localReady = follows.ready && venues.ready && saved.ready && attendances.ready;

  const local = useCallback(
    (): Lists => ({
      follows: follows.follows,
      venues: venues.venues,
      saved: saved.saved,
      attendances: attendances.raw,
    }),
    [follows.follows, venues.venues, saved.saved, attendances.raw],
  );

  const push = useCallback(async (lists: Lists) => {
    const body = JSON.stringify(lists);
    if (body === lastPushed.current) return;
    await apiPut('/me/lists', lists);
    lastPushed.current = body;
  }, []);

  // One-time reconciliation, then hand over to the push effect below.
  useEffect(() => {
    if (loading || !signedIn || !userId || !localReady) return;
    if (running.current || syncedFor.current === userId) return;
    running.current = true;

    (async () => {
      try {
        const mark = await AsyncStorage.getItem(SYNC_MARK_KEY);
        const { lists } = await apiGet<ListsResponse>('/me/lists');
        const remote: Lists = {
          follows: only(lists.follows, isFollowedArtist),
          venues: only(lists.venues, isFollowedVenue),
          saved: only(lists.saved, isSavedShow),
          attendances: only(lists.attendances, isAttendance),
        };

        // Computed into a local rather than read back from the stores: `replaceAll`
        // schedules a render, so the state this function can see is still the old
        // one, and pushing that would undo the merge it just did.
        const mine = local();
        let next = mine;
        if (mark === null) {
          next = {
            follows: mergeLists(mine.follows, remote.follows, sameArtist, (a) => a.followedAt),
            venues: mergeLists(mine.venues, remote.venues, sameFollowedVenue, (v) => v.followedAt),
            saved: mergeLists(mine.saved, remote.saved, sameSavedShow, (s) => s.savedAt),
            attendances: mergeLists(mine.attendances, remote.attendances, sameAttendance, (a) => a.loggedAt),
          };
        } else if (mark !== userId) {
          // Somebody else's phone, or somebody else's turn on this one.
          next = remote;
        }

        // Skipped when the device already owned the answer, so an ordinary cold
        // start doesn't rewrite four lists to the values they already held.
        if (next !== mine) {
          follows.replaceAll(next.follows);
          venues.replaceAll(next.venues);
          saved.replaceAll(next.saved);
          attendances.replaceAll(next.attendances);
        }

        await push(next);
        await AsyncStorage.setItem(SYNC_MARK_KEY, userId);
        syncedFor.current = userId;
      } catch (err) {
        // Not fatal and not retried on a timer. The lists still work; they are on
        // the device, which is where they were before any of this existed. The next
        // cold start tries again, and that is soon enough for a copy.
        console.warn('list sync: could not reconcile with the account', err);
      } finally {
        running.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per sign-in; the store setters are stable and the lists are read inside
  }, [loading, signedIn, userId, localReady]);

  // Signing out stops the pushing and re-arms the reconciliation, so signing back in
  // — as anyone — goes through the decision above again. An effect and not the render
  // body: this mutates, and a render that mutates is the same impurity as one that
  // reads the clock. Only refs are touched, so nothing re-renders.
  useEffect(() => {
    if (signedIn) return;
    syncedFor.current = null;
    lastPushed.current = null;
  }, [signedIn]);

  // Debounced so that toggling three follows in a row is one request.
  useEffect(() => {
    if (!signedIn || syncedFor.current !== userId) return;
    const lists = local();
    const timer = setTimeout(() => {
      push(lists).catch((err) => console.warn('list sync: could not push', err));
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, userId, local, push]);

  return null;
}
