import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ArtistArt } from '@/components/artist-art';
import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ShowAllButton } from '@/components/show-all-button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useCappedList } from '@/hooks/use-capped-list';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { StarRating } from '@/components/star-rating';
import { useFollows } from '@/lib/follows-store';
import { formatEventDate } from '@/lib/format';
import {
  personLabel,
  useFollowList,
  useFollowPerson,
  useProfile,
  useSetFavorites,
  type FavoriteArtist,
  type PublicUser,
} from '@/lib/people';
import { usePersonLists } from '@/lib/curated';
import { useBlockPerson, useProfileReviews } from '@/lib/reviews';
import { useWriteGate } from '@/lib/write-gate';

/**
 * A person, as everyone sees them: identity, join date, the two follow counts
 * and their lists, and a follow button when they aren't you.
 *
 * One component on purpose. It renders `/user/[key]` for other people and sits
 * at the top of the Profile tab for yourself — so "your profile" and "what
 * other people see" are the same pixels reading the same endpoint, and the tab
 * can never quietly show you something the public page wouldn't.
 *
 * Deliberately *no* log data: everything in the log was written under a
 * "visible to nobody else" promise, and publishing any of it is phase B's
 * per-entry opt-in (docs/social.md).
 */

/** "Since July 2026" — the profile's only date, so a local helper, not format.ts. */
function joinedLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'On Marquee';
  // In UTC, matching the stamp: a July 1st account read from west of Greenwich
  // would otherwise say June.
  return `On Marquee since ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

/**
 * The four favorites — Letterboxd's signature, worn under the header. Anyone
 * sees the strip; the owner gets an EDIT toggle that opens a picker over the
 * artists they follow (the only sensible shortlist — favorites you don't even
 * follow would be a strange flex, and following is one tap away).
 */
function FavoritesStrip({
  profileKey,
  favorites,
  isSelf,
}: {
  profileKey: string;
  favorites: FavoriteArtist[];
  isSelf: boolean;
}) {
  const theme = useTheme();
  const { follows } = useFollows();
  const save = useSetFavorites(profileKey);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // Only follows the catalogue can name — a Spotify-only follow has no artist
  // id yet, and favorites are stored by ours.
  const candidates = follows.filter((f): f is typeof f & { artistId: string } => !!f.artistId);

  if (!isSelf && favorites.length === 0) return null;

  const openEditor = () => {
    // Seed only with ids the picker can actually show — a favorite you've
    // since unfollowed would otherwise hold a slot as an invisible,
    // un-unpickable chip. (It stays on the strip until you save.)
    const known = new Set(candidates.map((f) => f.artistId));
    setPicked(favorites.map((f) => f.id).filter((id) => known.has(id)));
    save.reset();
    setEditing(true);
  };

  const togglePick = (id: string) =>
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 4 ? [...cur, id] : cur,
    );

  return (
    <GlassCard style={styles.favCard}>
      <View style={styles.favHead}>
        <ThemedText type="label" style={{ color: theme.primary, flex: 1 }}>
          {`FAVORITES${favorites.length ? ` · ${favorites.length}` : ''}`}
        </ThemedText>
        {isSelf && !editing && (
          <PressableScale
            haptic={false}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Edit your four favorite artists"
            onPress={openEditor}>
            <ThemedText type="labelSm" themeColor="textSecondary">
              EDIT
            </ThemedText>
          </PressableScale>
        )}
      </View>

      {editing ? (
        <View style={styles.favEditor}>
          <ThemedText type="small" themeColor="textSecondary">
            Pick up to four from the artists you follow.
          </ThemedText>
          {candidates.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              You aren&rsquo;t following anyone the catalogue knows yet — follow some artists
              first.
            </ThemedText>
          ) : (
            <View style={styles.favPickGrid}>
              {candidates.map((f) => {
                const on = picked.includes(f.artistId);
                return (
                  <PressableScale
                    key={f.artistId}
                    haptic
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={
                      on ? `Remove ${f.name} from favorites` : `Add ${f.name} to favorites`
                    }
                    onPress={() => togglePick(f.artistId)}
                    style={[
                      styles.favPick,
                      { borderColor: on ? theme.primaryEdge : theme.border },
                      on && { backgroundColor: theme.primaryFill },
                    ]}>
                    <ThemedText
                      type="labelSm"
                      numberOfLines={1}
                      style={{ color: on ? theme.primary : theme.textSecondary }}>
                      {on ? `${picked.indexOf(f.artistId) + 1} · ` : ''}
                      {f.name.toUpperCase()}
                    </ThemedText>
                  </PressableScale>
                );
              })}
            </View>
          )}
          {save.isError && (
            <ThemedText type="labelSm" style={{ color: theme.error }}>
              COULDN&rsquo;T SAVE — TRY AGAIN
            </ThemedText>
          )}
          <View style={styles.favEditorButtons}>
            <PressableScale
              haptic
              accessibilityRole="button"
              accessibilityLabel="Save your favorites"
              onPress={() =>
                !save.isPending && save.mutate(picked, { onSuccess: () => setEditing(false) })
              }
              style={[styles.favBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
              <ThemedText type="labelSm" style={{ color: theme.primary }}>
                {save.isPending ? 'SAVING…' : 'SAVE'}
              </ThemedText>
            </PressableScale>
            <PressableScale
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Stop editing favorites"
              onPress={() => setEditing(false)}
              style={[styles.favBtn, { borderColor: theme.border }]}>
              <ThemedText type="labelSm" themeColor="textSecondary">
                CANCEL
              </ThemedText>
            </PressableScale>
          </View>
        </View>
      ) : favorites.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Four artists, your call. This is the first thing people see.
        </ThemedText>
      ) : (
        <View style={styles.favRow}>
          {favorites.map((f) => (
            <PressableScale
              key={f.id}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel={`Open ${f.name}`}
              onPress={() => router.push(`/artist/${encodeURIComponent(f.id)}`)}
              style={styles.favTile}>
              <ArtistArt uri={f.imageUrl} style={styles.favArt} iconSize={22} />
              <ThemedText type="labelSm" numberOfLines={1} style={{ color: theme.textSecondary }}>
                {f.name}
              </ThemedText>
            </PressableScale>
          ))}
          {/* Fillers keep three favorites from stretching poster-wide. */}
          {Array.from({ length: 4 - favorites.length }, (_, i) => (
            <View key={`fill-${i}`} style={styles.favTile} />
          ))}
        </View>
      )}
    </GlassCard>
  );
}

function PersonRow({ person }: { person: PublicUser }) {
  const theme = useTheme();
  const label = personLabel(person);
  return (
    <PressableScale
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}'s profile`}
      // Handle when they have one — the URL worth sharing — id otherwise.
      onPress={() => router.push(`/user/${encodeURIComponent(person.handle ?? person.id)}`)}
      style={[styles.personRow, { borderColor: theme.border }]}>
      {person.avatarUrl ? (
        <Image source={{ uri: person.avatarUrl }} style={styles.rowAvatar} />
      ) : (
        <View style={[styles.rowAvatar, styles.avatarFallback, { backgroundColor: theme.backgroundHigh }]}>
          <Ionicons name="person" size={16} color={theme.textTertiary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {label}
        </ThemedText>
        {person.handle && person.displayName && (
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
            @{person.handle}
          </ThemedText>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
    </PressableScale>
  );
}

export function PersonProfile({
  profileKey,
  /**
   * Owner-only content for the header card — the Profile tab passes the
   * account section (integrations, manage, sign out) here. A slot rather than
   * a built-in: this component is also every visitor's view of a profile, and
   * account controls must come from the one screen that means "you", not from
   * anything `/user/[key]` could reach. On a loaded profile it renders only
   * when the server says `isSelf`, so a stray slot on someone else's profile
   * stays invisible; when the profile read *fails* it renders anyway — sign
   * out can't be held hostage by a broken fetch, and in that branch the
   * caller's word is all there is.
   */
  accountSlot,
}: {
  profileKey: string;
  accountSlot?: React.ReactNode;
}) {
  const theme = useTheme();
  const gate = useWriteGate();
  const profile = useProfile(profileKey);
  const follow = useFollowPerson(profileKey);
  const block = useBlockPerson(profileKey);
  const [tab, setTab] = useState<'followers' | 'following'>('followers');
  // Siblings of the profile query, not children of it. These three used to wait
  // on `profile.isSuccess`, which cost a full round trip for nothing: all three
  // endpoints are `/users/:key/…` and take the same route param this component
  // was handed, so there was never anything to learn from the profile first.
  // The profile screen and every /user/:key link paid two sequential RTTs
  // before the body appeared.
  //
  // The laziness that comment used to claim is still here and always came from
  // elsewhere: `tab` is part of the query key, so the direction you haven't
  // looked at isn't fetched.
  const list = useFollowList(profileKey, tab, true);
  const theirReviews = useProfileReviews(profileKey);
  const shelves = usePersonLists(profileKey);

  // Profiles are summaries, and every one of these can outgrow one (the server
  // sends up to 100 people, 50 reviews): a cap each, and a gate for the rest.
  const people = useCappedList(list.data?.people ?? [], 8);
  const reviewList = useCappedList(theirReviews.data?.reviews ?? [], 5);
  const shelfList = useCappedList(shelves.data?.lists ?? [], 5);

  if (profile.isLoading) {
    return (
      <View style={styles.centreBlock}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (profile.isError || !profile.data) {
    // "Doesn't exist" and "couldn't load" are different answers: a stale link or
    // deleted account gets the first, a network hiccup must not — telling someone
    // an account is gone because their wifi dropped is the wrong kind of wrong.
    const gone = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <View style={styles.centreBlock}>
        <ErrorState
          message={gone ? "This profile doesn't exist — the account may have been deleted." : undefined}
          onRetry={gone ? undefined : () => profile.refetch()}
        />
        {/* The account section must outlive the profile read: the moment this
            endpoint is failing is exactly when someone reaches for SIGN OUT,
            and hiding the way out behind a broken fetch would trap them. No
            `isSelf` confirmation exists in this branch — trusting the caller
            is the contract here (see the prop docs), and the only caller that
            passes a slot is the tab that means "you". */}
        {accountSlot && <View style={styles.errorSlot}>{accountSlot}</View>}
      </View>
    );
  }

  const { user, counts, viewer } = profile.data;
  const label = personLabel(user);
  const isSelf = viewer?.isSelf ?? false;

  const onToggleFollow = () => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('follow people');
      return;
    }
    follow.mutate(!(viewer?.following ?? false));
  };

  return (
    <View style={styles.stack}>
      <GlassCard style={styles.headerCard}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundHigh }]}>
            <Ionicons name="person" size={36} color={theme.textTertiary} />
          </View>
        )}
        <ThemedText type="headline" style={{ textAlign: 'center' }}>
          {label}
        </ThemedText>
        {user.handle && user.displayName && (
          <ThemedText type="small" style={{ color: theme.textTertiary }}>
            @{user.handle}
          </ThemedText>
        )}
        <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
          {joinedLine(user.createdAt).toUpperCase()}
        </ThemedText>
        {isSelf && (
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            THIS IS WHAT OTHER PEOPLE SEE
          </ThemedText>
        )}
        {!isSelf && !viewer?.blocked && (
          <FollowButton
            following={viewer?.following ?? false}
            onToggle={onToggleFollow}
            icon={{ on: 'person-remove-outline', off: 'person-add-outline' }}
            subject={label}
          />
        )}
        {/* Block, quietly: signed-in viewers only, and never on yourself. The
            server severs follows both ways and hides both parties' reviews
            from each other — one tap does the whole estrangement. */}
        {!isSelf && viewer && (
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel={viewer.blocked ? `Unblock ${label}` : `Block ${label}`}
            onPress={() => block.mutate(!viewer.blocked)}
            style={[styles.blockBtn, { borderColor: viewer.blocked ? theme.error : theme.border }]}>
            <ThemedText type="labelSm" style={{ color: viewer.blocked ? theme.error : theme.textTertiary }}>
              {viewer.blocked ? 'BLOCKED — TAP TO UNBLOCK' : 'BLOCK'}
            </ThemedText>
          </PressableScale>
        )}
        {/* Yours ends with the account section — integrations and the way out
            live with the identity they belong to, not in a card further down. */}
        {isSelf && accountSlot}
      </GlassCard>

      {/* Four favorites, straight under the name — the profile's signature. */}
      <FavoritesStrip profileKey={profileKey} favorites={profile.data.favorites ?? []} isSelf={isSelf} />

      {/* The feed used to render here, mid-profile — it has a tab of its own
          now (Activity), where a stream people are meant to check actually
          gets checked. */}

      {/* The two counts are the tabs: tapping one is asking to see the list. */}
      <View style={styles.tabsRow}>
        {(['followers', 'following'] as const).map((t) => {
          const active = t === tab;
          const n = counts[t];
          return (
            <PressableScale
              key={t}
              haptic={false}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t)}
              style={[
                styles.tab,
                active
                  ? { backgroundColor: theme.primary, borderColor: theme.primary }
                  : { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
              ]}>
              <ThemedText type="label" style={{ color: active ? theme.onPrimary : theme.text }}>
                {`${n} ${(n === 1 ? t.replace(/s$/, '') : t).toUpperCase()}`}
              </ThemedText>
            </PressableScale>
          );
        })}
      </View>

      {list.isLoading ? (
        <View style={styles.centreBlock}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : list.isError ? (
        <View style={styles.centreBlock}>
          <ErrorState onRetry={() => list.refetch()} />
        </View>
      ) : (list.data?.people.length ?? 0) === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>
          {tab === 'followers'
            ? isSelf
              ? 'Nobody follows you yet. Share your profile link to change that.'
              : 'Nobody follows them yet.'
            : isSelf
              ? "You aren't following anyone yet. Open a friend's profile to follow them."
              : "They aren't following anyone yet."}
        </ThemedText>
      ) : (
        <GlassCard style={styles.listCard}>
          {people.shown.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
          {people.hidden > 0 && (
            <ShowAllButton hidden={people.hidden} noun="PEOPLE" onPress={people.expand} />
          )}
        </GlassCard>
      )}

      {/* Their lists — the shelves. Public ones for visitors, all of them for
          the owner ("PRIVATE" tags the difference on the list page itself). */}
      {shelves.isSuccess && shelves.data.lists.length > 0 && (
        <>
          <ThemedText type="label" style={[styles.reviewsLabel, { color: theme.primary }]}>
            {`LISTS · ${shelves.data.lists.length}`}
          </ThemedText>
          <GlassCard style={styles.listCard}>
            {shelfList.shown.map((l) => (
              <PressableScale
                key={l.id}
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={`Open the list ${l.title}`}
                onPress={() => router.push(`/list/${encodeURIComponent(l.id)}`)}
                style={[styles.reviewRow, { borderColor: theme.border }]}>
                <View style={styles.reviewHead}>
                  <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                    {l.title}
                  </ThemedText>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                    {`${l.itemCount}${l.visibility === 'private' ? ' · PRIVATE' : ''}`}
                  </ThemedText>
                </View>
                {!!l.description && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {l.description}
                  </ThemedText>
                )}
              </PressableScale>
            ))}
            {shelfList.hidden > 0 && (
              <ShowAllButton hidden={shelfList.hidden} noun="LISTS" onPress={shelfList.expand} />
            )}
          </GlassCard>
        </>
      )}

      {/* Their public reviews — the content profiles exist for. Absent rather
          than empty while loading; an empty state only once the answer is real. */}
      {theirReviews.isError && (
        <View style={styles.centreBlock}>
          <ErrorState onRetry={() => theirReviews.refetch()} />
        </View>
      )}
      {theirReviews.isSuccess && (
        <>
          <ThemedText type="label" style={[styles.reviewsLabel, { color: theme.primary }]}>
            {`REVIEWS · ${theirReviews.data.reviews.length}`}
          </ThemedText>
          {theirReviews.data.reviews.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>
              {isSelf
                ? 'Nothing published yet. Open a show you went to and say what it was like.'
                : 'No public reviews yet.'}
            </ThemedText>
          ) : (
            <GlassCard style={styles.listCard}>
              {reviewList.shown.map((r) => (
                <PressableScale
                  key={r.id}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${r.eventName}`}
                  onPress={() => router.push(`/event/${encodeURIComponent(r.eventId)}`)}
                  style={[styles.reviewRow, { borderColor: theme.border }]}>
                  <View style={styles.reviewHead}>
                    <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                      {r.eventName}
                    </ThemedText>
                    {r.rating != null && <StarRating value={r.rating} size={13} subject="the performance" />}
                  </View>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                    {formatEventDate(r.startsAt, null).toUpperCase()}
                  </ThemedText>
                  {!!r.body && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                      {r.body}
                    </ThemedText>
                  )}
                </PressableScale>
              ))}
              {reviewList.hidden > 0 && (
                <ShowAllButton hidden={reviewList.hidden} noun="REVIEWS" onPress={reviewList.expand} />
              )}
            </GlassCard>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  headerCard: { alignItems: 'center', gap: Spacing.two, padding: Spacing.four },
  favCard: { gap: Spacing.two, padding: Spacing.three },
  favHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  favRow: { flexDirection: 'row', gap: Spacing.two },
  // Capped: flex alone lets four tiles swallow a desktop row poster-sized.
  favTile: { flex: 1, maxWidth: 132, gap: 4 },
  favArt: { aspectRatio: 1, borderRadius: Radius.sm, overflow: 'hidden' },
  favEditor: { gap: Spacing.two },
  favPickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  favPick: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  favEditorButtons: { flexDirection: 'row', gap: Spacing.two },
  favBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  tabsRow: { flexDirection: 'row', gap: Spacing.two },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  centreBlock: { alignItems: 'center', padding: Spacing.four },
  // The account slot shown under an ErrorState: full width, like it is in the
  // header card, rather than shrink-wrapped by the centred parent.
  errorSlot: { alignSelf: 'stretch' },
  emptyNote: { textAlign: 'center', paddingVertical: Spacing.three },
  moreBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  listCard: { gap: Spacing.two, padding: Spacing.two + 2 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  rowAvatar: { width: 36, height: 36, borderRadius: 18 },
  blockBtn: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  reviewsLabel: { letterSpacing: 1.5, marginTop: Spacing.two },
  reviewRow: { gap: Spacing.one, padding: Spacing.two, borderRadius: Radius.lg, borderWidth: 1 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
