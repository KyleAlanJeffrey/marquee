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
 * The subtlety worth factoring out rather than copying: before the disk read
 * lands the list looks empty, so a user can add-then-remove inside that window,
 * and a naive hydrate would bring the removed entry back. Removals made
 * pre-hydration are recorded and used to filter what the read returns.
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

export function createCollection<Ref, T extends Ref>(config: CollectionConfig<Ref, T>) {
  const { storageKey, label, isValid, matches } = config;
  const Context = createContext<Collection<T, Ref> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<T[]>([]);
    const [ready, setReady] = useState(false);
    const hydrated = useRef(false);
    const dropped = useRef<Ref[]>([]);

    // Hydrate once, merging rather than overwriting whatever happened while the
    // read was in flight.
    useEffect(() => {
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(storageKey);
          const stored = raw ? JSON.parse(raw) : null;
          if (Array.isArray(stored)) {
            setItems((current) => {
              const merged = [...current];
              for (const entry of stored) {
                if (!isValid(entry)) continue;
                if (dropped.current.some((ref) => matches(entry, ref))) continue;
                // Also guards against duplicates in the stored list itself.
                if (merged.some((c) => matches(c, entry))) continue;
                merged.push(entry);
              }
              return merged;
            });
          }
        } catch (err) {
          console.warn(`failed to load ${label}:`, err);
        } finally {
          hydrated.current = true;
          setReady(true);
        }
      })();
    }, []);

    // Persist after hydration only, so an empty pre-read list can't clobber disk.
    useEffect(() => {
      if (!ready) return;
      AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch((err) =>
        console.warn(`failed to save ${label}:`, err),
      );
    }, [items, ready]);

    const has = useCallback((ref: Ref) => items.some((i) => matches(i, ref)), [items]);

    const add = useCallback((item: T) => {
      setItems((prev) => (prev.some((i) => matches(i, item)) ? prev : [item, ...prev]));
    }, []);

    const remove = useCallback((ref: Ref) => {
      if (!hydrated.current) dropped.current.push(ref);
      setItems((prev) => prev.filter((i) => !matches(i, ref)));
    }, []);

    const toggle = useCallback((item: T) => {
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
    }, []);

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
