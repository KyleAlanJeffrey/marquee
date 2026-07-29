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

const STORAGE_KEY = 'marquee.follows.v1';

/**
 * A followed artist, stored on-device. `artistId` is our catalog UUID when
 * known (followed from a nearby show); `spotifyId` is set when followed from
 * search. At least one is always present and forms the identity used to match
 * events to follows.
 */
export type FollowedArtist = {
  artistId: string | null;
  spotifyId: string | null;
  name: string;
  imageUrl: string | null;
  genres: string[];
  followedAt: number;
};

/** Anything with an artist identity can be tested against the follow set. */
export type ArtistRef = {
  artistId?: string | null;
  spotifyId?: string | null;
};

/**
 * The stored JSON is only as trustworthy as the device — a partial write or a
 * hand-edited `localStorage` entry would otherwise reach the UI as `undefined.name`.
 */
function isFollowedArtist(v: unknown): v is FollowedArtist {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  const id = (k: string) => a[k] === null || typeof a[k] === 'string';
  return (
    typeof a.name === 'string' &&
    id('artistId') &&
    id('spotifyId') &&
    (!!a.artistId || !!a.spotifyId) &&
    id('imageUrl') &&
    Array.isArray(a.genres) &&
    a.genres.every((g) => typeof g === 'string') &&
    typeof a.followedAt === 'number'
  );
}

function sameArtist(a: FollowedArtist, ref: ArtistRef): boolean {
  return (
    (!!a.artistId && a.artistId === ref.artistId) ||
    (!!a.spotifyId && a.spotifyId === ref.spotifyId)
  );
}

type FollowsContextValue = {
  follows: FollowedArtist[];
  ready: boolean;
  isFollowing: (ref: ArtistRef) => boolean;
  follow: (artist: Omit<FollowedArtist, 'followedAt'>) => void;
  unfollow: (ref: ArtistRef) => void;
  toggle: (artist: Omit<FollowedArtist, 'followedAt'>) => void;
};

const FollowsContext = createContext<FollowsContextValue | null>(null);

export function FollowsProvider({ children }: { children: ReactNode }) {
  const [follows, setFollows] = useState<FollowedArtist[]>([]);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  // Artists dropped before the disk read landed. Pre-hydration the list looks
  // empty, so a user can follow-then-unfollow inside that window; without this
  // the stored copy would come back.
  const dropped = useRef<ArtistRef[]>([]);

  // Hydrate once from disk, merging (not overwriting) whatever the user did
  // while the read was in flight.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored)) {
          setFollows((current) => {
            const merged = [...current];
            for (const entry of stored) {
              if (!isFollowedArtist(entry)) continue;
              if (dropped.current.some((ref) => sameArtist(entry, ref))) continue;
              // Guards against duplicates in the stored list itself, too.
              if (merged.some((c) => sameArtist(c, entry))) continue;
              merged.push(entry);
            }
            return merged;
          });
        }
      } catch (err) {
        console.warn('failed to load follows:', err);
      } finally {
        hydrated.current = true;
        setReady(true);
      }
    })();
  }, []);

  // Persist on every change (after hydration, so we don't clobber with []).
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(follows)).catch((err) =>
      console.warn('failed to save follows:', err),
    );
  }, [follows, ready]);

  const isFollowing = useCallback(
    (ref: ArtistRef) => follows.some((f) => sameArtist(f, ref)),
    [follows],
  );

  const follow = useCallback((artist: Omit<FollowedArtist, 'followedAt'>) => {
    setFollows((prev) => {
      if (prev.some((f) => sameArtist(f, artist))) return prev;
      return [{ ...artist, followedAt: Date.now() }, ...prev];
    });
  }, []);

  const unfollow = useCallback((ref: ArtistRef) => {
    if (!hydrated.current) dropped.current.push(ref);
    setFollows((prev) => prev.filter((f) => !sameArtist(f, ref)));
  }, []);

  const toggle = useCallback(
    (artist: Omit<FollowedArtist, 'followedAt'>) => {
      setFollows((prev) => {
        if (prev.some((f) => sameArtist(f, artist))) {
          // Recorded here because only `prev` says whether this is a drop; a
          // repeat entry (StrictMode replays updaters) makes no difference,
          // `dropped` is only ever tested with `.some`.
          if (!hydrated.current) dropped.current.push(artist);
          return prev.filter((f) => !sameArtist(f, artist));
        }
        return [{ ...artist, followedAt: Date.now() }, ...prev];
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ follows, ready, isFollowing, follow, unfollow, toggle }),
    [follows, ready, isFollowing, follow, unfollow, toggle],
  );

  return <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>;
}

export function useFollows(): FollowsContextValue {
  const ctx = useContext(FollowsContext);
  if (!ctx) throw new Error('useFollows must be used within FollowsProvider');
  return ctx;
}
