import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useProfile, useSetHomeLocation, useUpdateProfile } from '@/lib/hooks';
import { getCurrentCoords, reverseGeocodeLabel } from '@/lib/location';
import { registerForPushNotifications } from '@/lib/notifications';

const RADII = [25, 50, 100, 250] as const;

export default function SettingsScreen() {
  const theme = useTheme();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const setHome = useSetHomeLocation();
  const [settingHome, setSettingHome] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);

  async function handleSetHome() {
    setSettingHome(true);
    try {
      const coords = await getCurrentCoords();
      if (!coords) {
        Alert.alert('Location unavailable', 'Allow location access in system settings first.');
        return;
      }
      const label = await reverseGeocodeLabel(coords);
      await setHome.mutateAsync({ coords, label });
    } finally {
      setSettingHome(false);
    }
  }

  async function handleEnablePush() {
    setEnablingPush(true);
    try {
      const token = await registerForPushNotifications();
      if (!token) {
        Alert.alert(
          'Notifications unavailable',
          'Push notifications need a physical device with permission granted (and an EAS project in dev builds).',
        );
        return;
      }
      await updateProfile.mutateAsync({ expo_push_token: token });
    } finally {
      setEnablingPush(false);
    }
  }

  if (profile.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const p = profile.data;

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Home location */}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          HOME AREA
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{p?.home_label ?? (setHome.isSuccess ? 'Set' : 'Not set')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Concert alerts only fire for shows near your home area.
          </ThemedText>
          <Pressable
            onPress={handleSetHome}
            disabled={settingHome}
            style={[styles.button, { backgroundColor: theme.tint }]}>
            {settingHome ? (
              <ActivityIndicator size="small" color={theme.onTint} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.onTint }}>
                Use my current location
              </ThemedText>
            )}
          </Pressable>
        </View>

        {/* Radius */}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          ALERT RADIUS
        </ThemedText>
        <View style={styles.radiusRow}>
          {RADII.map((r) => {
            const selected = p?.notify_radius_miles === r;
            return (
              <Pressable
                key={r}
                onPress={() => updateProfile.mutate({ notify_radius_miles: r })}
                style={[
                  styles.radiusPill,
                  { backgroundColor: selected ? theme.tint : theme.backgroundElement },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: selected ? theme.onTint : theme.text }}>
                  {r} mi
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {/* Notifications */}
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          NOTIFICATIONS
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>
            {p?.expo_push_token ? 'Enabled on this device' : 'Not enabled'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Get a push when an artist you follow announces a show in your area.
          </ThemedText>
          {!p?.expo_push_token && (
            <Pressable
              onPress={handleEnablePush}
              disabled={enablingPush}
              style={[styles.button, { backgroundColor: theme.tint }]}>
              {enablingPush ? (
                <ActivityIndicator size="small" color={theme.onTint} />
              ) : (
                <ThemedText type="smallBold" style={{ color: theme.onTint }}>
                  Enable notifications
                </ThemedText>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { letterSpacing: 1, fontSize: 12, marginTop: Spacing.three },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    marginTop: Spacing.one,
  },
  radiusRow: { flexDirection: 'row', gap: Spacing.two },
  radiusPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
