import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { Segmented } from '@/components/segmented';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useFeed, useGlobalActivity } from '@/lib/reviews';

/**
 * The Activity tab: what other people have seen, and what they're going to.
 *
 * This is the Letterboxd move — the social stream as a first-class tab, not a
 * section buried mid-profile (where the feed lived until now, three scrolls
 * deep behind the radius slider). Two scopes because the follow graph starts
 * empty: FRIENDS is the feed that matters once you follow people, EVERYONE is
 * the room's pulse that has answers on day one. EVERYONE is also the whole
 * tab signed out — reading the room requires no account; joining it does.
 */
export default function ActivityScreen() {
  const theme = useTheme();
  const { signedIn } = useAuth();
  const [scope, setScope] = useState<'friends' | 'everyone'>('friends');
  // Signed out there is no friends scope to select; the room is the tab.
  const effectiveScope = signedIn ? scope : 'everyone';

  const friends = useFeed(signedIn);
  const everyone = useGlobalActivity(effectiveScope === 'everyone');
  const feed = effectiveScope === 'friends' ? friends : everyone;

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={{ flex: 1 }}>
      <PageMeta
        title="Activity"
        description="What people on Marquee have been to, thought of it, and are going to next."
      />
      <StageBackground />
      <TopBar onSearchPress={() => router.push('/search')} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="headline">Activity</ThemedText>

        {signedIn ? (
          <Segmented
            label="Whose activity"
            options={[
              { value: 'friends', label: 'Friends' },
              { value: 'everyone', label: 'Everyone' },
            ]}
            value={scope}
            onChange={setScope}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Everyone&apos;s recent reviews and plans. Sign in to follow people and get a feed of your own.
          </ThemedText>
        )}

        {feed.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : feed.isError && !feed.data ? (
          <ErrorState onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          effectiveScope === 'friends' ? (
            <EmptyState
              icon="people-outline"
              title="Nothing from your people yet"
              message="Follow people and their reviews and plans land here. Until then, Everyone is the whole room."
              actionLabel="Find people"
              onAction={() => router.push('/search?only=people')}
            />
          ) : (
            <EmptyState
              icon="pulse-outline"
              title="All quiet"
              message="No public reviews or plans yet. Say you're going to a show and you'll be the first thing here."
            />
          )
        ) : (
          <GlassCard style={styles.listCard}>
            {items.map((item, i) => (
              <ActivityCard key={item.id} item={item} showDivider={i < items.length - 1} />
            ))}
            {feed.hasNextPage && (
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel="Show older activity"
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  center: { paddingVertical: Spacing.six, alignItems: 'center' },
  listCard: { padding: 0, overflow: 'hidden' },
  moreBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderTopWidth: 1,
  },
});
