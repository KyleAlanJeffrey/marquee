import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { MeshBackground } from '@/components/mesh-background';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { RADIUS_OPTIONS, usePrefs } from '@/lib/prefs-store';
import { ensureNotificationPermission } from '@/lib/reminders';

function Label({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <ThemedText type="label" style={[styles.sectionLabel, { color: theme.primary }]}>
      {children}
    </ThemedText>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
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
    <View style={{ flex: 1 }}>
      <MeshBackground />
      <TopBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="headline" style={styles.title}>
          Profile
        </ThemedText>

        <Label>REMINDERS</Label>
        <GlassCard style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText type="smallBold">Show reminders</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {'A heads-up the day before a followed artist plays near you. Stored on this device — no account needed.'}
              </ThemedText>
            </View>
            <Switch
              value={remindersEnabled}
              onValueChange={onToggleReminders}
              disabled={toggling}
              trackColor={{ true: theme.primaryVivid, false: theme.backgroundHigh }}
              thumbColor="#fff"
            />
          </View>
        </GlassCard>

        <Label>SEARCH RADIUS</Label>
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
                  active
                    ? { backgroundColor: theme.primary, borderColor: theme.primary }
                    : { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
                ]}>
                <ThemedText type="label" style={{ color: active ? theme.onPrimary : theme.text }}>
                  {r} MI
                </ThemedText>
              </PressableScale>
            );
          })}
        </View>

        <View style={styles.followingHead}>
          <Label>{`FOLLOWING · ${follows.length}`}</Label>
          <Pressable onPress={() => router.push('/search')} hitSlop={8} style={styles.addBtn}>
            <Ionicons name="add" size={18} color={theme.cyan} />
            <ThemedText type="label" style={{ color: theme.cyan, fontSize: 12 }}>
              ADD
            </ThemedText>
          </Pressable>
        </View>

        {follows.length === 0 ? (
          <GlassCard style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {"You're not following anyone yet. Follow artists to spotlight their shows and get reminders."}
            </ThemedText>
          </GlassCard>
        ) : (
          <GlassCard style={styles.listCard}>
            {follows.map((f, i) => (
              <View
                key={f.artistId ?? f.spotifyId ?? f.name}
                style={[
                  styles.followRow,
                  i < follows.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border },
                ]}>
                <Image
                  source={f.imageUrl ? { uri: f.imageUrl } : undefined}
                  style={[styles.followAvatar, { backgroundColor: theme.backgroundHigh }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {f.name}
                  </ThemedText>
                  {f.genres.length > 0 && (
                    <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                      {f.genres.slice(0, 2).join(' · ').toUpperCase()}
                    </ThemedText>
                  )}
                </View>
                <PressableScale
                  scaleTo={0.9}
                  onPress={() => unfollow({ artistId: f.artistId, spotifyId: f.spotifyId })}
                  hitSlop={8}
                  style={[styles.removeBtn, { backgroundColor: theme.backgroundHigh }]}>
                  <Ionicons name="close" size={16} color={theme.textSecondary} />
                </PressableScale>
              </View>
            ))}
          </GlassCard>
        )}

        <ThemedText type="labelSm" style={[styles.footer, { color: theme.textTertiary }]}>
          MARQUEE · FOLLOWING STORED ON THIS DEVICE
        </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.one },
  title: { marginBottom: Spacing.two },
  sectionLabel: { letterSpacing: 1.5, marginTop: Spacing.three, marginBottom: Spacing.two },
  card: { padding: Spacing.three, gap: Spacing.two },
  listCard: { padding: 0, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  radiusRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  radiusPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  followingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  followAvatar: { width: 44, height: 44, borderRadius: Radius.pill },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { textAlign: 'center', marginTop: Spacing.four, letterSpacing: 1 },
});
