import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { FollowButton } from '@/components/follow-button';
import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { personLabel, useFollowList, useFollowPerson, useProfile, type PublicUser } from '@/lib/people';
import { useWriteGate } from '@/lib/write-gate';

/**
 * Somebody's profile — the first screen in the app that shows one account to
 * another. Phase A of docs/social.md: identity, join date, the two follow
 * counts and their lists, and a follow button. Deliberately *no* log data:
 * everything in the log was written under a "visible to nobody else" promise,
 * and publishing any of it is phase B's per-entry opt-in.
 */

/** "Since July 2026" — the profile's only date, so a local helper, not format.ts. */
function joinedLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'On Marquee';
  return `On Marquee since ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
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

export default function ProfileScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const theme = useTheme();
  const gate = useWriteGate();
  const profile = useProfile(key);
  const follow = useFollowPerson(key);
  const [tab, setTab] = useState<'followers' | 'following'>('followers');
  // Both directions mount lazily: the counts answer most visits, and each list
  // is only fetched the first time its tab is looked at.
  const list = useFollowList(key, tab, profile.isSuccess);

  if (profile.isLoading) {
    return (
      <View style={styles.center}>
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
      <View style={styles.center}>
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
    <View style={{ flex: 1 }}>
      <PageMeta title={label} description={`${label} on Marquee — concerts, follows and reviews.`} />
      <StageBackground />
      <TopBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          {!isSelf && (
            <FollowButton
              following={viewer?.following ?? false}
              onToggle={onToggleFollow}
              icon={{ on: 'person-remove-outline', off: 'person-add-outline' }}
              subject={label}
            />
          )}
        </GlassCard>

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
                  {`${n} ${t.toUpperCase()}`}
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
            {tab === 'followers' ? 'Nobody follows them yet.' : "They aren't following anyone yet."}
          </ThemedText>
        ) : (
          <GlassCard style={styles.listCard}>
            {list.data!.people.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </GlassCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
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
});
