import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { PageMeta } from '@/components/page-meta';
import { PersonProfile } from '@/components/person-profile';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAttendances } from '@/lib/attendances-store';
import { useAuth } from '@/lib/auth';
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
  const { attended } = useAttendances();
  const { signedIn, displayName, loading, userId } = useAuth();
  const { radiusMiles, setRadiusMiles, remindersEnabled, setRemindersEnabled, persisted } = usePrefs();
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
    } catch (err) {
      // The permission APIs can throw; leave reminders off and say so.
      console.warn('notification permission check failed:', err);
      Alert.alert('Reminders unavailable', "We couldn't check your notification permission. Reminders stay off.");
    } finally {
      setToggling(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title="Profile" description="Your Marquee search radius, reminders and notification settings." />
      <StageBackground />
      <TopBar />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="headline" style={styles.title}>
          Profile
        </ThemedText>

        {/* Your profile *is* the public one — same component, same endpoint as
            /user/[key] — so this tab can never show you something other people
            wouldn't see. Signed out there is no profile to show, and the
            account card below is the way in. */}
        {signedIn && userId && (
          <View style={styles.profileBlock}>
            <PersonProfile profileKey={userId} />
          </View>
        )}

        {/* A shortcut to the wall, which lives on My Shows under BEEN. The
            card stays because "how many shows have I been to" is a thing
            people come to their profile to find out. */}
        <Label>YOUR LOG</Label>
        <GlassCard style={styles.card}>
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel="Open your concert log"
            onPress={() => router.push('/saved?view=been')}
            style={styles.row}>
            <Ionicons name="checkmark-done" size={24} color={theme.cyan} />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">
                {attended.length === 0
                  ? 'No shows logged yet'
                  : `${attended.length} ${attended.length === 1 ? 'show' : 'shows'} logged`}
              </ThemedText>
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                PRIVATE TO YOU · ON MY SHOWS, UNDER BEEN
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
          </PressableScale>
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel="Log a show you went to"
            onPress={() => router.push('/log-show')}
            style={[styles.logBtn, { borderColor: theme.primaryEdge, backgroundColor: theme.primaryFill }]}>
            <Ionicons name="add" size={18} color={theme.primary} />
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              LOG A SHOW
            </ThemedText>
          </PressableScale>
        </GlassCard>

        {/* Next, because it is what the rest depends on: following and saving
            need an account. */}
        <Label>ACCOUNT</Label>
        <GlassCard style={styles.card}>
          <PressableScale
            haptic
            accessibilityRole="button"
            accessibilityLabel={signedIn ? 'Manage your account' : 'Sign in'}
            onPress={() => router.push('/sign-in')}
            style={styles.row}>
            <Ionicons
              name={signedIn ? 'person-circle' : 'person-circle-outline'}
              size={26}
              color={signedIn ? theme.primary : theme.textTertiary}
            />
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">
                {loading ? 'Checking…' : signedIn ? (displayName ?? 'Your account') : 'Not signed in'}
              </ThemedText>
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                {signedIn ? 'MANAGE OR SIGN OUT' : 'NEEDED TO FOLLOW, SAVE AND LOG SHOWS'}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
          </PressableScale>
        </GlassCard>

        <Label>REMINDERS</Label>
        <GlassCard style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText type="smallBold">Show reminders</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {persisted
                  ? 'A heads-up the day before a followed artist plays near you.'
                  : 'A heads-up the day before a followed artist plays near you. Lasts this session — sign in to keep it.'}
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
        {!persisted && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.radiusNote}>
            A change here lasts this session. Sign in to keep it — settings live with your account.
          </ThemedText>
        )}
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
          <Pressable
            onPress={() => router.push('/search')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Find artists to follow"
            style={styles.addBtn}>
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
                  accessibilityRole="button"
                  accessibilityLabel={`Unfollow ${f.name}`}
                  style={[styles.removeBtn, { backgroundColor: theme.backgroundHigh }]}>
                  <Ionicons name="close" size={16} color={theme.textSecondary} />
                </PressableScale>
              </View>
            ))}
          </GlassCard>
        )}

        <ThemedText type="labelSm" style={[styles.footer, { color: theme.textTertiary }]}>
          {signedIn ? 'MARQUEE · YOUR LISTS LIVE ON YOUR ACCOUNT' : 'MARQUEE · SIGN IN TO KEEP YOUR LISTS'}
        </ThemedText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.one },
  title: { marginBottom: Spacing.two },
  profileBlock: { marginBottom: Spacing.two },
  sectionLabel: { letterSpacing: 1.5, marginTop: Spacing.three, marginBottom: Spacing.two },
  card: { padding: Spacing.three, gap: Spacing.two },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  listCard: { padding: 0, overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  radiusNote: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  radiusRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  radiusPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 4,
    // A selection chip, so pill — matching its name and the Segmented control.
    borderRadius: Radius.pill,
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
