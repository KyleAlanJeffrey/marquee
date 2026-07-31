import { createCollection } from './account-lists';
import { isFollowedVenue, sameFollowedVenue, type FollowedVenue, type VenueRef } from './list-schemas';

/**
 * Venues you follow, on your account.
 *
 * The shape and its validators live in `list-schemas.ts` — a module that imports
 * nothing, so the specs and the Worker can share them without dragging
 * `react-native` into a Node test run — and are re-exported here so every existing
 * import path still resolves.
 */
export { isFollowedVenue, sameFollowedVenue };
export type { FollowedVenue, VenueRef };

const collection = createCollection<VenueRef, FollowedVenue>({
  kind: 'venues',
  label: 'followed venues',
  requiresAccount: 'follow venues',
  isValid: isFollowedVenue,
  matches: sameFollowedVenue,
});


type NewFollowedVenue = Omit<FollowedVenue, 'followedAt'>;

export function useFollowedVenues() {
  const { items, ready, has, add, remove, toggle } = collection.useCollection();
  return {
    venues: items,
    ready,
    isFollowingVenue: has,
    followVenue: (venue: NewFollowedVenue) => add({ ...venue, followedAt: Date.now() }),
    unfollowVenue: remove,
    toggleVenue: (venue: NewFollowedVenue) => toggle({ ...venue, followedAt: Date.now() }),
  };
}
