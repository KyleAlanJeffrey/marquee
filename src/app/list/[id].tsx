import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useDeleteList, useList, useRemoveFromList, useUpdateList, type ListItem } from '@/lib/curated';
import { formatEventDate } from '@/lib/format';

/** Where an item's row leads — the same detail pages everything else opens. */
const routeFor = (item: ListItem): `/artist/${string}` | `/venue/${string}` | `/event/${string}` =>
  item.refKind === 'artist' ? `/artist/${item.refId}` : item.refKind === 'venue' ? `/venue/${item.refId}` : `/event/${item.refId}`;

const KIND_ICON = { artist: 'mic-outline', venue: 'business-outline', event: 'calendar-outline' } as const;

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const list = useList(id ?? '');
  const update = useUpdateList(id ?? '');
  const removeItem = useRemoveFromList(id ?? '');
  const deleteList = useDeleteList(id ?? '');
  const [armed, setArmed] = useState(false);

  if (list.isLoading || !id) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  if (list.isError || !list.data) {
    const gone = list.error instanceof ApiError && list.error.status === 404;
    return (
      <View style={styles.center}>
        <ErrorState
          message={gone ? "This list doesn't exist — it may be private, or deleted." : undefined}
          onRetry={gone ? undefined : () => list.refetch()}
        />
      </View>
    );
  }

  const { list: meta, items, isOwner } = list.data;

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title={meta.title} description={meta.description ?? `${meta.title} — a list on Marquee.`} />
      <StageBackground />
      <TopBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.head}>
          <ThemedText type="headline">{meta.title}</ThemedText>
          {!!meta.description && (
            <ThemedText type="small" themeColor="textSecondary">
              {meta.description}
            </ThemedText>
          )}
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            {`${items.length} ${items.length === 1 ? 'ENTRY' : 'ENTRIES'}${meta.visibility === 'private' ? ' · PRIVATE' : ''}`}
          </ThemedText>
          {isOwner && (
            <View style={styles.ownerRow}>
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel={
                  meta.visibility === 'public' ? 'Make this list private' : 'Make this list public'
                }
                onPress={() =>
                  update.mutate({ visibility: meta.visibility === 'public' ? 'private' : 'public' })
                }
                style={[styles.smallBtn, { borderColor: theme.border }]}>
                <ThemedText type="labelSm" themeColor="textSecondary">
                  {meta.visibility === 'public' ? 'MAKE PRIVATE' : 'MAKE PUBLIC'}
                </ThemedText>
              </PressableScale>
              <PressableScale
                haptic
                accessibilityRole="button"
                accessibilityLabel={armed ? 'Confirm: delete this list' : 'Delete this list'}
                onPress={() => {
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  deleteList.mutate(undefined, { onSuccess: () => router.back() });
                }}
                style={[styles.smallBtn, { borderColor: armed ? theme.error : theme.border }]}>
                <ThemedText type="labelSm" style={{ color: theme.error }}>
                  {armed ? 'TAP AGAIN TO DELETE' : 'DELETE LIST'}
                </ThemedText>
              </PressableScale>
            </View>
          )}
        </GlassCard>

        {items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {isOwner
              ? 'Empty shelf. "Add to list" lives on every artist, venue and event page.'
              : 'Nothing on this list yet.'}
          </ThemedText>
        ) : (
          <GlassCard style={styles.listCard}>
            {items.map((item) => (
              <View key={`${item.refKind}:${item.refId}`} style={[styles.row, { borderColor: theme.border }]}>
                {/* Title navigates; remove sits beside it. Siblings, never nested —
                    a button inside a button is invalid HTML on web. */}
                <PressableScale
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.name}`}
                  onPress={() => router.push(routeFor(item))}
                  style={styles.rowBody}>
                  <Ionicons name={KIND_ICON[item.refKind]} size={16} color={theme.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.name}
                    </ThemedText>
                    {!!item.detail && (
                      <ThemedText type="labelSm" style={{ color: theme.textTertiary }} numberOfLines={1}>
                        {item.refKind === 'event'
                          ? formatEventDate(item.detail, null).toUpperCase()
                          : item.detail.toUpperCase()}
                      </ThemedText>
                    )}
                  </View>
                </PressableScale>
                {isOwner && (
                  <PressableScale
                    haptic
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name} from this list`}
                    onPress={() => removeItem.mutate({ refKind: item.refKind, refId: item.refId })}
                    style={[styles.removeBtn, { backgroundColor: theme.backgroundHigh }]}>
                    <Ionicons name="close" size={14} color={theme.textSecondary} />
                  </PressableScale>
                )}
              </View>
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
  head: { gap: Spacing.two, padding: Spacing.three },
  ownerRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  smallBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  empty: { textAlign: 'center', paddingVertical: Spacing.three },
  listCard: { gap: Spacing.two, padding: Spacing.two + 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
