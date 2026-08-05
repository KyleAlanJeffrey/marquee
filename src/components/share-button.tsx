import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onPress = async () => {
    const outcome = await share(payload);
    if (outcome === 'copied') {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Link copied' : `Share ${subject}`}
      onPress={onPress}
      style={style}>
      <Ionicons
        name={copied ? 'checkmark' : 'share-outline'}
        size={size}
        color={copied ? theme.primary : (color ?? theme.cyan)}
      />
    </PressableScale>
  );
}
