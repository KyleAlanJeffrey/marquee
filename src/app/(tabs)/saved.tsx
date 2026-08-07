import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { SecondaryEventCard } from '@/components/secondary-event-card';
import { Segmented } from '@/components/segmented';
import { ShowLog } from '@/components/show-log';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances } from '@/lib/attendances-store';
import { useAuth } from '@/lib/auth';
import { usePersonLists } from '@/lib/curated';
import { EVENTS_BY_IDS_MAX, useSavedShowDetails } from '@/hooks/queries';
import { useMyRsvps, type MyRsvp } from '@/lib/reviews';
import { useSavedShows, type SavedShow } from '@/lib/saved-shows-store';
import type { NearbyEvent } from '@/lib/types';

/**
 * My Shows — every show that is yours, on both sides of tonight.
 *
 * UPCOMING is what you've marked: going, interested, saved for later, and
 * your lists. Each is set somewhere else (the event page's "Your plans" card,
 * the add-to-list button); this is where they land. BEEN is the private log —
 * the wall of posters — which used to be its own tab and belongs here
 * instead: "shows I'm going to" and "shows I went to" are the same question
 * asked in two tenses, and splitting them across tabs made the log easy to
 * lose (Kyle, 2026-08-07: "it's nice to see all the shows I've seen").
 *
 * Grew out of the Saved tab, whose machinery it keeps: the saved section still
 * renders instantly from stored snapshots and replaces them with revalidated
 * rows, because a saved show is exactly the case where a stale door time costs
 * somebody their evening.
 */

/**
 * Render a stored snapshot as a feed row, so a saved show looks the same whether
 * it came off the disk or off the server. The fields a snapshot never had (genre,
 * coordinates, distance) are absent rather than guessed.
 */
function snapshotAsEvent(s: SavedShow): NearbyEvent {
  return {
    event_id: s.eventId,
    event_name: s.name,
    starts_at: s.startsAt,
    // Snapshots from before the flag existed don't carry it; defaulting those
    // to "time known" keeps every legacy save's door time visible, and the
    // revalidated row corrects the rare one that was actually TBD.
    time_unknown: s.timeUnknown ?? false,
    ticket_url: null,
    price_from: s.priceFrom,
    artist_id: s.artistId ?? '',
    artist_name: s.artistName ?? s.name,
    artist_image_url: s.artistImageUrl,
    artist_spotify_id: null,
    artist_genres: [],
    venue_id: s.venueId,
    venue_name: s.venueName,
    venue_city: s.venueCity,
    venue_region: null,
    venue_timezone: s.venueTimezone,
    venue_lat: null,
    venue_lng: null,
    distance_miles: null,
  };
}

export default function MyShowsScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const { saved, unsave, isSaved, ready } = useSavedShows();
  const rsvps = useMyRsvps(!!userId);
  const shelves = usePersonLists(userId ?? '', !!userId);
  const { attended } = useAttendances();
  const [refreshing, setRefreshing] = useState(false);
  // `?view=been` so the Profile card and any /log link can open the wall
  // directly; without it the tab keeps whichever tense you last looked at.
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const [tense, setTense] = useState<'upcoming' | 'been'>(viewParam === 'been' ? 'been' : 'upcoming');
  // Initial state isn't enough: this screen lives in the tab navigator and
  // stays mounted, so a later `?view=been` arrives as a param change on a
  // component that has already chosen — and the link would silently do
  // nothing. React's adjust-during-render pattern rather than an effect
  // (which would render the wrong tense first, then correct it); tracking the
  // last param means a hand-flipped tense sticks until the link changes again.
  const [lastParam, setLastParam] = useState(viewParam);
  if (viewParam !== lastParam) {
    setLastParam(viewParam);
    if (viewParam === 'been') setTense('been');
    else if (viewParam === 'upcoming') setTense('upcoming');
  }

  // Soonest first before the cap, so the shows that get live prices and door times
  // are the ones about to happen rather than whichever ids sort first.
  const ids = useMemo(
    () =>
      [...saved]
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((s) => s.eventId)
        .slice(0, EVENTS_BY_IDS_MAX),
    [saved],
  );
  const details = useSavedShowDetails(ids);

  // Snapshots carry the list until the server answers, then the server's rows
  // replace them wholesale: it returns exactly the saved shows that are still to
  // come, in date order, so nothing here has to guess what time it is.
  const { upcoming, gone } = useMemo(() => {
    const snapshots = [...saved]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(snapshotAsEvent);
    if (!details.isSuccess) return { upcoming: snapshots, gone: [] as NearbyEvent[] };
    // The response is kept across an unsave (so the list doesn't blink), which means
    // it can still hold a show that is no longer saved.
    const live = details.data.filter((e) => isSaved({ eventId: e.event_id }));
    const found = new Set(live.map((e) => e.event_id));
    return { upcoming: live, gone: snapshots.filter((e) => !found.has(e.event_id)) };
  }, [saved, details.data, details.isSuccess, isSaved]);

  const going = useMemo(() => (rsvps.data?.items ?? []).filter((e) => e.rsvp_status === 'going'), [rsvps.data]);
  const interested = useMemo(
    () => (rsvps.data?.items ?? []).filter((e) => e.rsvp_status === 'interested'),
    [rsvps.data],
  );
  const lists = shelves.data?.lists ?? [];

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([details.refetch(), rsvps.refetch(), shelves.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const removeButton = (eventId: string, name: string) => (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={`Remove ${name} from saved`}
      onPress={() => unsave({ eventId })}
      style={[styles.remove, { borderColor: theme.border }]}>
      <Ionicons name="bookmark" size={16} color={theme.cyan} />
    </PressableScale>
  );

  const sectionLabel = (label: string) => (
    <ThemedText type="label" style={[styles.sectionLabel, { color: theme.textTertiary }]}>
      {label}
    </ThemedText>
  );

  const rsvpRows = (items: MyRsvp[], icon: keyof typeof Ionicons.glyphMap) =>
    items.map((e) => (
      <SecondaryEventCard
        key={e.event_id}
        event={e}
        following={false}
        onPress={() => router.push(`/event/${e.event_id}`)}
        action={
          <View style={[styles.statusBadge, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
            <Ionicons name={icon} size={16} color={theme.primary} />
          </View>
        }
      />
    ));

  const nothingAnywhere =
    saved.length === 0 && going.length === 0 && interested.length === 0 && lists.length === 0;

  /** The title and tense switch, shared by both views so it never jumps. */
  const heading = (
    <View style={styles.tenseHead}>
      <ThemedText type="headline">My Shows</ThemedText>
      <Segmented
        label="Which shows"
        options={[
          { value: 'upcoming', label: 'Upcoming', count: going.length + interested.length + saved.length },
          { value: 'been', label: 'Been', count: attended.length },
        ]}
        value={tense}
        onChange={setTense}
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="My shows"
        description="Everything you've marked on Marquee — going, interested, saved for later, your lists, and the shows you've been to."
      />
      <StageBackground />
      <TopBar onSearchPress={() => router.push('/search')} />

      {tense === 'been' ? (
        // ShowLog owns its own list (the wall runs to hundreds of tiles), so
        // it replaces this screen's list rather than nesting inside it.
        <ShowLog header={heading} />
      ) : !ready ? (
        // The disk read hasn't landed; "nothing here" would be a lie that
        // flashes over a full list every cold start.
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : nothingAnywhere ? (
        <>
          {heading}
          <EmptyState
            icon="bookmark-outline"
            title="Nothing coming up"
            message="Going, interested, saved and your lists all land here. Open a show and make a plan — or switch to Been for the shows you've already seen."
            actionLabel="Find shows"
            onAction={() => router.push('/explore')}
          />
        </>
      ) : (
        <FlatList
          data={upcoming}
          keyExtractor={(e) => e.event_id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListHeaderComponent={
            <View>
              {heading}
              <View style={styles.head}>
                <View style={styles.subRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {[
                      going.length ? `${going.length} going` : null,
                      interested.length ? `${interested.length} interested` : null,
                      saved.length ? `${saved.length} saved` : null,
                      lists.length ? `${lists.length} ${lists.length === 1 ? 'list' : 'lists'}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Plans land here'}
                    {/* Say it rather than quietly showing stale times for the rest. */}
                    {saved.length > ids.length ? ` · live times for the first ${ids.length}` : ''}
                  </ThemedText>
                  {(details.isFetching || rsvps.isFetching || shelves.isFetching) && !refreshing ? (
                    <ActivityIndicator size="small" color={theme.textTertiary} />
                  ) : null}
                </View>
                {/* A failed refresh doesn't hide anything — what's below is
                    still the user's. It just says so, and offers another go. */}
                {(details.isError || rsvps.isError || shelves.isError) &&
                !details.isFetching &&
                !rsvps.isFetching &&
                !shelves.isFetching ? (
                  <View style={styles.errorRow}>
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary, flex: 1 }}>
                      COULDN&rsquo;T CHECK FOR CHANGES &mdash; SHOWING WHAT&rsquo;S KNOWN
                    </ThemedText>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel="Try refreshing again"
                      onPress={onRefresh}>
                      <ThemedText type="labelSm" style={{ color: theme.primary }}>
                        TRY AGAIN
                      </ThemedText>
                    </PressableScale>
                  </View>
                ) : null}
              </View>

              {going.length > 0 && (
                <View>
                  {sectionLabel('GOING')}
                  {rsvpRows(going, 'checkmark-circle')}
                </View>
              )}
              {interested.length > 0 && (
                <View>
                  {sectionLabel('INTERESTED')}
                  {rsvpRows(interested, 'sparkles')}
                </View>
              )}

              {lists.length > 0 && (
                <View>
                  {sectionLabel('YOUR LISTS')}
                  <View style={styles.shelfRow}>
                    {lists.map((l) => (
                      <PressableScale
                        key={l.id}
                        haptic={false}
                        accessibilityRole="button"
                        accessibilityLabel={`Open your list ${l.title}`}
                        onPress={() => router.push(`/list/${l.id}`)}
                        style={[styles.shelfChip, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
                        <Ionicons name="albums-outline" size={14} color={theme.cyan} />
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.shelfTitle}>
                          {l.title}
                        </ThemedText>
                        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                          {String(l.itemCount)}
                        </ThemedText>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              )}

              {(saved.length > 0 || upcoming.length > 0) && sectionLabel('SAVED FOR LATER')}
            </View>
          }
          ListEmptyComponent={
            saved.length > 0 ? (
              <EmptyState
                icon="calendar-outline"
                title="Nothing coming up"
                message="Nothing you saved is still to come. The list below remembers them anyway."
              />
            ) : null
          }
          ListFooterComponent={
            gone.length > 0 ? (
              <View>
                {sectionLabel('PAST OR NO LONGER LISTED')}
                {gone.map((e) => (
                  <View key={e.event_id} style={styles.dim}>
                    <SecondaryEventCard
                      event={e}
                      following={false}
                      onPress={() => router.push(`/event/${e.event_id}`)}
                      action={removeButton(e.event_id, e.artist_name)}
                    />
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index * 45, 300)).duration(340)}>
              <SecondaryEventCard
                event={item}
                following={false}
                onPress={() => router.push(`/event/${item.event_id}`)}
                action={removeButton(item.event_id, item.artist_name)}
              />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  content: { paddingBottom: Spacing.six + Spacing.four },
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: 2 },
  tenseHead: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionLabel: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two, letterSpacing: 1.5 },
  shelfRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  shelfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  shelfTitle: { maxWidth: 180 },
  statusBadge: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A show that has passed or been pulled is still yours to look at, just not news.
  dim: { opacity: 0.55 },
  remove: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
