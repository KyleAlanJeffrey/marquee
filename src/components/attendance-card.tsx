import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances, type NewAttendance } from '@/lib/attendances-store';
import { useDeleteReview, useEventReviews, useSaveReview } from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

const BODY_MAX = 4000;

type Props = {
  /** The show, as it would be stored. */
  show: NewAttendance;
  /** The room's name, for the second rating's label. Null when we can't name it. */
  venueName?: string | null;
};

/**
 * "Were you there?" — logging a night, as one act.
 *
 * The card walks the Letterboxd shape: log it (one tap, private), rate it
 * (optional, still private), and then — as a step of the same act rather than
 * a second form further down the page — say it in public. The privacy design
 * underneath is unchanged: the log and the review are different tables with
 * different lifecycles, and nothing here publishes without a deliberate tap
 * on PUBLISH.
 *
 * Opening the composer starts from your log's stars when there's no review
 * yet — a per-entry, visible seed of numbers you're about to publish anyway.
 * The log's *note* is a different promise (docs/social.md): it never crosses
 * over, and there is deliberately no code path from it to the body field.
 *
 * Only rendered for shows that have already started — see `hasHappened` at
 * the call site. The public step also appears when a review exists without a
 * log entry, so unlogging a show never strands a published review.
 */
export function AttendanceCard({ show, venueName }: Props) {
  const theme = useTheme();
  const { wasThere, attendanceFor, toggleAttended, rate } = useAttendances();
  const gate = useWriteGate();
  const reviews = useEventReviews(show.eventId);
  const save = useSaveReview(show.eventId);
  const remove = useDeleteReview(show.eventId);

  const ref = { eventId: show.eventId };
  const logged = wasThere(ref);
  const entry = attendanceFor(ref);
  const mine = reviews.data?.mine ?? null;

  const [editing, setEditing] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [seededFromLog, setSeededFromLog] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [venueRating, setVenueRating] = useState<number | null>(null);
  const [body, setBody] = useState('');

  const toggle = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleAttended(show);
  };

  const openComposer = () => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('write reviews');
      return;
    }
    // An edit starts from what's published; a first review starts from the
    // stars already given above — same numbers, one ask. The body starts
    // empty unless it's already public: the log's note never crosses over.
    setRating(mine?.rating ?? entry?.rating ?? null);
    setVenueRating(mine?.venueRating ?? entry?.venueRating ?? null);
    setBody(mine?.body ?? '');
    setSeededFromLog(!mine && (entry?.rating != null || entry?.venueRating != null));
    setConfirmingRemoval(false);
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
    <View style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: logged ? theme.cyanEdge : theme.border }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ selected: logged }}
        accessibilityLabel={logged ? 'remove this show from your log' : 'add this show to your log'}
        onPress={toggle}
        style={styles.headRow}>
        <View style={[styles.check, { backgroundColor: logged ? theme.cyanFill : theme.backgroundHigh, borderColor: logged ? theme.cyan : theme.border }]}>
          <Ionicons
            name={logged ? 'checkmark' : 'add'}
            size={20}
            color={logged ? theme.cyan : theme.textTertiary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">{logged ? 'You were at this show' : 'Were you there?'}</ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {logged ? 'IN YOUR LOG · PRIVATE TO YOU' : 'ADD IT TO YOUR LOG'}
          </ThemedText>
        </View>
      </PressableScale>

      {/*
        The ratings appear only once the show is logged. Offering them first would
        ask for a verdict before the fact it is a verdict *about* — and they are
        the reason to come back to this card, not the reason to open it.
      */}
      {logged ? (
        <View style={styles.ratings}>
          <View style={styles.ratingRow}>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
              THE PERFORMANCE
            </ThemedText>
            <StarRating
              value={entry?.rating ?? null}
              subject="the performance"
              placeholder="NOT RATED"
              onChange={(rating) => rate(show, { rating })}
            />
          </View>
          {/*
            Split from the performance because they genuinely differ — a great set
            in a room with bad sound is two verdicts — and because people given
            only one score put both into it. Hidden when we can't name the room,
            since "rate the venue" with no venue is a question about nothing.
          */}
          {venueName ? (
            <View style={styles.ratingRow}>
              <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
                THE ROOM
              </ThemedText>
              <StarRating
                value={entry?.venueRating ?? null}
                subject={venueName}
                placeholder="NOT RATED"
                onChange={(venueRating) => rate(show, { venueRating })}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* The public step of the same act. */}
      {logged || mine ? (
        <View style={[styles.publicStep, { borderColor: theme.border }]}>
          {editing ? (
            <View style={styles.composer}>
              {seededFromLog && (
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  STARTING FROM YOUR LOG&rsquo;S STARS — NOTHING IS PUBLIC UNTIL YOU PUBLISH
                </ThemedText>
              )}
              <View style={styles.composerRatingRow}>
                <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
                  THE PERFORMANCE
                </ThemedText>
                <StarRating value={rating} onChange={setRating} subject="the performance" />
              </View>
              {venueName ? (
                <View style={styles.composerRatingRow}>
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
                style={[styles.bodyInput, { color: theme.text, borderColor: theme.border }]}
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
              style={styles.publicCta}>
              <Ionicons name={mine ? 'create-outline' : 'megaphone-outline'} size={18} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {mine ? 'Your review is up' : 'Say it in public'}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {mine
                    ? mine.visibility === 'hidden'
                      ? 'HIDDEN BY MODERATION — ONLY YOU SEE IT'
                      : 'PUBLIC · TAP TO EDIT OR REMOVE'
                    : 'PUBLIC, UNDER YOUR NAME — UNLIKE THE LOG ABOVE'}
                </ThemedText>
              </View>
              {mine?.rating != null && <StarRating value={mine.rating} size={14} subject="your rating" />}
            </PressableScale>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.three,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  check: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratings: { gap: Spacing.three },
  ratingRow: { gap: Spacing.two },
  publicStep: { borderTopWidth: 1, paddingTop: Spacing.three },
  publicCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  composer: { gap: Spacing.two },
  composerRatingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerButtons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  bodyInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  smallBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
