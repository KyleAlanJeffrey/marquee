import type { ReactNode } from 'react';

import { createCollection, isNullableString } from './local-collection';

/**
 * A followed venue, stored on-device. Unlike an artist there is only ever one
 * identity — our own canonical venue id — because no upstream venue id survives
 * the cross-source merge. The rest is a snapshot so the list renders before any
 * request lands.
 */
export type FollowedVenue = {
  venueId: string;
  name: string;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  followedAt: number;
};

export type VenueRef = { venueId?: string | null };

export function isFollowedVenue(v: unknown): v is FollowedVenue {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  const num = (k: string) => a[k] === null || typeof a[k] === 'number';
  return (
    typeof a.venueId === 'string' &&
    a.venueId !== '' &&
    typeof a.name === 'string' &&
    isNullableString(a.city) &&
    isNullableString(a.region) &&
    num('lat') &&
    num('lng') &&
    typeof a.followedAt === 'number'
  );
}

export const sameFollowedVenue = (v: FollowedVenue, ref: VenueRef) => !!ref.venueId && v.venueId === ref.venueId;

const collection = createCollection<VenueRef, FollowedVenue>({
  storageKey: 'marquee.followed-venues.v1',
  label: 'followed venues',
  requiresAccount: 'follow venues',
  isValid: isFollowedVenue,
  matches: sameFollowedVenue,
});

export function FollowedVenuesProvider({ children }: { children: ReactNode }) {
  return <collection.Provider>{children}</collection.Provider>;
}

type NewFollowedVenue = Omit<FollowedVenue, 'followedAt'>;

export function useFollowedVenues() {
  const { items, ready, has, add, remove, toggle, replaceAll } = collection.useCollection();
  return {
    venues: items,
    /** For the account sync only — see `list-sync.tsx`. */
    replaceAll,
    ready,
    isFollowingVenue: has,
    followVenue: (venue: NewFollowedVenue) => add({ ...venue, followedAt: Date.now() }),
    unfollowVenue: remove,
    toggleVenue: (venue: NewFollowedVenue) => toggle({ ...venue, followedAt: Date.now() }),
  };
}
