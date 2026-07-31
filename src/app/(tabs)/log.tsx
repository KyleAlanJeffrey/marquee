import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AddShowForm } from '@/components/add-show-form';
import { EmptyState } from '@/components/empty-state';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances, type Attendance } from '@/lib/attendances-store';
import { formatEventDate } from '@/lib/format';

/** The year a show happened, for the rules between them. */
const yearOf = (iso: string) => iso.slice(0, 4);

/**
 * Everything you've been to, newest night first.
 *
 * Phase 0 of the reviews pivot, and it is on the device only — nothing here has
 * been published, because there is nothing yet to publish to. The screen is
 * therefore a personal history rather than a profile, and it is written to read
 * like one: years as rules, a count, and the two scores if they were given.
 */
export default function LogScreen() {
  const theme = useTheme();
  const { attended, ready, unlog, rate } = useAttendances();

  /**
   * Which row's remove button is armed, if any.
   *
   * Removing is destructive and there is no undo — the rating goes with it — so
   * it takes two taps. Not `Alert.alert`: react-native-web ships that as
   * `static alert() {}`, so a confirm dialog would silently do nothing on the
   * web build and the button would appear broken. `open-url.ts` already branches
   * around the same hole. Arming in place works everywhere and shows the
   * consequence rather than describing it.
   */
  const [armed, setArmed] = useState<string | null>(null);

  /** Rows with a year header inserted wherever the year changes. */
  const rows = useMemo(() => {
    const out: ({ kind: 'year'; year: string } | { kind: 'show'; show: Attendance })[] = [];
    let year = '';
    for (const show of attended) {
      const y = yearOf(show.startsAt);
      if (y !== year) {
        year = y;
        out.push({ kind: 'year', year: y });
      }
      out.push({ kind: 'show', show });
    }
    return out;
  }, [attended]);

  const rated = attended.filter((a) => a.rating != null);
  // Only over the shows actually scored — averaging in the unrated ones as zero
  // would make a log of mostly-unrated nights look like a log of terrible ones.
  const average = rated.length
    ? (rated.reduce((sum, a) => sum + (a.rating ?? 0), 0) / rated.length).toFixed(1)
    : null;

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Your concert log"
        description="Every show you've been to, and what you thought of it. Private to your account."
      />
      <StageBackground />
      <TopBar onSearchPress={() => router.push('/search')} />

      {!ready ? (
        // The disk read hasn't landed. "You haven't been to anything" would be a
        // lie flashing over somebody's history on every cold start.
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : attended.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="checkmark-done-outline"
            title="No shows logged yet"
            message="Open a gig you went to and tap “Were you there?”. Your log is private to your account — nobody else can see it."
            actionLabel="Find shows"
            onAction={() => router.push('/explore')}
          />
          {/* The other way in: a show the catalogue never listed. */}
          <View style={styles.addForm}>
            <AddShowForm />
          </View>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => (r.kind === 'year' ? `y-${r.year}` : r.show.eventId)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.head}>
              <ThemedText type="headline">Your Log</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {attended.length} {attended.length === 1 ? 'show' : 'shows'}
                {average ? ` · ${average} average` : ''}
                {' · private to you'}
              </ThemedText>
              <AddShowForm />
            </View>
          }
          renderItem={({ item, index }) => {
            if (item.kind === 'year') {
              return (
                <ThemedText type="label" style={[styles.year, { color: theme.textTertiary }]}>
                  {item.year}
                </ThemedText>
              );
            }
            const show = item.show;
            const where = [show.venueName, show.venueCity].filter(Boolean).join(' · ');
            const isArmed = armed === show.eventId;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index * 35, 300)).duration(340)}>
                <View style={[styles.row, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                  {/* Siblings, not nested: both are buttons, and a button inside a
                      button is invalid HTML that React DOM refuses to render on
                      web. The row therefore has a pressable *title*, not a
                      pressable card. */}
                  <View style={styles.rowHead}>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${show.artistName ?? show.name}`}
                      // A hand-added show has no event page to open — its id is
                      // `manual-…` and resolves to nothing. The row stays; only
                      // the navigation goes.
                      disabled={show.eventId.startsWith('manual-')}
                      onPress={() => {
                        // Leaving with a row still armed would mean one tap
                        // deletes it on the way back in.
                        setArmed(null);
                        router.push(`/event/${show.eventId}`);
                      }}
                      style={styles.rowTitle}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {show.artistName ?? show.name}
                      </ThemedText>
                      <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
                        {formatEventDate(show.startsAt, show.venueTimezone)}
                        {where ? ` · ${where}` : ''}
                      </ThemedText>
                    </PressableScale>
                    <PressableScale
                      haptic
                      accessibilityRole="button"
                      accessibilityLabel={
                        isArmed
                          ? `Confirm removing ${show.artistName ?? show.name} from your log`
                          : `Remove ${show.artistName ?? show.name} from your log`
                      }
                      onPress={() => {
                        if (isArmed) {
                          unlog({ eventId: show.eventId });
                          setArmed(null);
                        } else {
                          setArmed(show.eventId);
                        }
                      }}
                      style={[
                        styles.remove,
                        isArmed
                          ? { borderColor: theme.error, backgroundColor: theme.error, paddingHorizontal: Spacing.two }
                          : { borderColor: theme.border },
                      ]}>
                      {isArmed ? (
                        <ThemedText type="labelSm" style={{ color: theme.background }}>
                          REMOVE
                        </ThemedText>
                      ) : (
                        <Ionicons name="close" size={15} color={theme.textTertiary} />
                      )}
                    </PressableScale>
                  </View>
                  {/* Rateable in place: the whole reason to reopen the log is to
                      finally put a number on something, and making that a trip
                      through the event page is how it never happens. */}
                  <StarRating
                    size={20}
                    value={show.rating}
                    subject={show.artistName ?? show.name}
                    placeholder="TAP TO RATE"
                    onChange={(rating) =>
                      rate(
                        {
                          eventId: show.eventId,
                          name: show.name,
                          startsAt: show.startsAt,
                          artistId: show.artistId,
                          artistName: show.artistName,
                          artistImageUrl: show.artistImageUrl,
                          venueId: show.venueId,
                          venueName: show.venueName,
                          venueCity: show.venueCity,
                          venueTimezone: show.venueTimezone,
                        },
                        { rating },
                      )
                    }
                  />
                </View>
              </Animated.View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  addForm: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: 2 },
  year: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    letterSpacing: 2,
  },
  row: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.two,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowTitle: { flex: 1 },
  // minWidth rather than width: armed, it holds the word REMOVE instead of a
  // glyph, and the pill has to grow to fit it.
  remove: {
    minWidth: 30,
    height: 30,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
