import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NearbyEvent } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const OWNED_PREFIX = 'concert:'; // identifier namespace for reminders we schedule

/**
 * Ask for notification permission (idempotent). Returns whether it's granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status === 'granted' && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('concerts', {
      name: 'Concert reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  return status === 'granted';
}

/**
 * Schedule a single "Remind Me" notification (a day before, else at show time)
 * for an event the user isn't necessarily following. Returns whether it was set.
 */
export async function scheduleOneOffReminder(event: {
  event_id: string;
  artist_name: string;
  venue_name: string | null;
  venue_city: string | null;
  starts_at: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  const when = reminderDate(event.starts_at) ?? new Date(Date.now() + 60_000);
  const where = event.venue_city ?? event.venue_name ?? 'near you';
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `${OWNED_PREFIX}${event.event_id}`,
      content: {
        title: `${event.artist_name} — show reminder`,
        body: `${event.venue_name ?? 'A venue'} in ${where}. Tap for tickets.`,
        data: { eventId: event.event_id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    return true;
  } catch {
    return false;
  }
}

function reminderDate(startsAt: string): Date | null {
  const showTime = new Date(startsAt).getTime();
  // A day before the show, but never in the past.
  const when = showTime - DAY_MS;
  if (Number.isNaN(when) || when <= Date.now()) return null;
  return new Date(when);
}

/**
 * Reconcile scheduled local reminders with the caller's current set of
 * followed upcoming shows. Cancels everything we own and reschedules from
 * scratch — simple and always correct, and the counts here are small.
 *
 * When `enabled` is false, it just clears our reminders.
 */
export async function syncConcertReminders(
  events: NearbyEvent[],
  enabled: boolean,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(OWNED_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );

    if (!enabled) return;

    for (const e of events) {
      const when = reminderDate(e.starts_at);
      if (!when) continue;
      const where = e.venue_city ?? e.venue_name ?? 'near you';
      await Notifications.scheduleNotificationAsync({
        identifier: `${OWNED_PREFIX}${e.event_id}`,
        content: {
          title: `${e.artist_name} plays tomorrow`,
          body: `${e.venue_name ?? 'A venue'} in ${where}. Tap for tickets.`,
          data: { eventId: e.event_id, artistId: e.artist_id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    }
  } catch (err) {
    console.warn('failed to sync concert reminders:', err);
  }
}
