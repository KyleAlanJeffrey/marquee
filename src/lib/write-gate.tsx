import { createContext, useContext } from 'react';

/**
 * Whether the user is allowed to add to one of their own lists, and what happens
 * when they aren't.
 *
 * Marquee decided (2026-07-31) that browsing stays open and *keeping* things needs
 * an account: search, explore, town pages and every detail page work signed out,
 * but following, saving and logging a show do not. This is the one place that rule
 * is enforced, because every one of those lists is a `createCollection` — so
 * gating the mutators there gates all eight-odd screens at once, including the
 * ninth that gets written later by somebody who never read this file.
 *
 * **This module deliberately imports nothing but React.** It is consumed by
 * `local-collection.tsx`, which the store specs exercise for its pure merge logic;
 * an import of `expo-router` or `@clerk/expo` here drags the whole router and SDK
 * into those specs and they fail on untranspiled TSX in a transitive dependency.
 * The wiring — who is signed in, and where "sign in" goes — lives in
 * `write-gate-provider.tsx`, which is imported only from the app tree.
 */
export type WriteGate = {
  /** True when a write may proceed. */
  allowed: boolean;
  /**
   * Called *instead of* the write when it may not proceed. `what` is a short noun
   * phrase for the copy on the sign-in screen — "save shows", "follow artists".
   */
  deny: (what: string) => void;
};

/**
 * Open by default, and that is deliberate.
 *
 * With no Clerk key there are no accounts to require, and the app has to keep
 * working exactly as it did before they existed — a fork, a local dev run, and the
 * build that shipped before this commit. So an absent provider means "allowed",
 * never "denied": failing closed here would turn a missing env var into an app
 * where nothing can be saved and nothing says why.
 */
export const OPEN_GATE: WriteGate = { allowed: true, deny: () => {} };

export const WriteGateContext = createContext<WriteGate>(OPEN_GATE);

export function useWriteGate(): WriteGate {
  return useContext(WriteGateContext);
}
