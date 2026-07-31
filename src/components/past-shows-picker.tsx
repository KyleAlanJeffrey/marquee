import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances } from '@/lib/attendances-store';
import { formatEventDate } from '@/lib/format';
import { useArtistPastEvents, useFetchArtistHistory } from '@/hooks/queries';

/**
 * "Have you seen them before?" — the way a history gets into somebody's log.
 *
 * The catalogue is built from ticketing feeds, so until an artist's past is fetched it
 * holds only shows that hadn't happened yet. This is the surface that asks for it: it
 * costs nothing until tapped, and the tap is what pays for the one upstream request
 * (`POST /artists/:id/history`). Opening an artist page must stay free, which is why
 * this starts collapsed rather than loading eagerly.
 *
 * Collapsed-by-default is also the honest UI for it. Most people opening an artist page
 * want to know when the next show is; the ones who want to log 2017 are asking a
 * different question and can say so.
 */
export function PastShowsPicker({
  artistId,
  artistName,
  artistImageUrl,
}: {
  artistId: string;
  artistName: string;
  artistImageUrl: string | null;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const past = useArtistPastEvents(artistId, open);
  const history = useFetchArtistHistory(artistId);
  const { wasThere, toggleAttended } = useAttendances();

  /**
   * Ask for the history and reveal the list.
   *
   * The POST fires unconditionally rather than only when the list comes back empty.
   * That avoids a round trip's worth of waiting to decide, and costs nothing: the
   * server keeps a stamp and returns without going upstream on every call after the
   * first. Guarded only against firing twice in one session.
   */
  const reveal = () => {
    setOpen(true);
    if (!history.isPending && !history.isSuccess) history.mutate();
  };

  if (!open) {
    return (
      <View style={styles.section}>
        <PressableScale
          haptic
          accessibilityRole="button"
          accessibilityLabel={`Look up past ${artistName} shows to add to your log`}
          onPress={reveal}
          style={[styles.cta, { borderColor: theme.border }]}>
          <Ionicons name="time-outline" size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">Seen {artistName} before?</ThemedText>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              LOOK THROUGH THEIR PAST SHOWS
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
        </PressableScale>
      </View>
    );
  }

  const shows = past.data ?? [];
  // Only a spinner while there is genuinely nothing to show. Once rows exist, a
  // refetch behind them shouldn't blank out a list somebody is reading.
  const loading = shows.length === 0 && (history.isPending || past.isLoading);

  return (
    <View style={styles.section}>
      <GlassCard style={styles.card}>
        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={theme.primary} />
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              LOOKING UP THEIR PAST SHOWS
            </ThemedText>
          </View>
        ) : shows.length === 0 ? (
          <View style={styles.centre}>
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {/* Two different failures and one real answer, kept apart. Reading the
                  list can fail on its own — the fetch may have worked and the GET
                  still 500 — and reporting that as "no shows on file" would be a
                  wrong answer rather than a missing one. */}
              {past.isError
                ? "Couldn't load their past shows just now."
                : history.isError
                  ? "Couldn't reach the history source just now."
                  : `No past ${artistName} shows on file. Our history goes back to about 2014.`}
            </ThemedText>
            {(history.isError || past.isError) && (
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel="Try looking up past shows again"
                onPress={() => {
                  // Retry whichever half failed — both, when both did. History
                  // first, so a repopulated upstream fetch is what the re-read
                  // then reads.
                  if (history.isError) history.mutate();
                  if (past.isError) past.refetch();
                }}
                style={[styles.retry, { borderColor: theme.border }]}>
                <ThemedText type="labelSm" style={{ color: theme.primary }}>
                  TRY AGAIN
                </ThemedText>
              </PressableScale>
            )}
          </View>
        ) : (
          shows.map((show) => {
            const there = wasThere({ eventId: show.event_id });
            const where = [show.venue_name, show.venue_city].filter(Boolean).join(' · ');
            return (
              // The whole row is the button, deliberately: on web a Pressable renders a
              // <button>, and a row that was pressable *and* held a pressable control
              // would nest two, which React DOM refuses.
              <PressableScale
                key={show.event_id}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: there }}
                accessibilityLabel={`${there ? 'Remove from' : 'Add to'} your log: ${artistName}, ${formatEventDate(
                  show.starts_at,
                  show.venue_timezone,
                )}${where ? `, ${where}` : ''}`}
                onPress={() =>
                  toggleAttended({
                    eventId: show.event_id,
                    name: show.event_name,
                    startsAt: show.starts_at,
                    artistId,
                    artistName,
                    artistImageUrl,
                    venueId: show.venue_id,
                    venueName: show.venue_name,
                    venueCity: show.venue_city,
                    venueTimezone: show.venue_timezone,
                  })
                }
                style={[
                  styles.row,
                  there
                    ? { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }
                    : { borderColor: theme.border },
                ]}>
                <Ionicons
                  name={there ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={there ? theme.primary : theme.textTertiary}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {formatEventDate(show.starts_at, show.venue_timezone)}
                  </ThemedText>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
                    {where || 'VENUE UNKNOWN'}
                  </ThemedText>
                </View>
              </PressableScale>
            );
          })
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.three },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  card: { gap: Spacing.two, padding: Spacing.two + 2 },
  centre: { alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  retry: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
