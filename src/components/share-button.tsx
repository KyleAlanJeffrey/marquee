import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useTheme } from '@/hooks/use-theme';
import { share, type SharePayload } from '@/lib/share';

/**
 * One icon that hands the current page to somebody else.
 *
 * The icon itself reports the outcome: a checkmark when the link was copied
 * (desktop web has no share sheet, and a silent copy looks like a dead
 * button), and nothing special when the sheet opened — the sheet is its own
 * feedback. The checkmark reverts on its own.
 */
export function ShareButton({
  payload,
  subject,
  size = 22,
  color,
  style,
}: {
  payload: SharePayload;
  /** What is being shared, for the screen reader — "this show". */
  subject: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // 'copied' and 'failed' both need saying out loud — in either case nothing
  // visible happened, and a silent button reads as a dead one.
  const [flash, setFlash] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A relabelled button says nothing unless the screen reader happens to be
  // sitting on it — the transient states have to be announced. On web this
  // call is a no-op (react-native-web stubs it); the live region below
  // carries it there instead.
  useEffect(() => {
    if (flash) {
      AccessibilityInfo.announceForAccessibility(flashMessage(flash));
    }
  }, [flash]);

  const onPress = async () => {
    const outcome = await share(payload);
    if (outcome === 'copied' || outcome === 'unavailable') {
      setFlash(outcome === 'copied' ? 'copied' : 'failed');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), 2000);
    }
  };

  return (
    <>
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel={flash ? flashMessage(flash) : `Share ${subject}`}
        onPress={onPress}
        style={style}>
        <Ionicons
          name={flash === 'copied' ? 'checkmark' : flash === 'failed' ? 'alert-circle-outline' : 'share-outline'}
          size={size}
          color={flash === 'copied' ? theme.primary : flash === 'failed' ? theme.error : (color ?? theme.cyan)}
        />
      </PressableScale>
      {Platform.OS === 'web' && (
        <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
          {flash ? flashMessage(flash) : ''}
        </Text>
      )}
    </>
  );
}

function flashMessage(flash: 'copied' | 'failed') {
  return flash === 'copied' ? 'Link copied' : 'Sharing is not available here';
}

const styles = StyleSheet.create({
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
