import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import type { NearbyEvent } from '@/lib/types';

/**
 * Public reviews, client side — phase B of docs/social.md.
 *
 * Everything here talks to the review routes and nothing here touches the
 * private log. That separation is the privacy design, not an accident: a
 * review is composed in its own form and sent in its own request, so no code
 * path exists that could publish a log entry.
 */

export type PublicReview = {
  id: string;
  rating: number | null;
  venueRating: number | null;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  authorId: string;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

export type MyReview = {
  id: string;
  rating: number | null;
  venueRating: number | null;
  body: string | null;
  /** 'public', or 'hidden' when moderation took it down — shown to the author. */
  visibility: string;
  createdAt: string;
  editedAt: string | null;
};

export type ProfileReview = {
  id: string;
  eventId: string;
  eventName: string;
  startsAt: string;
  rating: number | null;
  venueRating: number | null;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
};

const eventReviewsKey = (eventId: string) => ['event-reviews', eventId] as const;
const profileReviewsKey = (key: string) => ['profile-reviews', key] as const;

export function useEventReviews(eventId: string, enabled = true) {
  return useQuery({
    queryKey: eventReviewsKey(eventId),
    enabled: !!eventId && enabled,
    queryFn: (): Promise<{ reviews: PublicReview[]; mine: MyReview | null }> =>
      apiGet(`/events/${encodeURIComponent(eventId)}/reviews`),
  });
}

export function useProfileReviews(key: string, enabled = true) {
  return useQuery({
    queryKey: profileReviewsKey(key),
    enabled: !!key && enabled,
    queryFn: (): Promise<{ reviews: ProfileReview[] }> =>
      apiGet(`/users/${encodeURIComponent(key)}/reviews`),
  });
}

/** Publish or update your review of a show. The server refuses future shows. */
export function useSaveReview(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (review: { rating: number | null; venueRating: number | null; body: string | null }) =>
      apiPut(`/events/${encodeURIComponent(eventId)}/review`, review),
    // The profile's review list shows the same rows, cached under a key this
    // mutation can't name precisely (handle or id) — prefix invalidation again.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventReviewsKey(eventId) });
      queryClient.invalidateQueries({ queryKey: ['profile-reviews'] });
    },
  });
}

export function useDeleteReview(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/events/${encodeURIComponent(eventId)}/review`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventReviewsKey(eventId) });
      queryClient.invalidateQueries({ queryKey: ['profile-reviews'] });
    },
  });
}

/** Report a review to the moderation queue, with the reporter's reason. */
export function useReportReview() {
  return useMutation({
    mutationFn: ({ reviewId, reason }: { reviewId: string; reason: string }) =>
      apiPost(`/reviews/${encodeURIComponent(reviewId)}/report`, { reason }),
  });
}

export type FeedItem = ProfileReview & {
  authorId: string;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

/**
 * The feed: recent public reviews by the people you follow, oldest pages on
 * demand. Signed-in only — the query is "my follows", and there is no
 * anonymous version of that.
 */
export function useFeed(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['feed'],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<{ items: FeedItem[]; nextCursor: string | null }> =>
      apiGet(`/me/feed${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// --- going / interested -------------------------------------------------------

export type RsvpStatus = 'going' | 'interested';
export type EventRsvps = { counts: { going: number; interested: number }; mine: RsvpStatus | null };

const rsvpKey = (eventId: string) => ['event-rsvps', eventId] as const;

export function useEventRsvps(eventId: string, enabled = true) {
  return useQuery({
    queryKey: rsvpKey(eventId),
    enabled: !!eventId && enabled,
    queryFn: (): Promise<EventRsvps> => apiGet(`/events/${encodeURIComponent(eventId)}/rsvps`),
  });
}

/**
 * Set or clear your answer, optimistically: the button flips and the count
 * moves before the server replies, and both roll back if it refuses — same
 * policy as every other write in the app.
 */
export function useSetRsvp(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: RsvpStatus | null) =>
      status
        ? apiPut(`/events/${encodeURIComponent(eventId)}/rsvp`, { status })
        : apiDelete(`/events/${encodeURIComponent(eventId)}/rsvp`),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: rsvpKey(eventId) });
      const previous = queryClient.getQueryData<EventRsvps>(rsvpKey(eventId));
      queryClient.setQueryData<EventRsvps>(rsvpKey(eventId), (old) => {
        if (!old) return old;
        const counts = { ...old.counts };
        if (old.mine) counts[old.mine] = Math.max(0, counts[old.mine] - 1);
        if (status) counts[status] += 1;
        return { counts, mine: status };
      });
      return { previous };
    },
    onError: (err, _status, context) => {
      console.warn('rsvp failed:', err);
      if (context?.previous) queryClient.setQueryData(rsvpKey(eventId), context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rsvpKey(eventId) });
      // The My Shows tab lists every answer, so it learns about this one.
      queryClient.invalidateQueries({ queryKey: ['my-rsvps'] });
    },
  });
}

/** A show you answered on, in the same shape the feed cards render. */
export type MyRsvp = NearbyEvent & { rsvp_status: RsvpStatus };

/** Everything you're going to or interested in that's still to come. */
export function useMyRsvps(enabled = true) {
  return useQuery({
    queryKey: ['my-rsvps'],
    enabled,
    queryFn: (): Promise<{ items: MyRsvp[] }> => apiGet('/me/rsvps'),
  });
}

export type RatingStats = { count: number; average: number | null };

/** Reviews only headline a page once a few people agree — one rave is a rave. */
export const STATS_FLOOR = 3;

export function useArtistReviewStats(artistId: string) {
  return useQuery({
    queryKey: ['artist-review-stats', artistId],
    enabled: !!artistId,
    queryFn: (): Promise<{ live: RatingStats }> =>
      apiGet(`/artists/${encodeURIComponent(artistId)}/review-stats`),
  });
}

export function useVenueReviewStats(venueId: string) {
  return useQuery({
    queryKey: ['venue-review-stats', venueId],
    enabled: !!venueId,
    queryFn: (): Promise<{ room: RatingStats }> =>
      apiGet(`/venues/${encodeURIComponent(venueId)}/review-stats`),
  });
}

/**
 * Block or unblock a person. Blocking severs follows both ways and hides both
 * parties' reviews from each other — the server owns those consequences; this
 * just refreshes everything that could have shown them.
 */
export function useBlockPerson(profileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (block: boolean) =>
      block
        ? apiPost(`/users/${encodeURIComponent(profileKey)}/block`, {})
        : apiDelete(`/users/${encodeURIComponent(profileKey)}/block`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['profile-list'] });
      queryClient.invalidateQueries({ queryKey: ['profile-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['event-reviews'] });
    },
  });
}
