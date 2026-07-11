import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  // Hydrate once from disk.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setFollows(JSON.parse(raw));
      } catch (err) {
        console.warn('failed to load follows:', err);
      } finally {
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
    setFollows((prev) => prev.filter((f) => !sameArtist(f, ref)));
  }, []);

  const toggle = useCallback(
    (artist: Omit<FollowedArtist, 'followedAt'>) => {
      setFollows((prev) => {
        if (prev.some((f) => sameArtist(f, artist))) {
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
