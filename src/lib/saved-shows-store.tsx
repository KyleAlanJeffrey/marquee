import type { ReactNode } from 'react';

import { createCollection, isNullableString } from './local-collection';

/**
 * A show the user put aside for later, stored on-device.
 *
 * The snapshot is what makes the Saved tab open instantly and work offline, but
 * it is a copy of a row that can move: doors get pushed back, shows get
 * cancelled. So it is a *starting* value only — the screen revalidates the ids
 * against the server and prefers what comes back. Showing a stale door time
 * would be the one failure that actually costs somebody their evening.
 */
export type SavedShow = {
  eventId: string;
  name: string;
  startsAt: string;
  artistId: string | null;
  artistName: string | null;
  artistImageUrl: string | null;
  venueId: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueTimezone: string | null;
  priceFrom: number | null;
  savedAt: number;
};

export type ShowRef = { eventId?: string | null };

export function isSavedShow(v: unknown): v is SavedShow {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.eventId === 'string' &&
    a.eventId !== '' &&
    typeof a.name === 'string' &&
    typeof a.startsAt === 'string' &&
    isNullableString(a.artistId) &&
    isNullableString(a.artistName) &&
    isNullableString(a.artistImageUrl) &&
    isNullableString(a.venueId) &&
    isNullableString(a.venueName) &&
    isNullableString(a.venueCity) &&
    isNullableString(a.venueTimezone) &&
    (a.priceFrom === null || typeof a.priceFrom === 'number') &&
    typeof a.savedAt === 'number'
  );
}

export const sameSavedShow = (s: SavedShow, ref: ShowRef) => !!ref.eventId && s.eventId === ref.eventId;

const collection = createCollection<ShowRef, SavedShow>({
  storageKey: 'marquee.saved-shows.v1',
  label: 'saved shows',
  isValid: isSavedShow,
  matches: sameSavedShow,
});

export function SavedShowsProvider({ children }: { children: ReactNode }) {
  return <collection.Provider>{children}</collection.Provider>;
}

type NewSavedShow = Omit<SavedShow, 'savedAt'>;

export function useSavedShows() {
  const { items, ready, has, add, remove, toggle } = collection.useCollection();
  return {
    saved: items,
    ready,
    isSaved: has,
    save: (show: NewSavedShow) => add({ ...show, savedAt: Date.now() }),
    unsave: remove,
    toggleSaved: (show: NewSavedShow) => toggle({ ...show, savedAt: Date.now() }),
  };
}
