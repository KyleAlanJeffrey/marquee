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

    // Hydrate once, merging rather than overwriting whatever happened while the
    // read was in flight.
    useEffect(() => {
      (async () => {
        let read = false;
        try {
          const raw = await AsyncStorage.getItem(storageKey);
          // No key yet is a perfectly good answer: there is nothing to lose.
          const stored = raw ? JSON.parse(raw) : [];
          if (Array.isArray(stored)) {
            read = true;
            setItems((current) => mergeStored(current, stored, dropped.current, isValid, matches));
          } else {
            console.warn(`stored ${label} was not a list; leaving it alone`);
          }
        } catch (err) {
          // Unreadable or unparseable. Render empty, but treat the key as somebody
          // else's until the user changes something: a transient read failure must
          // not be how a follow list gets deleted.
          console.warn(`failed to load ${label}:`, err);
        } finally {
          hydrated.current = true;
          setReady(true);
          if (read || touched.current) setWritable(true);
        }
      })();
    }, []);

    // Persist once we know the disk state, or once the user has made a change that
    // deserves to stick even though we don't.
    useEffect(() => {
      if (!ready || !writable) return;
      AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch((err) =>
        console.warn(`failed to save ${label}:`, err),
      );
    }, [items, ready, writable]);

    const has = useCallback((ref: Ref) => items.some((i) => matches(i, ref)), [items]);

    // A deliberate change outranks a read we couldn't make sense of.
    const markTouched = useCallback(() => {
      touched.current = true;
      if (hydrated.current) setWritable(true);
    }, []);

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
        if (!hydrated.current) dropped.current.push(ref);
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
          if (!hydrated.current) dropped.current.push(item);
          return prev.filter((i) => !matches(i, item));
        }
        return [item, ...prev];
      });
    }, [markTouched]);

    const value = useMemo(
      () => ({ items, ready, has, add, remove, toggle }),
      [items, ready, has, add, remove, toggle],
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
