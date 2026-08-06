import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

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
import { formatEventDate, formatEventDateParts } from '@/lib/format';

/** The year a show happened, for the rules between them. */
const yearOf = (iso: string) => iso.slice(0, 4);

/** Tiles per wall row. Chunked by hand: FlatList numColumns can't mix in
    full-width year rules, and flexGrow in a wrapped row stretches the last
    orphan tile poster-wide. */
const WALL_COLUMNS = 3;

const chunk = <T,>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** One FlatList row, in either view: a year rule, a list entry, or a wall row. */
type Row =
  | { kind: 'year'; year: string }
  | { kind: 'show'; show: Attendance }
  | { kind: 'tiles'; key: string; shows: Attendance[] };

/**
 * Everything you've been to, newest night first — as a wall of posters.
 *
 * The wall is the point (a year of gigs as a grid of artist images is the
 * screenshot people share), but it is deliberately look-only: rating in
 * place and removing live in the list view behind the toggle, because a
 * tile is too small to carry five stars, a remove pill and a navigation
 * target without mis-taps. The log itself is unchanged and private.
 */
export default function LogScreen() {
  const theme = useTheme();
  const { attended, ready, unlog, rate } = useAttendances();
  const [view, setView] = useState<'wall' | 'list'>('wall');

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
    const out: Row[] = [];
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

  /** The same log for the wall: year rules, then rows of up to three tiles. */
  const wallRows = useMemo(() => {
    const out: Row[] = [];
    let year = '';
    let current: Attendance[] = [];
    const flush = () => {
      for (const shows of chunk(current, WALL_COLUMNS)) {
        out.push({ kind: 'tiles', key: `${year}-${shows[0].eventId}`, shows });
      }
      current = [];
    };
    for (const show of attended) {
      const y = yearOf(show.startsAt);
      if (y !== year) {
        flush();
        year = y;
        out.push({ kind: 'year', year: y });
      }
      current.push(show);
    }
    flush();
    return out;
  }, [attended]);

  const rated = attended.filter((a) => a.rating != null);
  // Only over the shows actually scored — averaging in the unrated ones as zero
  // would make a log of mostly-unrated nights look like a log of terrible ones.
  const average = rated.length
    ? (rated.reduce((sum, a) => sum + (a.rating ?? 0), 0) / rated.length).toFixed(1)
    : null;
  // The stats line, Letterboxd-shaped: how much, how recently, how widely.
  // Lazy initializer for the same reason as the event page's useNow: reading
  // the clock in the component body is impure, and once per mount is enough.
  const [currentYear] = useState(() => String(new Date().getFullYear()));
  const thisYear = attended.filter((a) => yearOf(a.startsAt) === currentYear).length;
  const venueCount = new Set(
    attended.map((a) => a.venueId ?? a.venueName).filter((v): v is string => !!v),
  ).size;

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Your concert log"
        description="Every show you've been to, and what you thought of it. Private to your account."
      />
      <StageBackground />
      {/* A pushed screen since Activity took the tab slot, so it needs the
          way back it never used to. */}
      <TopBar back onSearchPress={() => router.push('/search')} />

      {!ready ? (
        // The disk read hasn't landed. "You haven't been to anything" would be a
        // lie flashing over somebody's history on every cold start.
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : attended.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="No shows logged yet"
          message="Log the concerts you've been to — find the night, rate it, say what it was like. Your log is private to your account."
          actionLabel="Log your first show"
          onAction={() => router.push('/log-show')}
        />
      ) : (
        <FlatList
          data={view === 'wall' ? wallRows : rows}
          keyExtractor={(r) =>
            r.kind === 'year' ? `y-${r.year}` : r.kind === 'tiles' ? r.key : r.show.eventId
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.head}>
              <View style={styles.headTop}>
                <ThemedText type="headline" style={{ flex: 1 }}>
                  Your Log
                </ThemedText>
                {/* The wall is for looking; the list is for tending — inline
                    stars and the remove pill live there. */}
                {(['wall', 'list'] as const).map((mode) => (
                  <PressableScale
                    key={mode}
                    haptic
                    accessibilityRole="button"
                    accessibilityState={{ selected: view === mode }}
                    accessibilityLabel={mode === 'wall' ? 'Show the log as a wall of posters' : 'Show the log as a list'}
                    onPress={() => setView(mode)}
                    style={[
                      styles.viewBtn,
                      { borderColor: view === mode ? theme.primaryEdge : theme.border },
                      view === mode && { backgroundColor: theme.primaryFill },
                    ]}>
                    <Ionicons
                      name={mode === 'wall' ? 'grid-outline' : 'list-outline'}
                      size={16}
                      color={view === mode ? theme.primary : theme.textTertiary}
                    />
                  </PressableScale>
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {attended.length} {attended.length === 1 ? 'show' : 'shows'}
                {thisYear ? ` · ${thisYear} this year` : ''}
                {venueCount > 1 ? ` · ${venueCount} venues` : ''}
                {average ? ` · ${average} average` : ''}
                {' · private to you'}
              </ThemedText>
              {/* The one way in: search the artist, pick the night, rate it —
                  the by-hand path lives inside the same flow. */}
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel="Log a show you went to"
                onPress={() => router.push('/log-show')}
                style={[styles.logBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
                <Ionicons name="add" size={18} color={theme.primary} />
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                  LOG A SHOW
                </ThemedText>
              </PressableScale>
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
            if (item.kind === 'tiles') {
              return (
                <Animated.View
                  entering={FadeInDown.delay(Math.min(index * 35, 300)).duration(340)}
                  style={styles.tileRow}>
                  {item.shows.map((show) => {
                    const parts = formatEventDateParts(show.startsAt, show.venueTimezone);
                    const name = show.artistName ?? show.name;
                    return (
                      <PressableScale
                        key={show.eventId}
                        haptic={false}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${name}, ${formatEventDate(show.startsAt, show.venueTimezone)}${
                          show.rating != null ? `, rated ${show.rating} of 5` : ''
                        }`}
                        disabled={show.eventId.startsWith('manual-')}
                        onPress={() => router.push(`/event/${show.eventId}`)}
                        style={styles.tile}>
                        <View style={[styles.tileArt, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                          {show.artistImageUrl ? (
                            <Image
                              source={{ uri: show.artistImageUrl }}
                              style={StyleSheet.absoluteFill}
                              contentFit="cover"
                              transition={200}
                            />
                          ) : (
                            <View style={styles.tileFallback}>
                              <Ionicons name="musical-notes" size={26} color={theme.textTertiary} />
                            </View>
                          )}
                          <LinearGradient
                            colors={['transparent', 'rgba(0,0,0,0.78)']}
                            style={styles.tileFade}
                            pointerEvents="none"
                          />
                          <ThemedText type="labelSm" style={styles.tileDate}>
                            {parts.month} {parts.day}
                          </ThemedText>
                        </View>
                        <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textSecondary }}>
                          {name}
                        </ThemedText>
                        {show.rating != null && (
                          <StarRating value={show.rating} size={10} subject={name} />
                        )}
                      </PressableScale>
                    );
                  })}
                  {/* Fillers keep a short last row from stretching its tiles. */}
                  {Array.from({ length: WALL_COLUMNS - item.shows.length }, (_, i) => (
                    <View key={`fill-${i}`} style={styles.tile} />
                  ))}
                </Animated.View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: 2 },
  headTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  viewBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two + 2,
  },
  tile: { flex: 1, gap: 4 },
  tileArt: {
    aspectRatio: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  tileFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  tileDate: { color: '#fff', padding: Spacing.one + 2, letterSpacing: 1 },
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
