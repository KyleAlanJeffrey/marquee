import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * People: public profiles and the person graph. Phase A of docs/social.md.
 *
 * Distinct from `follows-store` on purpose — that is *your artists*, a private
 * list only you read. A person follow is a public edge read from both ends, so
 * it lives on the server (`person_follows`) and is fetched per-profile rather
 * than being one of the account's list documents.
 */

/** What the server publishes of any user — see PUBLIC_FIELDS in routes/people.ts. */
export type PublicUser = {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type Profile = {
  user: PublicUser;
  counts: { followers: number; following: number };
  /** Null when the request went out signed out. */
  viewer: { following: boolean; isSelf: boolean } | null;
};

export type FollowListEntry = PublicUser & { followedAt: string };

const profileKey = (key: string) => ['profile', key] as const;
const followListKey = (key: string, direction: 'followers' | 'following') =>
  ['profile-list', key, direction] as const;

/** Something to print for a user in every state, since both fields are nullable. */
export function personLabel(u: PublicUser): string {
  return u.displayName ?? (u.handle ? `@${u.handle}` : 'Marquee listener');
}

export function useProfile(key: string) {
  return useQuery({
    queryKey: profileKey(key),
    enabled: !!key,
    queryFn: (): Promise<Profile> => apiGet(`/users/${encodeURIComponent(key)}`),
  });
}

export function useFollowList(key: string, direction: 'followers' | 'following', enabled: boolean) {
  return useQuery({
    queryKey: followListKey(key, direction),
    enabled: !!key && enabled,
    queryFn: (): Promise<{ people: FollowListEntry[]; limit: number }> =>
      apiGet(`/users/${encodeURIComponent(key)}/${direction}`),
  });
}

/**
 * Follow or unfollow, optimistically: the button flips and the follower count
 * moves before the server answers, and both roll back if it refuses. Same
 * policy as every list write in `account-lists.tsx` — a follow button that
 * waits on a round trip feels broken, and a silent failure is worse than a
 * visible revert.
 */
export function useFollowPerson(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: boolean) =>
      next
        ? apiPost(`/users/${encodeURIComponent(key)}/follow`, {})
        : apiDelete(`/users/${encodeURIComponent(key)}/follow`),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: profileKey(key) });
      const previous = queryClient.getQueryData<Profile>(profileKey(key));
      queryClient.setQueryData<Profile>(profileKey(key), (old) =>
        old && old.viewer
          ? {
              ...old,
              counts: { ...old.counts, followers: Math.max(0, old.counts.followers + (next ? 1 : -1)) },
              viewer: { ...old.viewer, following: next },
            }
          : old,
      );
      return { previous };
    },
    onError: (err, _next, context) => {
      console.warn('follow failed:', err);
      if (context?.previous) queryClient.setQueryData(profileKey(key), context.previous);
    },
    // Every cached profile, not just this one: the viewer's own profile — its
    // following count and list — changed too, and it may be cached under their
    // handle, their id, or both, so there is no precise key to name. Profiles
    // are one cheap read each and follows are rare; blanket beats stale.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['profile-list'] });
    },
  });
}

/**
 * Push the mirror row when a session appears.
 *
 * `POST /me` makes the server refresh handle, display name and avatar from
 * Clerk itself (no body — there is nothing the client is trusted to say). Once
 * per user per app run: profiles change rarely, and the ones who change theirs
 * mid-session see it after their next launch.
 *
 * Rendered as a component rather than called as a hook so it can sit in the
 * root layout next to the other mount-once wiring.
 */
export function ProfileSync() {
  const { signedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn || !userId || synced.current === userId) return;
    synced.current = userId;
    apiPost('/me', {})
      .then(() => {
        // `/api/me` and every profile read come off the mirror row this just
        // rewrote — the own-profile card on the Profile tab in particular may
        // have 404ed moments ago, before the row existed.
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      })
      .catch((err) => {
        // Cleared so the next auth change retries, instead of one failed sync
        // meaning this session never writes a profile at all.
        synced.current = null;
        console.warn('profile sync failed:', err);
      });
  }, [signedIn, userId, queryClient]);

  return null;
}
