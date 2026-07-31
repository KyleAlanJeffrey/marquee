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
  /** True when a write may proceed. Never true while `pending`. */
  allowed: boolean;
  /**
   * We don't know yet, because Clerk hasn't finished saying whether the session it
   * has on disk is still good.
   *
   * This is a third state rather than a lean in either direction, and both leans
   * are wrong. Counting it as allowed lets a signed-out user tap Follow during the
   * window and keep something the gate exists to stop — non-deterministically,
   * which is the worst way for a rule to fail. Counting it as denied throws a
   * sign-in screen at somebody who is already signed in. Neither is rare enough to
   * wave off: nothing blocks the tree on `isLoaded`, so the app is fully
   * interactive while this is true, and on web the answer costs a network round
   * trip to Clerk.
   *
   * So callers hold the write instead of deciding it, and apply or refuse it once
   * this clears. Late is acceptable; wrong isn't.
   */
  pending: boolean;
  /**
   * Called *instead of* the write when it may not proceed. `what` is a short noun
   * phrase for the copy on the sign-in screen — "save shows", "follow artists".
   */
  deny: (what: string) => void;
};

export const WriteGateContext = createContext<WriteGate | null>(null);

export function useWriteGate(): WriteGate {
  const ctx = useContext(WriteGateContext);
  if (!ctx) throw new Error('useWriteGate used outside WriteGateProvider');
  return ctx;
}
