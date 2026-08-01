import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { StarRating } from '@/components/star-rating';
import { formatEventDate } from '@/lib/format';
import { personLabel, useFollowList, useFollowPerson, useProfile, type PublicUser } from '@/lib/people';
import { usePersonLists } from '@/lib/curated';
import { useBlockPerson, useFeed, useProfileReviews } from '@/lib/reviews';
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

export function PersonProfile({ profileKey }: { profileKey: string }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const profile = useProfile(profileKey);
  const follow = useFollowPerson(profileKey);
  const block = useBlockPerson(profileKey);
  const [tab, setTab] = useState<'followers' | 'following'>('followers');
  // Both directions mount lazily: the counts answer most visits, and each list
  // is only fetched the first time its tab is looked at.
  const list = useFollowList(profileKey, tab, profile.isSuccess);
  const theirReviews = useProfileReviews(profileKey, profile.isSuccess);
  const shelves = usePersonLists(profileKey, profile.isSuccess);
  // The feed lives on *your* profile — the social graph is reached through you
  // (docs/social.md's answer to the naming collision). Only fetched for self.
  const isSelfProfile = profile.data?.viewer?.isSelf ?? false;
  const feed = useFeed(isSelfProfile);

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
      </GlassCard>

      {/* The feed — what the people you follow have been to lately. Yours only,
          first thing on your own profile: it's the reason to open the tab
          twice a day, so it doesn't live under the follower lists any more.
          Only once it has an answer; an empty graph shows a nudge, not a hole. */}
      {/* A failed *older-page* fetch must not blank pages already on screen —
          the full-width error is only for having nothing to show at all. */}
      {isSelf && feed.isError && !feed.data && (
        <View style={styles.centreBlock}>
          <ErrorState onRetry={() => feed.refetch()} />
        </View>
      )}
      {isSelf && !!feed.data && (
        <>
          <ThemedText type="label" style={[styles.reviewsLabel, { color: theme.cyan }]}>
            FROM PEOPLE YOU FOLLOW
          </ThemedText>
          {feed.data.pages[0].items.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>
              Nothing yet. Follow people and their public reviews land here.
            </ThemedText>
          ) : (
            <GlassCard style={styles.listCard}>
              {feed.data.pages.flatMap((p) => p.items).map((item) => (
                <PressableScale
                  key={item.id}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.eventName}`}
                  onPress={() => router.push(`/event/${encodeURIComponent(item.eventId)}`)}
                  style={[styles.reviewRow, { borderColor: theme.border }]}>
                  <View style={styles.reviewHead}>
                    <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                      {item.eventName}
                    </ThemedText>
                    {item.rating != null && <StarRating value={item.rating} size={13} subject="the performance" />}
                  </View>
                  <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
                    {`${(item.authorName ?? (item.authorHandle ? `@${item.authorHandle}` : 'SOMEONE')).toUpperCase()} · ${formatEventDate(item.startsAt, null).toUpperCase()}`}
                  </ThemedText>
                  {!!item.body && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                      {item.body}
                    </ThemedText>
                  )}
                </PressableScale>
              ))}
              {feed.hasNextPage && (
                <PressableScale
                  haptic
                  accessibilityRole="button"
                  accessibilityLabel="Show older reviews from people you follow"
                  onPress={() => !feed.isFetchingNextPage && feed.fetchNextPage()}
                  style={[styles.moreBtn, { borderColor: feed.isFetchNextPageError ? theme.error : theme.border }]}>
                  <ThemedText
                    type="labelSm"
                    themeColor={feed.isFetchNextPageError ? undefined : 'textSecondary'}
                    style={feed.isFetchNextPageError ? { color: theme.error } : undefined}>
                    {feed.isFetchingNextPage
                      ? 'LOADING…'
                      : feed.isFetchNextPageError
                        ? 'COULDN’T LOAD — TRY AGAIN'
                        : 'SHOW OLDER'}
                  </ThemedText>
                </PressableScale>
              )}
            </GlassCard>
          )}
        </>
      )}

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
          {list.data!.people.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
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
            {shelves.data.lists.map((l) => (
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
              {theirReviews.data.reviews.map((r) => (
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
