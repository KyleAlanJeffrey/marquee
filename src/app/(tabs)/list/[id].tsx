import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ErrorState } from '@/components/error-state';
import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import {
  useDeleteList,
  useList,
  useRemoveFromList,
  useUpdateList,
  useUpdateListItem,
  type ListItem,
} from '@/lib/curated';
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
  const updateItem = useUpdateListItem(id ?? '');
  const deleteList = useDeleteList(id ?? '');
  const [armed, setArmed] = useState(false);
  // One note editor open at a time, keyed like the rows are.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // A missing id can't load, ever — a spinner would just spin. In practice
  // the router can't reach this screen without one, so this is a guard for
  // hand-typed URLs, and it answers like the sibling routes do.
  if (!id) {
    return (
      <View style={styles.center}>
        <ErrorState message="No list named. Open a list from a profile, or from your own." />
      </View>
    );
  }
  if (list.isLoading) {
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
            {items.map((item, index) => {
              const key = `${item.refKind}:${item.refId}`;
              const editing = editingKey === key;
              return (
                <View key={key} style={[styles.row, { borderColor: theme.border }]}>
                  <View style={styles.rowTop}>
                    {/* Title navigates; the controls sit beside it. Siblings,
                        never nested — a button inside a button is invalid HTML
                        on web. */}
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
                      <View style={styles.rowControls}>
                        <PressableScale
                          haptic
                          hitSlop={6}
                          disabled={index === 0}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${item.name} up`}
                          onPress={() => updateItem.mutate({ refKind: item.refKind, refId: item.refId, move: 'up' })}
                          style={[styles.ctlBtn, { backgroundColor: theme.backgroundHigh, opacity: index === 0 ? 0.35 : 1 }]}>
                          <Ionicons name="chevron-up" size={14} color={theme.textSecondary} />
                        </PressableScale>
                        <PressableScale
                          haptic
                          hitSlop={6}
                          disabled={index === items.length - 1}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${item.name} down`}
                          onPress={() => updateItem.mutate({ refKind: item.refKind, refId: item.refId, move: 'down' })}
                          style={[
                            styles.ctlBtn,
                            { backgroundColor: theme.backgroundHigh, opacity: index === items.length - 1 ? 0.35 : 1 },
                          ]}>
                          <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
                        </PressableScale>
                        <PressableScale
                          haptic
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={
                            item.note ? `Edit your note on ${item.name}` : `Add a note to ${item.name}`
                          }
                          onPress={() => {
                            // A fresh editor starts clean — an error from a
                            // move or another row's save is not this note's.
                            updateItem.reset();
                            setEditingKey(editing ? null : key);
                            setDraft(item.note ?? '');
                          }}
                          style={[styles.ctlBtn, { backgroundColor: theme.backgroundHigh }]}>
                          <Ionicons
                            name={item.note ? 'create' : 'create-outline'}
                            size={14}
                            color={item.note ? theme.cyan : theme.textSecondary}
                          />
                        </PressableScale>
                        <PressableScale
                          haptic
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${item.name} from this list`}
                          onPress={() => removeItem.mutate({ refKind: item.refKind, refId: item.refId })}
                          style={[styles.ctlBtn, { backgroundColor: theme.backgroundHigh }]}>
                          <Ionicons name="close" size={14} color={theme.textSecondary} />
                        </PressableScale>
                      </View>
                    )}
                  </View>
                  {/* The note: why this one is on the shelf. */}
                  {!!item.note && !editing && (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                      {item.note}
                    </ThemedText>
                  )}
                  {editing && (
                    <View style={styles.noteEditor}>
                      <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        placeholder="Why is this one on the list?"
                        placeholderTextColor={theme.textTertiary}
                        accessibilityLabel={`Note on ${item.name}`}
                        maxLength={300}
                        multiline
                        style={[styles.noteInput, { color: theme.text, borderColor: theme.border }]}
                      />
                      {/* The editor closes only when the save lands; a failed
                          request keeps the draft on screen with the reason. */}
                      {updateItem.isError && (
                        <ThemedText type="labelSm" style={{ color: theme.error }}>
                          COULDN&rsquo;T SAVE — TRY AGAIN
                        </ThemedText>
                      )}
                      <PressableScale
                        haptic
                        accessibilityRole="button"
                        accessibilityLabel="Save the note"
                        onPress={() =>
                          updateItem.mutate(
                            { refKind: item.refKind, refId: item.refId, note: draft.trim() || null },
                            // Close only if this editor is still the open one —
                            // a slow save must not shut an editor the user has
                            // since opened on another item.
                            { onSuccess: () => setEditingKey((k) => (k === key ? null : k)) },
                          )
                        }
                        style={[styles.smallBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
                        <ThemedText type="labelSm" style={{ color: theme.primary }}>
                          SAVE
                        </ThemedText>
                      </PressableScale>
                    </View>
                  )}
                </View>
              );
            })}
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
    gap: Spacing.one + 2,
    padding: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowControls: { flexDirection: 'row', gap: Spacing.one },
  ctlBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  note: { paddingLeft: Spacing.two + 16 + Spacing.two },
  noteEditor: { gap: Spacing.two },
  noteInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
    minHeight: 44,
  },
});
