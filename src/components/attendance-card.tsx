import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances, type NewAttendance } from '@/lib/attendances-store';

type Props = {
  /** The show, as it would be stored. */
  show: NewAttendance;
  /** The room's name, for the second rating's label. Null when we can't name it. */
  venueName?: string | null;
};

/**
 * "Were you there?" — the whole of reviews phase 0, on one card.
 *
 * Deliberately not a review form. Nothing here is published — the log is private
 * to the account — and the point of the phase is to find out whether people log
 * shows at all before public reviews are built. So the ask is one tap, the
 * ratings are optional, and nothing is ever required.
 *
 * Only rendered for shows that have already started — see `hasHappened` at the
 * call site. Logging attendance at a gig that hasn't happened is either a mistake
 * or a lie, and the same rule holds later for reviews.
 */
export function AttendanceCard({ show, venueName }: Props) {
  const theme = useTheme();
  const { wasThere, attendanceFor, toggleAttended, rate } = useAttendances();
  const ref = { eventId: show.eventId };
  const logged = wasThere(ref);
  const entry = attendanceFor(ref);

  const toggle = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleAttended(show);
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
});
