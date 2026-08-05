import { Platform, Share } from 'react-native';

import type { SharePayload } from '@/lib/share-payload';

export { eventShare, SITE_ORIGIN, type SharePayload } from '@/lib/share-payload';

export type ShareOutcome =
  /** The platform share sheet took it. */
  | 'shared'
  /** No share sheet here (desktop web) — the link went to the clipboard. */
  | 'copied'
  /** The person opened the sheet and changed their mind. Not a failure. */
  | 'dismissed'
  /** Nothing on this platform could share or copy. */
  | 'unavailable';

/**
 * Share through whatever this platform has, gracefully downgrading: the
 * native sheet, the mobile-web sheet, or the clipboard. The caller renders
 * the outcome — 'copied' needs saying out loud, because nothing visible
 * happened.
 */
export async function share({ url, title, message }: SharePayload): Promise<ShareOutcome> {
  if (Platform.OS !== 'web') {
    try {
      // iOS carries a separate url field; Android only reads the message, so
      // the link rides inside it there.
      const result = await Share.share(
        Platform.OS === 'ios' ? { title, message, url } : { title, message: `${message}\n${url}` },
      );
      return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'unavailable';
    }
  }

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav?.share) {
    try {
      await nav.share({ title, text: message, url });
      return 'shared';
    } catch (err) {
      // Closing the sheet rejects with AbortError; that is a choice, not a
      // failure — and not a reason to also copy to their clipboard.
      if ((err as Error)?.name === 'AbortError') return 'dismissed';
      // Anything else falls through to the clipboard.
    }
  }
  try {
    await nav?.clipboard?.writeText(url);
    return nav?.clipboard ? 'copied' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
