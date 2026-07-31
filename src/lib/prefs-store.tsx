import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Search radius and the reminders switch, on the account.
 *
 * These were the last two things in the device's storage. Nothing is stored locally any
 * more (see `account-lists.tsx` for the decision), so a preference lives on the account
 * or it does not persist at all.
 *
 * Signed out, the defaults apply and a change lasts as long as the session in memory.
 * That is deliberate rather than a gap: browsing is open to anonymous visitors, so the
 * radius has to have *some* value, and 50 miles is a better answer than a sign-in wall
 * in front of looking at what's on this week.
 */

export const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const DEFAULTS = { radiusMiles: 50, remindersEnabled: false };

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

  const stored = query.data?.user;
  // Null from the server means "never chosen", which is not the same as 0 or false —
  // so the fallback is `??` rather than `||`, and a radius of 0 could never be stored
  // anyway because the route rejects it.
  const radiusMiles = stored?.radiusMiles ?? DEFAULTS.radiusMiles;
  const remindersEnabled = stored?.remindersEnabled == null ? DEFAULTS.remindersEnabled : !!stored.remindersEnabled;

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
      if (!signedIn) return;
      save.mutate({ radiusMiles: miles });
    },
    [signedIn, save],
  );

  const setRemindersEnabled = useCallback(
    (enabled: boolean) => {
      if (!signedIn) return;
      save.mutate({ remindersEnabled: enabled });
    },
    [signedIn, save],
  );

  return {
    radiusMiles,
    remindersEnabled,
    /** True when there is nothing left to wait for — immediately so when signed out. */
    ready: !signedIn || query.isSuccess || query.isError,
    /** False signed out: there is nowhere to keep a preference. */
    canChange: signedIn,
    setRadiusMiles,
    setRemindersEnabled,
  };
}
