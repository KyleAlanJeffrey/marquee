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
  const { configured, signedIn, loading } = useAuth();

  const deny = useCallback((what: string) => {
    router.push({ pathname: '/sign-in', params: { why: what } });
  }, []);

  const value = useMemo<WriteGate>(
    () => ({
      // `loading` counts as allowed on purpose: Clerk takes a moment to say whether
      // a stored session is still good, and bouncing somebody to sign in during that
      // window would throw a login screen at a user who is already signed in. The
      // server is the real gate for anything that leaves the device.
      allowed: !configured || loading || signedIn,
      deny,
    }),
    [configured, loading, signedIn, deny],
  );

  return <WriteGateContext.Provider value={value}>{children}</WriteGateContext.Provider>;
}
