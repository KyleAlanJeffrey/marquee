import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Search radius and the reminders switch, on the account.
 *
 * These were the last two things in the device's storage. Nothing is stored locally any
 * more (see `account-lists.tsx` for the decision), so a preference lives on the account
 * or it does not persist at all.
 *
 * Signed out, a change still takes effect — it just lasts only as long as the app is
 * open. That is deliberate rather than a gap: browsing is open to anonymous visitors,
 * so the radius has to have *some* value they can adjust, and a working control that
 * forgets is a better answer than a sign-in wall in front of looking at what's on
 * this week.
 */

export const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const DEFAULTS = { radiusMiles: 50, remindersEnabled: false };

// --- signed-out session prefs -------------------------------------------------
// A module-level cell rather than component state, because every screen that reads
// the radius must see the same value. Never written while signed in, so signing in
// simply stops reading it and the account's values take over.

type SessionPrefs = { radiusMiles?: number; remindersEnabled?: boolean };

let sessionPrefs: SessionPrefs = {};
const sessionListeners = new Set<() => void>();

function patchSessionPrefs(patch: SessionPrefs) {
  sessionPrefs = { ...sessionPrefs, ...patch };
  sessionListeners.forEach((notify) => notify());
}

const subscribeSession = (notify: () => void) => {
  sessionListeners.add(notify);
  return () => sessionListeners.delete(notify);
};
const readSession = () => sessionPrefs;

/** The same query key `/api/me` is read under elsewhere, so one fetch serves both. */
const ME_KEY = ['me'] as const;

type MeResponse = {
  signed_in: boolean;
  user: { radiusMiles?: number | null; remindersEnabled?: number | null } | null;
};

export function usePrefs() {
  const { signedIn, loading } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ME_KEY,
    enabled: signedIn && !loading,
    staleTime: 30 * 1000,
    queryFn: (): Promise<MeResponse> => apiGet('/me'),
  });

  const session = useSyncExternalStore(subscribeSession, readSession, readSession);

  const stored = query.data?.user;
  // Null from the server means "never chosen", which is not the same as 0 or false —
  // so the fallback is `??` rather than `||`, and a radius of 0 could never be stored
  // anyway because the route rejects it. Signed out, the in-memory session value
  // stands in for the account's.
  const radiusMiles = signedIn
    ? (stored?.radiusMiles ?? DEFAULTS.radiusMiles)
    : (session.radiusMiles ?? DEFAULTS.radiusMiles);
  const remindersEnabled = signedIn
    ? stored?.remindersEnabled == null
      ? DEFAULTS.remindersEnabled
      : !!stored.remindersEnabled
    : (session.remindersEnabled ?? DEFAULTS.remindersEnabled);

  const save = useMutation({
    mutationFn: (patch: { radiusMiles?: number; remindersEnabled?: boolean }) => apiPut('/me/prefs', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      const previous = queryClient.getQueryData<MeResponse>(ME_KEY);
      queryClient.setQueryData<MeResponse>(ME_KEY, (old) =>
        old
          ? {
              ...old,
              user: {
                ...old.user,
                ...(patch.radiusMiles !== undefined ? { radiusMiles: patch.radiusMiles } : {}),
                ...(patch.remindersEnabled !== undefined
                  ? { remindersEnabled: patch.remindersEnabled ? 1 : 0 }
                  : {}),
              },
            }
          : old,
      );
      return { previous };
    },
    onError: (err, _patch, context) => {
      console.warn('failed to save preferences:', err);
      if (context?.previous) queryClient.setQueryData(ME_KEY, context.previous);
    },
  });

  const setRadiusMiles = useCallback(
    (miles: number) => {
      if (signedIn) save.mutate({ radiusMiles: miles });
      else patchSessionPrefs({ radiusMiles: miles });
    },
    [signedIn, save],
  );

  const setRemindersEnabled = useCallback(
    (enabled: boolean) => {
      if (signedIn) save.mutate({ remindersEnabled: enabled });
      else patchSessionPrefs({ remindersEnabled: enabled });
    },
    [signedIn, save],
  );

  return {
    radiusMiles,
    remindersEnabled,
    /** True when there is nothing left to wait for — immediately so when signed out. */
    ready: !signedIn || query.isSuccess || query.isError,
    /** False when a change only lasts the session — the copy changes, not the controls. */
    persisted: signedIn,
    setRadiusMiles,
    setRemindersEnabled,
  };
}
