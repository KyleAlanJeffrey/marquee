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
 * Route a tapped concert reminder. Every reminder carries `eventId` (the show
 * page is what "Tap for tickets" promises); followed-artist reminders also
 * carry `artistId`, which we fall back to.
 */
function handleNotificationResponse(response: Notifications.NotificationResponse) {
  const { eventId, artistId } = response.notification.request.content.data ?? {};
  if (typeof eventId === 'string' && eventId.length > 0) {
    router.push(`/event/${eventId}`);
  } else if (typeof artistId === 'string' && artistId.length > 0) {
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
