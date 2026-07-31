import { router } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth';
import { WriteGateContext, type WriteGate } from '@/lib/write-gate';

/**
 * Supplies the real answer to `useWriteGate()`.
 *
 * Split from `write-gate.tsx` so that the rule (a context, a default, a hook) stays
 * a React-only leaf that `local-collection.tsx` can import without pulling
 * `expo-router` and `@clerk/expo` into the store specs. This half knows about auth
 * and navigation; that half is what the data layer sees.
 */
export function WriteGateProvider({ children }: { children: ReactNode }) {
  const { signedIn, loading } = useAuth();

  const deny = useCallback((what: string) => {
    router.push({ pathname: '/sign-in', params: { why: what } });
  }, []);

  const value = useMemo<WriteGate>(
    () => ({
      // `loading` is deliberately not folded into `allowed`. Clerk takes a moment —
      // a network round trip on web — to say whether a stored session is still
      // good, and during it the app is already interactive. Treating that as allowed
      // let a signed-out user slip a Follow past the gate depending on how fast
      // their network was, so it is reported as `pending` and the write waits.
      allowed: !loading && signedIn,
      pending: loading,
      deny,
    }),
    [loading, signedIn, deny],
  );

  return <WriteGateContext.Provider value={value}>{children}</WriteGateContext.Provider>;
}
