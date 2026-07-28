import { Alert, Linking, Platform } from 'react-native';

/**
 * Open an external link (tickets, Spotify, socials). `Linking.openURL` rejects
 * when nothing can handle the URL, so every call site goes through here rather
 * than leaving a floating promise — and the user gets told instead of nothing
 * happening.
 */
export function openUrl(url: string | null | undefined): void {
  if (!url) return;
  Linking.openURL(url).catch(() => {
    const message = "That link couldn't be opened.";
    if (Platform.OS === 'web') console.warn(message, url);
    else Alert.alert('Link unavailable', message);
  });
}
