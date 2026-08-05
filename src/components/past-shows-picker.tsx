import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * "Have you seen them before?" — the artist page's door into the log flow.
 *
 * This used to be the whole flow: an in-page list where a tap silently toggled
 * attendance and nobody was ever asked what the night was like. Now it opens
 * the log-show modal at this artist's nights (which fires the one upstream
 * history request on entry), and picking a night lands on the rate/review
 * sheet. One CTA, no in-page state.
 */
export function PastShowsPicker({
  artistId,
  artistName,
  artistImageUrl,
}: {
  artistId: string;
  artistName: string;
  artistImageUrl: string | null;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <PressableScale
        haptic
        accessibilityRole="button"
        accessibilityLabel={`Log a past ${artistName} show you went to`}
        onPress={() =>
          router.push(
            `/log-show?artistId=${encodeURIComponent(artistId)}&artistName=${encodeURIComponent(
              artistName,
            )}${artistImageUrl ? `&artistImageUrl=${encodeURIComponent(artistImageUrl)}` : ''}`,
          )
        }
        style={[styles.cta, { borderColor: theme.border }]}>
        <Ionicons name="time-outline" size={18} color={theme.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText type="smallBold">Seen {artistName} before?</ThemedText>
          <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
            LOG THE NIGHT AND RATE IT
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.three },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
