import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate } from '@/lib/format';
import { useEventReviews, useLikeReview, useReportReview, type PublicReview } from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

/**
 * Everyone else's public reviews of one show. Yours is written, edited and
 * taken down in the log card above (`AttendanceCard`) — one act, with the
 * public step inside it — so this section is purely the room's verdicts.
 * Only rendered for shows that have happened; the server refuses the rest
 * anyway, this just doesn't offer the lie.
 */

function authorLabel(r: PublicReview): string {
  return r.authorName ?? (r.authorHandle ? `@${r.authorHandle}` : 'Marquee listener');
}

/** One public review, with the report control tucked behind an arm step. */
function ReviewRow({ review, eventId, first }: { review: PublicReview; eventId: string; first?: boolean }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const like = useLikeReview(eventId);
  const report = useReportReview();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);

  const onLike = () => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('like reviews');
      return;
    }
    like.mutate({ reviewId: review.id, like: !review.likedByMe });
  };

  return (
    <View style={[styles.reviewRow, { borderColor: theme.border }, first && styles.firstRow]}>
      <PressableScale
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={`Open ${authorLabel(review)}'s profile`}
        onPress={() => router.push(`/user/${encodeURIComponent(review.authorHandle ?? review.authorId)}`)}
        style={styles.authorRow}>
        {review.authorAvatarUrl ? (
          <Image source={{ uri: review.authorAvatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundHigh }]}>
            <Ionicons name="person" size={12} color={theme.textTertiary} />
          </View>
        )}
        <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
          {authorLabel(review)}
        </ThemedText>
        {review.rating != null && <StarRating value={review.rating} size={14} subject="the performance" />}
      </PressableScale>

      {!!review.body && (
        <ThemedText type="small" themeColor="textSecondary">
          {review.body}
        </ThemedText>
      )}

      <View style={styles.reviewFoot}>
        {/* The heart: the cheapest agreement there is, and what "popular
            reviews" ordering runs on. */}
        <PressableScale
          haptic
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: review.likedByMe }}
          accessibilityLabel={
            review.likedByMe ? 'Unlike this review' : `Like ${authorLabel(review)}'s review`
          }
          onPress={onLike}
          style={styles.likeBtn}>
          <Ionicons
            name={review.likedByMe ? 'heart' : 'heart-outline'}
            size={15}
            color={review.likedByMe ? theme.primary : theme.textTertiary}
          />
          {review.likeCount > 0 && (
            <ThemedText
              type="labelSm"
              style={{ color: review.likedByMe ? theme.primary : theme.textTertiary }}>
              {review.likeCount}
            </ThemedText>
          )}
        </PressableScale>
        <ThemedText type="labelSm" style={[{ color: theme.textTertiary }, styles.footDate]}>
          {formatEventDate(review.createdAt, null).toUpperCase()}
          {review.editedAt ? ' · EDITED' : ''}
        </ThemedText>
        {sent ? (
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            REPORTED
          </ThemedText>
        ) : (
          <PressableScale
            haptic={false}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={reporting ? 'Cancel reporting this review' : 'Report this review'}
            onPress={() => setReporting((v) => !v)}>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              {reporting ? 'CANCEL' : 'REPORT'}
            </ThemedText>
          </PressableScale>
        )}
      </View>

      {reporting && !sent && (
        <View style={styles.reportRow}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What's wrong with it?"
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            maxLength={500}
          />
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel="Send the report"
            onPress={() => {
              const trimmed = reason.trim();
              if (trimmed.length < 3) return;
              report.mutate(
                { reviewId: review.id, reason: trimmed },
                { onSuccess: () => setSent(true), onError: () => setReporting(false) },
              );
            }}
            style={[styles.smallBtn, { borderColor: theme.border }]}>
            <ThemedText type="labelSm" style={{ color: theme.primary }}>
              SEND
            </ThemedText>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

export function ReviewSection({ eventId }: { eventId: string }) {
  const theme = useTheme();
  const { data, isLoading } = useEventReviews(eventId);

  return (
    <GlassCard style={styles.card}>
      {isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (data?.reviews.length ?? 0) === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>
          No public reviews of this show yet.
        </ThemedText>
      ) : (
        data!.reviews.map((r, i) => <ReviewRow key={r.id} review={r} eventId={eventId} first={i === 0} />)
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three, padding: Spacing.three },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
    flex: 1,
  },
  smallBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  centre: { alignItems: 'center', padding: Spacing.two },
  emptyNote: { textAlign: 'center', paddingVertical: Spacing.one },
  reviewRow: { gap: Spacing.one + 2, paddingTop: Spacing.two, borderTopWidth: 1 },
  firstRow: { paddingTop: 0, borderTopWidth: 0 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  reviewFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footDate: { flex: 1 },
  reportRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
});
