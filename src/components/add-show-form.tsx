import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances } from '@/lib/attendances-store';

/**
 * Add a show the catalogue never heard of.
 *
 * The backfill covers roughly 2014 onward for artists Bandsintown knows; this
 * is the rest — the warehouse gig, the school hall, the band that never had a
 * listing anywhere. It writes a plain log entry with a `manual-` id and no
 * catalogue references at all, which works because the log renders purely from
 * its own snapshot and never asks the server about its rows.
 *
 * Private by design, not just by default: a manual entry never becomes a
 * shared event other people can log against — that promotion is an open
 * product decision (docs/social.md) with a moderation bill attached, and
 * nothing here forecloses it. Reviews stay impossible on these entries for the
 * same reason: a review needs a real event row.
 */

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A past calendar date, or the reason it isn't. */
function dateProblem(raw: string): string | null {
  if (!DATE_SHAPE.test(raw)) return 'Date reads as YYYY-MM-DD, like 2019-07-21.';
  const t = Date.parse(`${raw}T12:00:00Z`);
  if (Number.isNaN(t)) return "That date doesn't exist.";
  if (t > Date.now()) return 'The log is for shows that already happened.';
  return null;
}

export function AddShowForm() {
  const theme = useTheme();
  const { log } = useAttendances();
  const [open, setOpen] = useState(false);
  const [artist, setArtist] = useState('');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const name = artist.trim();
    if (!name) {
      setProblem('Who did you see? The artist is the one required field.');
      return;
    }
    const dateErr = dateProblem(date.trim());
    if (dateErr) {
      setProblem(dateErr);
      return;
    }
    log({
      // A manual id: never resolves against the catalogue, never collides with
      // one, and survives forever in the snapshot like every other log entry.
      eventId: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      // Noon UTC: the log shows the date, and noon keeps it on the right
      // calendar day in every timezone anyone actually lives in.
      startsAt: `${date.trim()}T12:00:00Z`,
      artistId: null,
      artistName: name,
      artistImageUrl: null,
      venueId: null,
      venueName: venue.trim() || null,
      venueCity: city.trim() || null,
      venueTimezone: null,
    });
    setArtist('');
    setVenue('');
    setCity('');
    setDate('');
    setProblem(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel="Add a show that isn't in the catalogue"
        onPress={() => setOpen(true)}
        style={[styles.cta, { borderColor: theme.border }]}>
        <Ionicons name="add-circle-outline" size={18} color={theme.cyan} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Went to something we don&apos;t list?</ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            ADD IT TO YOUR LOG BY HAND
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
      </PressableScale>
    );
  }

  const field = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    label: string,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.textTertiary}
      accessibilityLabel={label}
      maxLength={200}
      style={[styles.input, { color: theme.text, borderColor: theme.border }]}
    />
  );

  return (
    <GlassCard style={styles.card}>
      <ThemedText type="smallBold">Add a show by hand</ThemedText>
      {field(artist, setArtist, 'Who did you see? (required)', 'Artist name')}
      {field(venue, setVenue, 'Where? (optional)', 'Venue name')}
      {field(city, setCity, 'Which town? (optional)', 'City')}
      {field(date, setDate, 'When? YYYY-MM-DD (required)', 'Date of the show')}
      {problem && (
        <ThemedText type="labelSm" style={{ color: theme.error }}>
          {problem.toUpperCase()}
        </ThemedText>
      )}
      <View style={styles.buttons}>
        <PressableScale
          haptic
          accessibilityRole="button"
          accessibilityLabel="Add this show to your log"
          onPress={submit}
          style={[styles.btn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
          <ThemedText type="labelSm" style={{ color: theme.primary }}>
            ADD TO LOG
          </ThemedText>
        </PressableScale>
        <PressableScale
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Discard this show"
          onPress={() => {
            setOpen(false);
            setProblem(null);
          }}
          style={[styles.btn, { borderColor: theme.border }]}>
          <ThemedText type="labelSm" themeColor="textSecondary">
            CANCEL
          </ThemedText>
        </PressableScale>
      </View>
      <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
        PRIVATE TO YOUR LOG · RATEABLE LIKE ANY OTHER NIGHT
      </ThemedText>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  card: { gap: Spacing.two, padding: Spacing.three },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  btn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
