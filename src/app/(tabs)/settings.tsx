import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { SectionHeader } from '@/components/section-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { RADIUS_OPTIONS, usePrefs } from '@/lib/prefs-store';
import { ensureNotificationPermission } from '@/lib/reminders';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { follows, unfollow } = useFollows();
  const { radiusMiles, setRadiusMiles, remindersEnabled, setRemindersEnabled } = usePrefs();
  const [toggling, setToggling] = useState(false);

  async function onToggleReminders(next: boolean) {
    if (!next) {
      setRemindersEnabled(false);
      return;
    }
    setToggling(true);
    try {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Notifications off',
          'Enable notifications for Marquee in system settings to get show reminders.',
        );
        return;
      }
      setRemindersEnabled(true);
    } finally {
      setToggling(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.two }]}>
        <ThemedText style={styles.screenTitle}>Settings</ThemedText>

        {/* Reminders */}
        <SectionHeader>REMINDERS</SectionHeader>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }, Shadow.card]}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">Show reminders</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Get a heads-up the day before a followed artist plays near you. Stored on this
                device — no account needed.
              </ThemedText>
            </View>
            <Switch
              value={remindersEnabled}
              onValueChange={onToggleReminders}
              disabled={toggling}
              trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Radius */}
        <SectionHeader>SEARCH RADIUS</SectionHeader>
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((r) => {
            const active = r === radiusMiles;
            return (
              <PressableScale
                key={r}
                haptic={false}
                onPress={() => setRadiusMiles(r)}
                style={[
                  styles.radiusPill,
                  {
                    backgroundColor: active ? theme.tint : theme.backgroundElement,
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: active ? theme.onTint : theme.text }}>
                  {r} mi
                </ThemedText>
              </PressableScale>
            );
          })}
        </View>

        {/* Following */}
        <View style={styles.followingHeader}>
          <SectionHeader>{`FOLLOWING (${follows.length})`}</SectionHeader>
          <Pressable onPress={() => router.push('/search')} hitSlop={8} style={styles.addBtn}>
            <Ionicons name="add" size={18} color={theme.tint} />
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Add
            </ThemedText>
          </Pressable>
        </View>

        {follows.length === 0 ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }, Shadow.card]}>
            <ThemedText type="small" themeColor="textSecondary">
              {"You're not following anyone yet. Follow artists to spotlight their shows in Near Me and get reminders."}
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.card, styles.listCard, { backgroundColor: theme.backgroundElement }, Shadow.card]}>
            {follows.map((f, i) => (
              <View
                key={f.artistId ?? f.spotifyId ?? f.name}
                style={[
                  styles.followRow,
                  i < follows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                ]}>
                <Image
                  source={f.imageUrl ? { uri: f.imageUrl } : undefined}
                  style={[styles.followAvatar, { backgroundColor: theme.backgroundSelected }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {f.name}
                  </ThemedText>
                  {f.genres.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {f.genres.slice(0, 2).join(' · ')}
                    </ThemedText>
                  )}
                </View>
                <PressableScale
                  scaleTo={0.9}
                  onPress={() => unfollow({ artistId: f.artistId, spotifyId: f.spotifyId })}
                  hitSlop={8}
                  style={styles.removeBtn}>
                  <Ionicons name="close" size={18} color={theme.textSecondary} />
                </PressableScale>
              </View>
            ))}
          </View>
        )}

        <ThemedText type="small" themeColor="textTertiary" style={styles.footer}>
          Marquee · following stored on this device
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.one },
  screenTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5, marginBottom: Spacing.two },
  card: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  listCard: { padding: 0, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  radiusRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  radiusPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
  },
  followingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: Spacing.three },
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  followAvatar: { width: 44, height: 44, borderRadius: Radius.pill },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { textAlign: 'center', marginTop: Spacing.four },
});
