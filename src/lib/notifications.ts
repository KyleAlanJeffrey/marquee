import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for notification permission and return this device's Expo push token,
 * or null if we can't get one (simulator, permission denied, no EAS project).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Concert alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return token.data;
  } catch {
    // No EAS project configured yet — fine in local dev
    return null;
  }
}

/**
 * Route a tapped concert alert to the relevant artist. Ingest attaches
 * `artistId` (and `eventId`) to every push; the artist page lists the show.
 */
function handleNotificationResponse(response: Notifications.NotificationResponse) {
  const artistId = response.notification.request.content.data?.artistId;
  if (typeof artistId === 'string' && artistId.length > 0) {
    router.push(`/artist/${artistId}`);
  }
}

/**
 * Wire up notification-tap navigation. Handles both a tap while the app is
 * running and a cold start launched from a notification. Call once, high in
 * the tree (root layout).
 */
export function useNotificationObserver() {
  useEffect(() => {
    // Notification response APIs aren't available on web.
    if (Platform.OS === 'web') return;

    let mounted = true;

    // App launched by tapping a notification while it was killed.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (mounted && response) handleNotificationResponse(response);
    });

    // App already running (foreground/background) when the tap happens.
    const sub = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
}
