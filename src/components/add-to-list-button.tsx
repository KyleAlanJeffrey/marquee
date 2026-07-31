import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useAddToList, useCreateList, usePersonLists, type ListItem } from '@/lib/curated';
import { useWriteGate } from '@/lib/write-gate';

/**
 * "Add to list", on anything a list can hold.
 *
 * Opens into your shelves inline rather than a modal: pick one and the thing is
 * on it, or type a title and a new list is born holding it. The shelf list is
 * only fetched once the panel opens — most page views never ask.
 */
export function AddToListButton({ refKind, refId, subject }: { refKind: ListItem['refKind']; refId: string; subject: string }) {
  const theme = useTheme();
  const gate = useWriteGate();
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  // Every shelf it landed on this visit, not just the last — adding to two
  // lists should leave two checkmarks.
  const [addedTo, setAddedTo] = useState<ReadonlySet<string>>(new Set());
  const shelves = usePersonLists(userId ?? '', open && !!userId);
  const add = useAddToList();
  const create = useCreateList();

  const openPanel = () => {
    if (!gate.allowed) {
      if (!gate.pending) gate.deny('keep lists');
      return;
    }
    setOpen((v) => !v);
  };

  const addTo = (listId: string) => {
    add.mutate({ listId, refKind, refId }, { onSuccess: () => setAddedTo((prev) => new Set(prev).add(listId)) });
  };

  const createAndAdd = () => {
    const t = title.trim();
    if (!t) return;
    create.mutate(
      { title: t },
      {
        onSuccess: (res) => {
          setTitle('');
          addTo(res.id);
        },
      },
    );
  };

  return (
    <View style={styles.wrap}>
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel={`Add ${subject} to one of your lists`}
        onPress={openPanel}
        style={[styles.cta, { borderColor: theme.border }]}>
        <Ionicons name="albums-outline" size={16} color={theme.cyan} />
        <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
          ADD TO LIST
        </ThemedText>
      </PressableScale>

      {open && (
        <GlassCard style={styles.panel}>
          {(shelves.data?.lists.length ?? 0) === 0 && (
            <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
              NO LISTS YET — NAME YOUR FIRST
            </ThemedText>
          )}
          {shelves.data?.lists.map((l) => {
            const done = addedTo.has(l.id);
            return (
              <PressableScale
                key={l.id}
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={done ? `Added to ${l.title}` : `Add to ${l.title}`}
                onPress={() => !done && addTo(l.id)}
                style={[styles.row, { borderColor: done ? theme.primaryEdge : theme.border }]}>
                <Ionicons
                  name={done ? 'checkmark-circle' : 'list-outline'}
                  size={16}
                  color={done ? theme.primary : theme.textTertiary}
                />
                <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
                  {l.title}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {String(l.itemCount)}
                </ThemedText>
              </PressableScale>
            );
          })}
          <View style={styles.createRow}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="New list…"
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel="Name a new list"
              maxLength={120}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            <PressableScale
              haptic
              accessibilityRole="button"
              accessibilityLabel={`Create the list and add ${subject} to it`}
              onPress={createAndAdd}
              style={[styles.btn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
              <ThemedText type="labelSm" style={{ color: theme.primary }}>
                CREATE
              </ThemedText>
            </PressableScale>
          </View>
        </GlassCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  panel: { gap: Spacing.two, padding: Spacing.two + 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  createRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  btn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
