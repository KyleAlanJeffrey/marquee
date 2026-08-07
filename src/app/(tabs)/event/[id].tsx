import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtistArt } from '@/components/artist-art';
import { AttendanceCard } from '@/components/attendance-card';
import { ErrorState } from '@/components/error-state';
import { ReviewSection } from '@/components/review-section';
import { AddToListButton } from '@/components/add-to-list-button';
import { EventActions } from '@/components/event-actions';
import { GalleryStrip } from '@/components/gallery-strip';
import { GlassCard } from '@/components/glass-card';
import { GradientButton } from '@/components/gradient-button';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { RsvpCounts } from '@/components/rsvp-counts';
import { ShareButton } from '@/components/share-button';
import { StaticMap } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Colors, Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { useSavedShows } from '@/lib/saved-shows-store';
import { artistImageSrc } from '@/lib/api';
import { openUrl } from '@/lib/open-url';
import { useEvent, useEventBuzz, useEventLineup } from '@/hooks/queries';
import { formatEventDate, formatTime, formatVenue, formatZoneLabel } from '@/lib/format';
import { eventShare } from '@/lib/share';
import { socialLinks } from '@/lib/social';
import { ticketSources } from '@/lib/tickets';
import Animated, { FadeInDown } from 'react-native-reanimated';

/**
 * Now, read once per mount rather than on every render.
 *
 * `Date.now()` in a component body is impure — two renders of identical props can
 * disagree — which `react-hooks/purity` flags and is right to. A lazy `useState`
 * initializer is the sanctioned way to read something external exactly once, and
 * once is all this needs: the only thing it decides is whether a show has started,
 * and a page open across that moment can say so on its next mount.
 */
function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}

function InfoRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  valueColor?: string;
}) {
  const theme = useTheme();
  return (
    <GlassCard style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: theme.backgroundHigh }]}>
        <Ionicons name={icon} size={20} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
          {label.toUpperCase()}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: valueColor ?? theme.text }}>
          {value}
        </ThemedText>
      </View>
    </GlassCard>
  );
}

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const event = useEvent(id);
  const buzzPosts = useEventBuzz(id);
  const lineup = useEventLineup(id);
  const { isFollowing, toggle } = useFollows();
  const { isSaved, toggleSaved } = useSavedShows();
  const now = useNow();

  if (event.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (event.isError) {
    return (
      <View style={styles.center}>
        <ErrorState onRetry={() => event.refetch()} />
      </View>
    );
  }

  const e = event.data;
  if (!e) {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary">Event not found.</ThemedText>
      </View>
    );
  }

  const following = isFollowing({ artistId: e.artist.id, spotifyId: e.artist.spotify_id });
  const saved = isSaved({ eventId: e.id });
  // One snapshot builder for both save affordances (the top-bar bookmark and
  // the actions card), so they can never drift apart on what gets stored.
  const toggleSave = () =>
    toggleSaved({
      eventId: e.id,
      name: e.name,
      startsAt: e.starts_at,
      timeUnknown: e.time_unknown,
      artistId: e.artist.id,
      artistName: e.artist.name,
      artistImageUrl: e.artist.image_url,
      venueId: e.venue?.id ?? null,
      venueName: e.venue?.name ?? null,
      venueCity: e.venue?.city ?? null,
      venueTimezone: e.venue?.timezone ?? null,
      priceFrom: e.price_from,
    });
  const hasTickets = !!e.ticket_url;
  const sources = ticketSources(e);
  const primaryUrl = e.ticket_url ?? sources[sources.length - 1].url;
  const genre = e.artist.genres?.[0];
  // Only show the artist line when it adds info (event name is often the artist).
  const showArtist = !!e.artist.name && e.artist.name.toLowerCase() !== e.name.toLowerCase();
  // Everything on this page is in the venue's local time, with the zone spelled
  // out when that isn't the reader's — "Doors 8:00 PM" is otherwise a guess.
  const tz = e.venue?.timezone ?? null;
  const zoneLabel = formatZoneLabel(e.starts_at, tz);
  // Null when the set time isn't announced — the stored timestamp is a noon
  // placeholder, and "Doors 12:00 PM" would be an invention.
  const time = (iso: string) =>
    e.time_unknown ? null : [formatTime(iso, tz), zoneLabel].filter(Boolean).join(' ');
  // The hero photo, from our mirror rather than hotlinked off whoever we read
  // it from — the same reason the copy no longer names them.
  const heroArt = e.artist.image_url ? (artistImageSrc(e.artist.id) ?? e.artist.image_url) : null;
  const buzz = socialLinks(e.artist.name, e.venue?.name);
  const support = lineup.data?.support ?? [];
  // Compared against the start rather than an estimated end: a show is something
  // you can say you were at from the moment it begins, and we don't know when it
  // finished. An unparseable date counts as upcoming, so a bad row never invites
  // somebody to log a gig that may not have happened.
  // A time-unknown show starts sometime on its local day — noon is only the
  // placeholder — so it hasn't "happened" until midnight at the venue.
  const startedAt = Date.parse(e.starts_at) + (e.time_unknown ? 12 * 3_600_000 : 0);
  const hasHappened = now != null && Number.isFinite(startedAt) && startedAt < now;

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title={`${e.name}${e.venue ? ` at ${e.venue.name}` : ''} — ${formatEventDate(e.starts_at, tz)}`}
        description={`${e.name} plays ${
          e.venue ? formatVenue(e.venue.name, e.venue.city, e.venue.region) : 'live'
        } on ${formatEventDate(e.starts_at, tz)}${
          time(e.starts_at) ? ` at ${time(e.starts_at)}` : ''
        }. Tickets, lineup and what people are saying about the show.`}
      />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        {/* Hero — framed as a specific show (date + venue), not an artist page */}
        <View style={styles.hero}>
          <Image
            source={heroArt ? { uri: heroArt } : undefined}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={250}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)', theme.background]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBody}>
            <View style={[styles.liveTag, { borderColor: theme.cyan }]}>
              <View style={[styles.liveDot, { backgroundColor: theme.cyan }]} />
              <ThemedText type="labelSm" style={{ color: theme.cyan, letterSpacing: 1.5 }}>
                LIVE EVENT
              </ThemedText>
            </View>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary, letterSpacing: 1 }}>
              {[genre?.toUpperCase(), formatEventDate(e.starts_at, tz), time(e.starts_at)]
                .filter(Boolean)
                .join(' • ')}
            </ThemedText>
            <ThemedText type="display" numberOfLines={3} style={styles.heroTitle}>
              {e.name}
            </ThemedText>
            {showArtist && (
              <ThemedText type="bodyLg" style={{ color: theme.textSecondary }}>
                {e.artist.name}
              </ThemedText>
            )}
            {/* The venue in the hero opens the venue. It read as a link already
                — pin icon, its own line, right under the title — and wasn't
                one, so the obvious tap did nothing and you had to scroll past
                the whole page to the venue card to find the real button.
                A row with no venue id (manual entry, or "Venue TBA") has
                nowhere to go and stays text. */}
            {e.venue?.id ? (
              <PressableScale
                haptic={false}
                accessibilityRole="link"
                accessibilityLabel={`Open ${e.venue.name ?? 'the venue'}`}
                onPress={() => router.push(`/venue/${e.venue!.id}`)}
                style={styles.heroVenue}>
                <Ionicons name="location" size={15} color={theme.cyan} />
                {/* Cyan and not textSecondary: the same colour the icon is
                    already wearing, which is how everything else tappable on
                    this page reads. */}
                <ThemedText type="small" style={{ color: theme.cyan, flexShrink: 1 }} numberOfLines={1}>
                  {formatVenue(e.venue.name, e.venue.city, e.venue.region)}
                </ThemedText>
                <Ionicons name="chevron-forward" size={14} color={theme.cyan} />
              </PressableScale>
            ) : (
              <View style={styles.heroVenue}>
                <Ionicons name="location" size={15} color={theme.cyan} />
                <ThemedText type="small" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {formatVenue(e.venue?.name ?? null, e.venue?.city ?? null, e.venue?.region ?? null)}
                </ThemedText>
              </View>
            )}
            {/* Social proof in the hero, upcoming shows only — for a past show
                "3 were going" reads as stale plans, and the log below is the
                record of the night that actually happened. */}
            {!hasHappened && <RsvpCounts going={e.rsvp_going} interested={e.rsvp_interested} />}
          </View>
        </View>

        {/* Info rows */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.section}>
          <InfoRow
            icon="calendar"
            label="Date & Gate"
            value={
              time(e.starts_at)
                ? `${formatEventDate(e.starts_at, tz)} · Doors ${time(e.starts_at)}`
                : `${formatEventDate(e.starts_at, tz)} · Time TBA`
            }
          />
          <InfoRow
            icon="location"
            label="Venue"
            value={formatVenue(e.venue?.name ?? null, e.venue?.city ?? null, e.venue?.region ?? null)}
          />
          <InfoRow
            icon="pricetag"
            label="Availability"
            value={hasTickets ? 'Tickets available' : 'Resale on StubHub'}
            valueColor={hasTickets ? theme.cyan : theme.error}
          />
        </Animated.View>

        {/* Was I there? Above the ticket links on purpose: for a show that has
            already happened, buying a ticket is not the thing left to do. */}
        {hasHappened ? (
          <>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.cyan }]} />
              <ThemedText type="title">Your Log</ThemedText>
            </View>
            <AttendanceCard
              venueName={e.venue?.name ?? null}
              show={{
                eventId: e.id,
                name: e.name,
                startsAt: e.starts_at,
                artistId: e.artist.id,
                artistName: e.artist.name,
                artistImageUrl: e.artist.image_url ?? null,
                venueId: e.venue?.id ?? null,
                venueName: e.venue?.name ?? null,
                venueCity: e.venue?.city ?? null,
                venueTimezone: tz,
              }}
            />
            {/* Everyone else's reviews — yours is written inside the log card
                above, as the public step of the same act. */}
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
              <ThemedText type="title">Reviews</ThemedText>
            </View>
            <View style={{ paddingHorizontal: Spacing.three }}>
              <ReviewSection eventId={e.id} />
            </View>
          </>
        ) : null}

        {/* Your plans — going/interested, save, and shelves in one card. The
            forward-looking half of the log; a show that already happened asks
            "were you there?" above instead, and keeps just the shelf button. */}
        {!hasHappened ? (
          <>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.accentBar, { backgroundColor: theme.cyan }]} />
              <ThemedText type="title">Your Plans</ThemedText>
            </View>
            <EventActions eventId={e.id} subject={e.name} saved={saved} onToggleSave={toggleSave} />
          </>
        ) : (
          <View style={{ paddingHorizontal: Spacing.three, marginTop: Spacing.two }}>
            <AddToListButton refKind="event" refId={e.id} subject={e.name} />
          </View>
        )}

        {/* Get Tickets */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">Get Tickets</ThemedText>
        </View>
        <View style={styles.section}>
          {sources.map((s) => {
            const resale = s.kind === 'resale';
            const accent = resale ? theme.error : theme.cyan;
            return (
              <PressableScale
                key={s.id}
                onPress={() => openUrl(s.url)}
                style={[styles.ticketSource, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                <View style={[styles.ticketIcon, { backgroundColor: theme.backgroundHigh }]}>
                  <Ionicons name={resale ? 'swap-horizontal' : 'ticket'} size={20} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{s.label}</ThemedText>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                    {resale ? 'RESALE MARKETPLACE' : 'OFFICIAL TICKETS'}
                  </ThemedText>
                </View>
                <Ionicons name="open-outline" size={18} color={theme.textTertiary} />
              </PressableScale>
            );
          })}
        </View>

        {/* Headliner */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Lineup</ThemedText>
        </View>
        <View style={styles.section}>
          <PressableScale
            onPress={() => router.push(`/artist/${e.artist.id}`)}
            style={[styles.headliner, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
            <ArtistArt uri={e.artist.image_url} artistId={e.artist.id} style={styles.headlinerImg} iconSize={22} />
            <View style={{ flex: 1 }}>
              <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                HEADLINER
              </ThemedText>
              <ThemedText type="title" numberOfLines={1}>
                {e.artist.name}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
          </PressableScale>

          {support.length > 0 && (
            <View style={styles.supportRow}>
              {support.slice(0, 3).map((s) => (
                <View
                  key={s.name}
                  style={[styles.supportTile, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                  {s.image_url && (
                    <Image source={{ uri: s.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.85)']}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                  />
                  <ThemedText type="labelSm" style={{ color: theme.cyan }}>
                    SUPPORT
                  </ThemedText>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.onImage }}>
                    {s.name}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* The Venue */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Venue</ThemedText>
        </View>
        <View style={styles.section}>
          <GlassCard style={styles.venueCard}>
            <View style={styles.venueMap}>
              <StaticMap
                points={e.venue?.lat != null && e.venue?.lng != null ? [{ lat: e.venue.lat, lng: e.venue.lng }] : []}
                zoom={14}
              />
            </View>
            <View style={styles.venueInfo}>
              <ThemedText type="title" numberOfLines={1}>
                {e.venue?.name ?? 'Venue TBA'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[e.venue?.city, e.venue?.region].filter(Boolean).join(', ') || 'Location to be announced'}
              </ThemedText>
              <View style={styles.venueBtns}>
                {e.venue?.id && (
                  <PressableScale
                    onPress={() => router.push(`/venue/${e.venue!.id}`)}
                    style={[styles.mapsBtn, { backgroundColor: theme.cyan, borderColor: theme.cyan }]}>
                    <ThemedText type="label" style={{ color: theme.onCyan, fontSize: 12 }}>
                      VIEW VENUE
                    </ThemedText>
                  </PressableScale>
                )}
                <PressableScale
                  onPress={() =>
                    openUrl(
                      `https://maps.google.com/?q=${encodeURIComponent(
                        [e.venue?.name, e.venue?.city, e.venue?.region].filter(Boolean).join(' '),
                      )}`,
                    )
                  }
                  style={[styles.mapsBtn, { borderColor: theme.cyan }]}>
                  <ThemedText type="label" style={{ color: theme.cyan, fontSize: 12 }}>
                    OPEN IN MAPS
                  </ThemedText>
                </PressableScale>
              </View>
            </View>
          </GlassCard>
        </View>

        {/* The Buzz */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">The Buzz</ThemedText>
        </View>
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            See what fans are saying about this show.
          </ThemedText>
          <View style={styles.buzzGrid}>
            {buzz.map((s) => (
              <PressableScale
                key={s.id}
                haptic={false}
                onPress={() => openUrl(s.url)}
                style={[styles.buzzChip, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                <Ionicons name={s.icon} size={20} color={s.color} />
                <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                  {s.label}
                </ThemedText>
                <Ionicons name="open-outline" size={15} color={theme.textTertiary} />
              </PressableScale>
            ))}
          </View>

          {/* Real posts (Bluesky) */}
          {(buzzPosts.data?.posts.length ?? 0) > 0 && (
            <View style={styles.postList}>
              {buzzPosts.data!.posts.map((p) => (
                <PressableScale
                  key={p.id}
                  haptic={false}
                  onPress={() => openUrl(p.url)}
                  style={[styles.postCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
                  <View style={styles.postHead}>
                    <Image
                      source={p.avatar ? { uri: p.avatar } : undefined}
                      style={[styles.postAvatar, { backgroundColor: theme.backgroundHigh }]}
                      contentFit="cover"
                    />
                    <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {p.author}
                    </ThemedText>
                    <ThemedText
                      type="labelSm"
                      numberOfLines={1}
                      style={{ color: theme.textTertiary, flexShrink: 1, textTransform: 'none' }}>
                      @{p.handle}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" numberOfLines={4}>
                    {p.text}
                  </ThemedText>
                  {p.image && (
                    <Image
                      source={{ uri: p.image }}
                      style={[styles.postImage, { backgroundColor: theme.backgroundHigh }]}
                      contentFit="cover"
                    />
                  )}
                  <View style={styles.postStats}>
                    <Ionicons name="heart-outline" size={14} color={theme.textTertiary} />
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      {p.likes}
                    </ThemedText>
                    <Ionicons name="chatbubble-outline" size={14} color={theme.textTertiary} style={{ marginLeft: Spacing.two }} />
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      {p.replies}
                    </ThemedText>
                  </View>
                </PressableScale>
              ))}
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                via Bluesky
              </ThemedText>
            </View>
          )}
        </View>

        {/* Fan Gallery */}
        <View style={styles.sectionTitleRow}>
          <View style={[styles.accentBar, { backgroundColor: theme.primary }]} />
          <ThemedText type="title">Fan Gallery</ThemedText>
        </View>
        <GalleryStrip imageUrl={e.artist.image_url} artistId={e.artist.id} />
      </Animated.ScrollView>

      {/* Floating top bar with back, and save-for-later in the right slot: the
          buy bar below has no room left for it at phone width. */}
      <View style={styles.topBarAbs}>
        <TopBar
          transparent
          back
          title="Event"
          action={
            <View style={styles.topActions}>
              {/* Hand this show to somebody — the reason half these pages get
                  opened in the first place. */}
              <ShareButton
                payload={eventShare({
                  id: e.id,
                  name: e.name,
                  venueName: e.venue?.name ?? null,
                  venueCity: e.venue?.city ?? null,
                  when: formatEventDate(e.starts_at, tz),
                })}
                subject={e.name}
                style={styles.saveTop}
              />
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: saved }}
                accessibilityLabel={saved ? `Remove ${e.name} from saved` : `Save ${e.name} for later`}
                onPress={toggleSave}
                style={styles.saveTop}>
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={theme.cyan}
                />
              </PressableScale>
            </View>
          }
        />
      </View>

      {/* Sticky buy bar */}
      <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.two }]}>
        <LinearGradient
          colors={['transparent', theme.background]}
          style={styles.buyFade}
          pointerEvents="none"
        />
        <View style={styles.buyContent}>
          <View style={{ flex: 1 }}>
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              {following ? 'FOLLOWING ARTIST' : 'FROM YOUR AREA'}
            </ThemedText>
            <ThemedText type="title" numberOfLines={1}>
              {e.artist.name}
            </ThemedText>
          </View>
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel={following ? `Unfollow ${e.artist.name}` : `Follow ${e.artist.name}`}
            onPress={() =>
              toggle({
                artistId: e.artist.id,
                spotifyId: e.artist.spotify_id,
                name: e.artist.name,
                imageUrl: e.artist.image_url,
                genres: e.artist.genres,
              })
            }
            style={[
              styles.followMini,
              following
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { borderColor: theme.primary },
              following && Glow.primary,
            ]}>
            <Ionicons
              name={following ? 'heart' : 'heart-outline'}
              size={22}
              color={following ? theme.onPrimary : theme.primary}
            />
          </PressableScale>
          <GradientButton
            label={hasTickets ? 'Buy Tickets' : 'Find on StubHub'}
            onPress={() => openUrl(primaryUrl)}
          />
        </View>
      </View>
    </View>
  );
}

const HERO_H = 440;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: HERO_H, justifyContent: 'flex-end' },
  heroBody: { padding: Spacing.three, gap: Spacing.one + 2 },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginBottom: Spacing.one,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  heroTitle: { color: Colors.dark.onImage },
  heroVenue: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.one },
  section: { paddingHorizontal: Spacing.three, gap: Spacing.two + 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.three,
  },
  accentBar: { width: 4, height: 22, borderRadius: 2 },
  ticketSource: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  ticketIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buzzGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two + 2, marginTop: Spacing.two + 2 },
  buzzChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  postList: { gap: Spacing.two + 2, marginTop: Spacing.three },
  postCard: { padding: Spacing.three, borderRadius: Radius.lg, borderWidth: 1, gap: Spacing.two },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  postAvatar: { width: 26, height: 26, borderRadius: Radius.pill },
  postImage: { width: '100%', height: 160, borderRadius: Radius.sm },
  postStats: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  headliner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  headlinerImg: { width: 56, height: 56, borderRadius: Radius.sm },
  supportRow: { flexDirection: 'row', gap: Spacing.two + 2, marginTop: Spacing.two },
  supportTile: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.three,
    height: 92,
    justifyContent: 'flex-end',
    gap: 2,
    overflow: 'hidden',
  },
  venueCard: { overflow: 'hidden' },
  venueMap: { height: 130 },
  venueInfo: { padding: Spacing.three, gap: Spacing.one + 2 },
  venueBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  mapsBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  topBarAbs: { position: 'absolute', top: 0, left: 0, right: 0 },
  topActions: { flexDirection: 'row', gap: Spacing.two },
  // Sits over the hero, so it gets its own dark disc to stay legible.
  saveTop: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  buyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    // The theme's background, not a lookalike literal that drifts when the
    // palette moves.
    backgroundColor: Colors.dark.background,
  },
  buyFade: { position: 'absolute', top: -Spacing.five, left: 0, right: 0, height: Spacing.five },
  buyContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  followMini: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
