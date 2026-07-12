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
 * Route a tapped concert reminder to the relevant artist. Reminders carry
 * `artistId` (and `eventId`); the artist page lists the show.
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
