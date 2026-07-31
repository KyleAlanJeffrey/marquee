import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * A list the user owns, kept on the device. Follows, followed venues and saved
 * shows are all the same object: a set of things identified by some reference,
 * hydrated from AsyncStorage once, persisted on every change, and validated on
 * the way in because a device's stored JSON is only as trustworthy as the device.
 *
 * Two subtleties worth factoring out rather than copying:
 *
 * - Before the disk read lands the list looks empty, so a user can add-then-remove
 *   inside that window, and a naive hydrate would bring the removed entry back.
 *   Removals made pre-hydration are recorded and used to filter what the read
 *   returns.
 * - A *failed* read must not be treated as an empty list. There is no server copy
 *   of any of this, so writing `[]` over a list we merely failed to parse is the
 *   one bug here that destroys user data with no way back. Persistence waits for a
 *   read that actually produced an array, or for the user to say something.
 */
export type Collection<T, Ref> = {
  items: T[];
  /** False until the stored list has been read, so callers can avoid flicker. */
  ready: boolean;
  has: (ref: Ref) => boolean;
  add: (item: T) => void;
  remove: (ref: Ref) => void;
  toggle: (item: T) => void;
  /**
   * Change an entry in place, leaving its position alone.
   *
   * The other three treat an entry as a membership — you follow an artist or you
   * don't. An attendance isn't like that: you log a show, then rate it, then
   * change your mind about the rating, and each of those is an edit rather than a
   * re-add. Doing it as remove-then-add would move the row to the top of the list
   * every time somebody adjusted a star.
   *
   * A ref that matches nothing is a no-op, not an insert: the caller asked to
   * change something, and inventing a half-populated entry from a patch is how
   * you get a log row with a rating and no show attached.
   */
  update: (ref: Ref, patch: Partial<T>) => void;
};

export type CollectionConfig<Ref, T extends Ref> = {
  /** Versioned, because a shape change has to not read the old list. */
  storageKey: string;
  /** Named in the warning when a read or write fails. */
  label: string;
  isValid: (value: unknown) => value is T;
  matches: (item: T, ref: Ref) => boolean;
};

/**
 * Fold a stored list into whatever is already in memory.
 *
 * Pure and exported so the merge — the part with the actual edge cases — can be
 * tested without a renderer or a mocked AsyncStorage.
 */
export function mergeStored<Ref, T extends Ref>(
  current: T[],
  stored: unknown[],
  dropped: Ref[],
  isValid: (value: unknown) => value is T,
  matches: (item: T, ref: Ref) => boolean,
): T[] {
  const merged = [...current];
  for (const entry of stored) {
    if (!isValid(entry)) continue;
    if (dropped.some((ref) => matches(entry, ref))) continue;
    // Also guards against duplicates in the stored list itself.
    if (merged.some((c) => matches(c, entry))) continue;
    merged.push(entry);
  }
  return merged;
}

export function createCollection<Ref, T extends Ref>(config: CollectionConfig<Ref, T>) {
  const { storageKey, label, isValid, matches } = config;
  const Context = createContext<Collection<T, Ref> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<T[]>([]);
    const [ready, setReady] = useState(false);
    // Separate from `ready`: the UI can render as soon as the read *finishes*, but
    // we may only write back once we know what was on disk.
    const [writable, setWritable] = useState(false);
    const hydrated = useRef(false);
    const dropped = useRef<Ref[]>([]);
    const touched = useRef(false);
    // A read that produced a list. Until then every removal goes into `dropped`,
    // because a later read still has to be merged in without undoing it.
    const readOk = useRef(false);
    const rereading = useRef(false);

    /** One read attempt. Resolves to whether it produced a list. */
    const readStored = useCallback(async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        // No key yet is a perfectly good answer: there is nothing to lose.
        const stored = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(stored)) {
          console.warn(`stored ${label} was not a list; leaving it alone`);
          return false;
        }
        setItems((current) => mergeStored(current, stored, dropped.current, isValid, matches));
        readOk.current = true;
        setWritable(true);
        return true;
      } catch (err) {
        console.warn(`failed to load ${label}:`, err);
        return false;
      }
    }, []);

    /**
     * Try the read once more before unlocking writes.
     *
     * The list is empty because we couldn't read it, not because it is empty, so
     * writing now would delete whatever is on disk — and a user who follows and then
     * unfollows one artist would write `[]` over the fifty they had. If this read
     * fails too, the session stays in memory: losing a change is recoverable, and
     * silently emptying someone's follow list is not.
     */
    const reread = useCallback(async () => {
      if (readOk.current || rereading.current) return;
      rereading.current = true;
      try {
        if (!(await readStored())) {
          console.warn(`still can't read ${label}; this session stays in memory only`);
        }
      } finally {
        rereading.current = false;
      }
    }, [readStored]);

    // Hydrate once, merging rather than overwriting whatever happened while the
    // read was in flight.
    useEffect(() => {
      (async () => {
        await readStored();
        hydrated.current = true;
        setReady(true);
        // A change made during the read still wants saving, but only once we know
        // what we would be overwriting.
        if (!readOk.current && touched.current) void reread();
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; both callbacks are stable
    }, []);

    // Persist once we know the disk state.
    useEffect(() => {
      if (!ready || !writable) return;
      AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch((err) =>
        console.warn(`failed to save ${label}:`, err),
      );
    }, [items, ready, writable]);

    const has = useCallback((ref: Ref) => items.some((i) => matches(i, ref)), [items]);

    const markTouched = useCallback(() => {
      touched.current = true;
      if (hydrated.current) void reread();
    }, [reread]);

    const add = useCallback(
      (item: T) => {
        markTouched();
        setItems((prev) => (prev.some((i) => matches(i, item)) ? prev : [item, ...prev]));
      },
      [markTouched],
    );

    const remove = useCallback(
      (ref: Ref) => {
        markTouched();
        if (!readOk.current) dropped.current.push(ref);
        setItems((prev) => prev.filter((i) => !matches(i, ref)));
      },
      [markTouched],
    );

    const toggle = useCallback((item: T) => {
      markTouched();
      setItems((prev) => {
        if (prev.some((i) => matches(i, item))) {
          // Recorded in here because only `prev` says whether this is a removal.
          // A repeat entry (StrictMode replays updaters) is harmless: `dropped`
          // is only ever read with `.some`.
          if (!readOk.current) dropped.current.push(item);
          return prev.filter((i) => !matches(i, item));
        }
        return [item, ...prev];
      });
    }, [markTouched]);

    const update = useCallback(
      (ref: Ref, patch: Partial<T>) => {
        markTouched();
        setItems((prev) => {
          const at = prev.findIndex((i) => matches(i, ref));
          if (at === -1) return prev;
          const next = [...prev];
          next[at] = { ...next[at], ...patch };
          return next;
        });
      },
      [markTouched],
    );

    const value = useMemo(
      () => ({ items, ready, has, add, remove, toggle, update }),
      [items, ready, has, add, remove, toggle, update],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useCollection(): Collection<T, Ref> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`${label} used outside its provider`);
    return ctx;
  }

  return { Provider, useCollection };
}

/** Shared shape check: null or a string, which is what every stored id is. */
export const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string';
