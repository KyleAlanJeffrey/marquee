import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

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
 * The feed: recent public reviews by the people you follow. Signed-in only —
 * the query is "my follows", and there is no anonymous version of that.
 */
export function useFeed(enabled: boolean) {
  return useQuery({
    queryKey: ['feed'],
    enabled,
    queryFn: (): Promise<{ items: FeedItem[] }> => apiGet('/me/feed'),
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
