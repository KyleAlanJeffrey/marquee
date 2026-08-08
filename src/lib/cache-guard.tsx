import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth';

/**
 * Empties the query cache when the account changes.
 *
 * The cache persists to device storage now (see the root layout), which is
 * what makes first loads instant — and also what would let one account's
 * lists, suggestions and feed hydrate under the next account on a shared
 * browser. This watches the Clerk user id: any transition *away* from a
 * signed-in account (sign-out, or a direct switch) clears the live cache, and
 * the persister mirrors the clear to storage.
 *
 * Boot is deliberately not a transition: `previous` starts undefined, so a
 * returning user's restore-from-storage — the entire point of persisting —
 * survives. That's safe because there is no path to being signed in as B with
 * A's storage that didn't pass through a signed-in-A → not-A transition while
 * an app instance was watching: Clerk's sign-out runs in-app, and its session
 * cookie/token is what any next sign-in starts from.
 */
export function CacheGuard() {
  const { userId, loading } = useAuth();
  const queryClient = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Clerk still deciding is not an answer; treating it as "signed out"
    // would clear the cache on every boot and undo the restore.
    if (loading) return;
    const was = previous.current;
    previous.current = userId;
    if (was != null && was !== userId) queryClient.clear();
  }, [loading, userId, queryClient]);

  return null;
}
