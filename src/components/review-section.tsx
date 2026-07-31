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
import {
  useDeleteReview,
  useEventReviews,
  useReportReview,
  useSaveReview,
  type PublicReview,
} from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

/**
 * Public reviews of one show: everyone else's, then yours to write.
 *
 * The composer is its own form on purpose — it starts empty, and nothing from
 * the private log is read into it. The log's note stays a note unless its
 * author retypes it here, which is the per-entry opt-in docs/social.md
 * promised. Only rendered for shows that have happened; the server refuses
 * the rest anyway, this just doesn't offer the lie.
 */

const BODY_MAX = 4000;

function authorLabel(r: PublicReview): string {
  return r.authorName ?? (r.authorHandle ? `@${r.authorHandle}` : 'Marquee listener');
}

/** One public review, with the report control tucked behind an arm step. */
function ReviewRow({ review }: { review: PublicReview }) {
  const theme = useTheme();
  const report = useReportReview();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <View style={[styles.reviewRow, { borderColor: theme.border }]}>
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
        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
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

export function ReviewSection({ eventId, venueName }: { eventId: string; venueName: string | null }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const { data, isLoading } = useEventReviews(eventId);
  const save = useSaveReview(eventId);
  const remove = useDeleteReview(eventId);

  const mine = data?.mine ?? null;
  const [editing, setEditing] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [venueRating, setVenueRating] = useState<number | null>(null);
  const [body, setBody] = useState('');

  const openComposer = () => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('write reviews');
      return;
    }
    // Prefilled from the existing review — an edit starts from what's published.
    // Never from the log: its note is private until its author retypes it here.
    setRating(mine?.rating ?? null);
    setVenueRating(mine?.venueRating ?? null);
    setBody(mine?.body ?? '');
    setEditing(true);
  };

  const publish = () => {
    const trimmed = body.trim();
    if (rating == null && venueRating == null && trimmed === '') return;
    save.mutate(
      { rating, venueRating, body: trimmed || null },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <GlassCard style={styles.card}>
      {/* Yours first: the ask, or the published state of it. */}
      {editing ? (
        <View style={styles.composer}>
          <View style={styles.ratingRow}>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
              THE PERFORMANCE
            </ThemedText>
            <StarRating value={rating} onChange={setRating} subject="the performance" />
          </View>
          {venueName ? (
            <View style={styles.ratingRow}>
              <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
                THE ROOM
              </ThemedText>
              <StarRating value={venueRating} onChange={setVenueRating} subject={venueName} />
            </View>
          ) : null}
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What was it like? (optional)"
            placeholderTextColor={theme.textTertiary}
            multiline
            maxLength={BODY_MAX}
            style={[styles.input, styles.bodyInput, { color: theme.text, borderColor: theme.border }]}
          />
          <View style={styles.composerButtons}>
            <PressableScale
              haptic
              accessibilityRole="button"
              accessibilityLabel="Publish your review"
              onPress={publish}
              style={[styles.smallBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
              <ThemedText type="labelSm" style={{ color: theme.primary }}>
                {save.isPending ? 'PUBLISHING…' : mine ? 'UPDATE REVIEW' : 'PUBLISH REVIEW'}
              </ThemedText>
            </PressableScale>
            <PressableScale
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Discard changes"
              onPress={() => setEditing(false)}
              style={[styles.smallBtn, { borderColor: theme.border }]}>
              <ThemedText type="labelSm" themeColor="textSecondary">
                CANCEL
              </ThemedText>
            </PressableScale>
            {mine && (
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel={
                  confirmingRemoval ? 'Confirm: take your review down' : 'Take your review down'
                }
                // Same second-tap confirm as account deletion, and for the same
                // reason: multi-button Alert dialogs are a no-op on web.
                onPress={() => {
                  if (!confirmingRemoval) {
                    setConfirmingRemoval(true);
                    return;
                  }
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      setConfirmingRemoval(false);
                      setEditing(false);
                    },
                    onError: () => setConfirmingRemoval(false),
                  });
                }}
                style={[styles.smallBtn, { borderColor: confirmingRemoval ? theme.error : theme.border }]}>
                <ThemedText type="labelSm" style={{ color: theme.error }}>
                  {confirmingRemoval ? 'TAP AGAIN TO REMOVE' : 'TAKE IT DOWN'}
                </ThemedText>
              </PressableScale>
            )}
          </View>
          {save.isError && (
            <ThemedText type="labelSm" style={{ color: theme.error }}>
              COULDN&apos;T PUBLISH JUST NOW — TRY AGAIN
            </ThemedText>
          )}
          {remove.isError && (
            <ThemedText type="labelSm" style={{ color: theme.error }}>
              COULDN&apos;T TAKE IT DOWN JUST NOW — TRY AGAIN
            </ThemedText>
          )}
        </View>
      ) : (
        <PressableScale
          haptic
          accessibilityRole="button"
          accessibilityLabel={mine ? 'Edit your public review' : 'Write a public review of this show'}
          onPress={openComposer}
          style={[styles.cta, { borderColor: theme.border }]}>
          <Ionicons name={mine ? 'create-outline' : 'megaphone-outline'} size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">
              {mine ? 'Your review is up' : 'Been? Say what it was like'}
            </ThemedText>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              {mine
                ? mine.visibility === 'hidden'
                  ? 'HIDDEN BY MODERATION — ONLY YOU SEE IT'
                  : 'PUBLIC · TAP TO EDIT OR REMOVE'
                : 'PUBLIC, UNDER YOUR NAME — UNLIKE YOUR LOG'}
            </ThemedText>
          </View>
          {mine?.rating != null && <StarRating value={mine.rating} size={14} subject="your rating" />}
        </PressableScale>
      )}

      {/* Everyone else's. */}
      {isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (data?.reviews.length ?? 0) === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>
          No public reviews of this show yet.
        </ThemedText>
      ) : (
        data!.reviews.map((r) => <ReviewRow key={r.id} review={r} />)
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three, padding: Spacing.three },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  composer: { gap: Spacing.two },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerButtons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
    flex: 1,
  },
  bodyInput: { minHeight: 72, textAlignVertical: 'top', flex: undefined },
  smallBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  centre: { alignItems: 'center', padding: Spacing.two },
  emptyNote: { textAlign: 'center', paddingVertical: Spacing.one },
  reviewRow: { gap: Spacing.one + 2, paddingTop: Spacing.two, borderTopWidth: 1 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  reviewFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
});
