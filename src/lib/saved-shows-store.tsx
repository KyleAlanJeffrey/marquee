import { createCollection } from './account-lists';
import { isSavedShow, sameSavedShow, type SavedShow, type ShowRef } from './list-schemas';

/**
 * Shows you put aside for later, on your account.
 *
 * The shape and its validators live in `list-schemas.ts` — a module that imports
 * nothing, so the specs and the Worker can share them without dragging
 * `react-native` into a Node test run — and are re-exported here so every existing
 * import path still resolves.
 */
export { isSavedShow, sameSavedShow };
export type { SavedShow, ShowRef };

const collection = createCollection<ShowRef, SavedShow>({
  kind: 'saved',
  label: 'saved shows',
  requiresAccount: 'save shows',
  isValid: isSavedShow,
  matches: sameSavedShow,
});


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
