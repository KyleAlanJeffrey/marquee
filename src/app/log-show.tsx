import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { ArtistArt } from '@/components/artist-art';
import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useArtistPastEvents, useArtistSearch, useFetchArtistHistory } from '@/hooks/queries';
import { apiPut } from '@/lib/api';
import { useAttendances, type NewAttendance } from '@/lib/attendances-store';
import { ensureArtist } from '@/lib/discovery';
import { formatEventDate } from '@/lib/format';
import { dateProblem } from '@/lib/log-dates';
import { useWriteGate } from '@/lib/write-gate';
import type { ArtistPastEvent, ArtistSearchResult } from '@/lib/types';

/**
 * Log a show you went to, the Letterboxd way: one modal, three quick steps —
 * who you saw, which night it was, what you thought of it. The third step is
 * the point of the redesign: adding a past show used to end at a silent
 * checkmark, and the rating never got asked for at the exact moment somebody
 * was thinking about that night.
 *
 * The same modal is every entry point: the Log tab's button opens it at the
 * search step, an artist page's "Seen them before?" opens it at their nights
 * (via `artistId` params), and the shows the catalogue never heard of go
 * through the by-hand branch — same sheet, editable fields.
 */

type PickedArtist = { id: string | null; name: string; imageUrl: string | null };

type Step =
  | { kind: 'who' }
  | { kind: 'which'; artist: PickedArtist & { id: string } }
  // A draft night: a catalogue show (eventId real) or a by-hand one (no id yet).
  | { kind: 'night'; artist: PickedArtist; show: ArtistPastEvent | null };

export default function LogShowScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ artistId?: string; artistName?: string; artistImageUrl?: string }>();
  const [step, setStep] = useState<Step>(() =>
    // An artist page sends its artist along, so the modal opens on their nights.
    params.artistId && params.artistName
      ? {
          kind: 'which',
          artist: { id: params.artistId, name: params.artistName, imageUrl: params.artistImageUrl || null },
        }
      : { kind: 'who' },
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <PageMeta
        title="Log a show"
        description="Add a concert you've been to — find the night, rate it, say what it was like."
      />
      <View style={styles.header}>
        {step.kind === 'night' || (step.kind === 'which' && !params.artistId) ? (
          <PressableScale
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() =>
              setStep(
                step.kind === 'night' && step.artist.id
                  ? { kind: 'which', artist: { ...step.artist, id: step.artist.id } }
                  : { kind: 'who' },
              )
            }
            style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </PressableScale>
        ) : (
          <View style={styles.headerBtn} />
        )}
        <ThemedText type="smallBold" style={{ flex: 1, textAlign: 'center' }}>
          {step.kind === 'who' ? 'WHO DID YOU SEE?' : step.kind === 'which' ? 'WHICH NIGHT?' : 'HOW WAS IT?'}
        </ThemedText>
        <PressableScale
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close without logging"
          onPress={() => router.back()}
          style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={theme.textTertiary} />
        </PressableScale>
      </View>

      {step.kind === 'who' && (
        <FindArtist
          onPick={(artist) => setStep({ kind: 'which', artist })}
          onByHand={(name) => setStep({ kind: 'night', artist: { id: null, name, imageUrl: null }, show: null })}
        />
      )}
      {step.kind === 'which' && (
        <PickNight
          artist={step.artist}
          onPick={(show) => setStep({ kind: 'night', artist: step.artist, show })}
          onByHand={() => setStep({ kind: 'night', artist: step.artist, show: null })}
        />
      )}
      {step.kind === 'night' && <NightSheet artist={step.artist} show={step.show} />}
    </View>
  );
}

/** Step one: find the artist. The by-hand branch keeps whatever was typed. */
function FindArtist({
  onPick,
  onByHand,
}: {
  onPick: (artist: PickedArtist & { id: string }) => void;
  onByHand: (name: string) => void;
}) {
  const theme = useTheme();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [pickFailed, setPickFailed] = useState<string | null>(null);
  const search = useArtistSearch(query);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  // The Spotify hit becomes a stored artist (same resolution the search screen
  // does), because past events and the history fetch are keyed by our id.
  // ensureArtist never throws — it answers null on failure — so the row must
  // say so out loud: a spinner that just stops reads as a dead button.
  async function pick(item: ArtistSearchResult) {
    if (opening) return;
    setOpening(item.spotify_id);
    setPickFailed(null);
    const id = await ensureArtist({
      artistId: null,
      spotifyId: item.spotify_id,
      name: item.name,
      imageUrl: item.image_url,
      genres: item.genres,
    });
    setOpening(null);
    if (id) onPick({ id, name: item.name, imageUrl: item.image_url });
    else setPickFailed(item.name);
  }

  const results = search.data ?? [];

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.searchBar,
          { backgroundColor: theme.inputBg, borderColor: focused ? theme.primary : theme.border },
          focused && Glow.primary,
        ]}>
        <Ionicons name="search" size={18} color={focused ? theme.primary : theme.textTertiary} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Who did you see?"
          placeholderTextColor={theme.textTertiary}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Artist name"
          style={[styles.input, { color: theme.text }]}
        />
        {input.length > 0 && (
          <Ionicons name="close-circle" size={18} color={theme.textTertiary} onPress={() => setInput('')} />
        )}
      </View>

      <FlatList
        data={results}
        keyExtractor={(r) => r.spotify_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          pickFailed ? (
            <ThemedText type="labelSm" style={{ color: theme.error, paddingBottom: Spacing.two }}>
              COULDN&apos;T OPEN {pickFailed.toUpperCase()} JUST NOW — TAP TO TRY AGAIN
            </ThemedText>
          ) : search.isFetching && results.length === 0 ? (
            <ActivityIndicator color={theme.primary} style={{ padding: Spacing.four }} />
          ) : null
        }
        ListFooterComponent={
          // Always reachable, whatever the search says: the school hall gig has
          // no Spotify page. Carrying the typed name saves retyping it.
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel="Add a show by hand instead"
            onPress={() => onByHand(input.trim())}
            style={[styles.byHand, { borderColor: theme.border }]}>
            <Ionicons name="create-outline" size={18} color={theme.cyan} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">
                {input.trim() ? `Add “${input.trim()}” by hand` : 'Not on file? Add it by hand'}
              </ThemedText>
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                FOR SHOWS NO CATALOGUE EVER LISTED
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
          </PressableScale>
        }
        renderItem={({ item }) => (
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel={`Pick ${item.name}`}
            disabled={opening != null}
            onPress={() => pick(item)}
            style={[styles.row, { borderColor: theme.border }]}>
            <ArtistArt uri={item.image_url} style={styles.rowArt} iconSize={16} />
            <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
              {item.name}
            </ThemedText>
            {opening === item.spotify_id ? (
              <ActivityIndicator color={theme.primary} size="small" />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
            )}
          </PressableScale>
        )}
      />
    </View>
  );
}

/** Step two: which of their nights it was. */
function PickNight({
  artist,
  onPick,
  onByHand,
}: {
  artist: PickedArtist & { id: string };
  onPick: (show: ArtistPastEvent) => void;
  onByHand: () => void;
}) {
  const theme = useTheme();
  const { wasThere } = useAttendances();
  const past = useArtistPastEvents(artist.id, true);
  const history = useFetchArtistHistory(artist.id);

  // Fire the one upstream history request as soon as the step opens — this is
  // the wait the old flow made people sit through *after* finding the list.
  // The server stamps and no-ops on repeats, so it's safe to always ask.
  const fetchHistory = history.mutate;
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const shows = past.data ?? [];
  const loading = shows.length === 0 && (history.isPending || past.isLoading);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.artistHead}>
        <ArtistArt uri={artist.imageUrl} style={styles.artistArt} iconSize={18} />
        <ThemedText type="smallBold" style={{ flex: 1 }} numberOfLines={1}>
          {artist.name}
        </ThemedText>
      </View>
      <FlatList
        data={shows}
        keyExtractor={(s) => s.event_id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          loading ? (
            <View style={styles.centre}>
              <ActivityIndicator color={theme.primary} />
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                LOOKING UP THEIR PAST SHOWS
              </ThemedText>
            </View>
          ) : shows.length === 0 ? (
            <View style={styles.centre}>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {past.isError
                  ? "Couldn't load their past shows just now."
                  : history.isError
                    ? "Couldn't reach the history source just now."
                    : `No past ${artist.name} shows on file. Our history goes back to about 2014.`}
              </ThemedText>
            </View>
          ) : null
        }
        ListFooterComponent={
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel="The night you went isn't listed — add it by hand"
            onPress={onByHand}
            style={[styles.byHand, { borderColor: theme.border }]}>
            <Ionicons name="create-outline" size={18} color={theme.cyan} />
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              Your night isn&apos;t listed? Add it by hand
            </ThemedText>
            <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
          </PressableScale>
        }
        renderItem={({ item }) => {
          const there = wasThere({ eventId: item.event_id });
          const where = [item.venue_name, item.venue_city].filter(Boolean).join(' · ');
          return (
            <PressableScale
              haptic
              accessibilityRole="button"
              accessibilityState={{ selected: there }}
              accessibilityLabel={`${formatEventDate(item.starts_at, item.venue_timezone)}${where ? `, ${where}` : ''}${there ? ', already in your log' : ''}`}
              onPress={() => onPick(item)}
              style={[
                styles.row,
                there ? { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill } : { borderColor: theme.border },
              ]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {formatEventDate(item.starts_at, item.venue_timezone)}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
                  {where || 'VENUE UNKNOWN'}
                </ThemedText>
              </View>
              {there && (
                <ThemedText type="labelSm" style={{ color: theme.primary }}>
                  IN YOUR LOG
                </ThemedText>
              )}
              <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
            </PressableScale>
          );
        }}
      />
    </View>
  );
}

/**
 * Step three, and the reason this flow exists: the night is chosen, so ask
 * what it was like *now*, while they're thinking about it. Saving writes the
 * log entry, rating and text in one motion.
 *
 * One text field, owned by the toggle: off, it's the private log note; on, it
 * posts as the public review instead. Never both — the log's note deliberately
 * never crosses into public view without this explicit choice (docs/social.md).
 */
function NightSheet({ artist, show }: { artist: PickedArtist; show: ArtistPastEvent | null }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const { rate, attendanceFor } = useAttendances();

  const existing = show ? attendanceFor({ eventId: show.event_id }) : null;
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [text, setText] = useState(existing?.note ?? '');
  const [publicReview, setPublicReview] = useState(false);
  // Editable on the by-hand path: the branch can be reached with nothing typed,
  // and a required field you can't edit is a dead end.
  const [artistName, setArtistName] = useState(artist.name);
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const manual = show == null;
  const where = show ? [show.venue_name, show.venue_city].filter(Boolean).join(' · ') : '';

  const save = async () => {
    // Hold the write rather than decide it while the session is still loading —
    // see WriteGate.pending. Refusing it signed-out routes through sign-in.
    if (gate.pending) return;
    if (!gate.allowed) {
      gate.deny("log the shows you've been to");
      return;
    }

    let entry: NewAttendance;
    if (manual) {
      if (!artistName.trim()) {
        setProblem('Who did you see? The artist is the one required field.');
        return;
      }
      const dateErr = dateProblem(date.trim());
      if (dateErr) {
        setProblem(dateErr);
        return;
      }
      entry = {
        // A manual id: never resolves against the catalogue, never collides
        // with one, and survives forever in the snapshot like any log entry.
        eventId: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: artistName.trim(),
        // Noon, pinned to UTC below — the pair renders as the entered calendar
        // date in every reader's zone, including UTC+13, where a bare noon-UTC
        // instant read off the device clock would already be tomorrow.
        startsAt: `${date.trim()}T12:00:00Z`,
        artistId: artist.id,
        artistName: artistName.trim(),
        artistImageUrl: artist.imageUrl,
        venueId: null,
        venueName: venue.trim() || null,
        venueCity: city.trim() || null,
        venueTimezone: 'UTC',
      };
    } else {
      entry = {
        eventId: show.event_id,
        name: show.event_name,
        startsAt: show.starts_at,
        artistId: artist.id,
        artistName: artist.name,
        artistImageUrl: artist.imageUrl,
        venueId: show.venue_id,
        venueName: show.venue_name,
        venueCity: show.venue_city,
        venueTimezone: show.venue_timezone,
      };
    }

    const body = text.trim() || null;
    setSaving(true);
    // The private half always saves — with the text as the note unless it's
    // been claimed by the public review.
    rate(entry, { rating, note: publicReview ? (existing?.note ?? null) : body });

    if (!manual && publicReview && (rating != null || body)) {
      try {
        await apiPut(`/events/${encodeURIComponent(entry.eventId)}/review`, {
          rating,
          venueRating: null,
          body,
        });
      } catch (err) {
        console.warn('review post failed:', err);
        // The words must survive the failure: keep them as the private note,
        // so closing the modal now loses nothing.
        if (body) rate(entry, { note: body });
        setSaving(false);
        setProblem(
          'Logged, and your words are saved as a private note — posting the review failed. Try again, or post from the show page.',
        );
        return;
      }
    }
    router.back();
  };

  return (
    <ScrollView
      contentContainerStyle={styles.sheet}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <GlassCard style={styles.summary}>
        <ArtistArt uri={artist.imageUrl} style={styles.summaryArt} iconSize={22} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {show ? show.event_name : artistName.trim() || 'Your show'}
          </ThemedText>
          {show ? (
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
              {formatEventDate(show.starts_at, show.venue_timezone)}
              {where ? ` · ${where}` : ''}
            </ThemedText>
          ) : (
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              ADDED BY HAND · PRIVATE TO YOUR LOG
            </ThemedText>
          )}
        </View>
      </GlassCard>

      {manual && (
        <GlassCard style={styles.fields}>
          <TextInput
            value={artistName}
            onChangeText={setArtistName}
            placeholder="Who did you see? (required)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="Artist name"
            maxLength={200}
            style={[styles.field, { color: theme.text, borderColor: theme.border }]}
          />
          <TextInput
            value={venue}
            onChangeText={setVenue}
            placeholder="Where? (optional)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="Venue name"
            maxLength={200}
            style={[styles.field, { color: theme.text, borderColor: theme.border }]}
          />
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Which town? (optional)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="City"
            maxLength={200}
            style={[styles.field, { color: theme.text, borderColor: theme.border }]}
          />
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="When? YYYY-MM-DD (required)"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="Date of the show"
            maxLength={10}
            style={[styles.field, { color: theme.text, borderColor: theme.border }]}
          />
        </GlassCard>
      )}

      <View style={styles.stars}>
        <StarRating
          size={34}
          value={rating}
          subject={artistName.trim() || 'this show'}
          placeholder="TAP TO RATE"
          onChange={setRating}
        />
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={publicReview ? 'Say it for everyone — this posts publicly.' : 'What was it like? Private to your log.'}
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel={publicReview ? 'Your public review' : 'Your private note'}
        multiline
        maxLength={4000}
        style={[styles.note, { color: theme.text, borderColor: theme.border, backgroundColor: theme.inputBg }]}
      />

      {!manual && (
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">Post as a public review</ThemedText>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              {publicReview ? 'RATING + TEXT GO ON THE SHOW PAGE' : 'OFF — EVERYTHING STAYS PRIVATE'}
            </ThemedText>
          </View>
          <Switch
            value={publicReview}
            onValueChange={setPublicReview}
            accessibilityLabel="Post as a public review"
            trackColor={{ true: theme.primaryFill, false: theme.border }}
            thumbColor={publicReview ? theme.primary : theme.textTertiary}
          />
        </View>
      )}

      {problem && (
        <ThemedText type="labelSm" style={{ color: theme.error }}>
          {problem.toUpperCase()}
        </ThemedText>
      )}

      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel={existing ? 'Save the changes to this show' : 'Add this show to your log'}
        disabled={saving}
        onPress={save}
        style={[styles.saveBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
        {saving ? (
          <ActivityIndicator color={theme.primary} size="small" />
        ) : (
          <ThemedText type="smallBold" style={{ color: theme.primary }}>
            {existing ? 'SAVE CHANGES' : 'ADD TO LOG'}
          </ThemedText>
        )}
      </PressableScale>

      <ThemedText type="labelSm" style={{ color: theme.textTertiary, textAlign: 'center' }}>
        {manual
          ? 'PRIVATE TO YOUR LOG · RATEABLE LIKE ANY OTHER NIGHT'
          : 'YOUR LOG IS PRIVATE · ONLY THE REVIEW TOGGLE PUBLISHES ANYTHING'}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 46,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, height: '100%' },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  rowArt: { width: 36, height: 36, borderRadius: Radius.sm },
  byHand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: Spacing.two,
  },
  artistHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  artistArt: { width: 40, height: 40, borderRadius: Radius.sm },
  centre: { alignItems: 'center', gap: Spacing.two, padding: Spacing.four },
  sheet: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  summaryArt: { width: 52, height: 52, borderRadius: Radius.sm },
  fields: { gap: Spacing.two, padding: Spacing.three },
  field: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  stars: { alignItems: 'center', paddingVertical: Spacing.one },
  note: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    minHeight: 110,
    textAlignVertical: 'top',
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
