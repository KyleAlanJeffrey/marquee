import { createCollection } from './account-lists';
import { isFollowedArtist, sameArtist, type ArtistRef, type FollowedArtist } from './list-schemas';

/**
 * Artists you follow, on your account.
 *
 * The shape and its validators live in `list-schemas.ts` — a module that imports
 * nothing, so the specs and the Worker can share them without dragging
 * `react-native` into a Node test run — and are re-exported here so every existing
 * import path still resolves.
 */
export { isFollowedArtist, sameArtist };
export type { ArtistRef, FollowedArtist };

const collection = createCollection<ArtistRef, FollowedArtist>({
  kind: 'follows',
  label: 'follows',
  requiresAccount: 'follow artists',
  isValid: isFollowedArtist,
  matches: sameArtist,
});


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
