import type { ReactNode } from 'react';

import { createCollection, isNullableString } from './local-collection';

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
export function isFollowedArtist(v: unknown): v is FollowedArtist {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.name === 'string' &&
    isNullableString(a.artistId) &&
    isNullableString(a.spotifyId) &&
    (!!a.artistId || !!a.spotifyId) &&
    isNullableString(a.imageUrl) &&
    Array.isArray(a.genres) &&
    a.genres.every((g) => typeof g === 'string') &&
    typeof a.followedAt === 'number'
  );
}

export function sameArtist(a: FollowedArtist, ref: ArtistRef): boolean {
  return (
    (!!a.artistId && a.artistId === ref.artistId) ||
    (!!a.spotifyId && a.spotifyId === ref.spotifyId)
  );
}

const collection = createCollection<ArtistRef, FollowedArtist>({
  storageKey: 'marquee.follows.v1',
  label: 'follows',
  isValid: isFollowedArtist,
  matches: sameArtist,
});

export function FollowsProvider({ children }: { children: ReactNode }) {
  return <collection.Provider>{children}</collection.Provider>;
}

type NewFollow = Omit<FollowedArtist, 'followedAt'>;

/**
 * Kept as `follows` / `isFollowing` / `follow` / `unfollow` rather than the
 * generic names underneath: artist follows are the oldest thing in the app and
 * every screen reads them.
 */
export function useFollows() {
  const { items, ready, has, add, remove, toggle } = collection.useCollection();
  return {
    follows: items,
    ready,
    isFollowing: has,
    follow: (artist: NewFollow) => add({ ...artist, followedAt: Date.now() }),
    unfollow: remove,
    // Stamped before the comparison, which ignores the timestamp — so an
    // unfollow computes a `Date.now()` it never stores.
    toggle: (artist: NewFollow) => toggle({ ...artist, followedAt: Date.now() }),
  };
}
