import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { StaticMap, type MapPoint } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type MapPin = MapPoint;

type Props = {
  pins: MapPin[];
  locationLabel: string | null;
  withinMiles: number | null;
  onExplore?: () => void;
};

/**
 * "Nearby Venues" map: a real Mapbox map (or stylized grid fallback) of the
 * nearby venue pins, with a location + distance + explore overlay.
 */
export function VenueMap({ pins, locationLabel, withinMiles, onExplore }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { borderColor: theme.border }, Glow.cyan, { shadowOpacity: 0.15 }]}>
      <StaticMap points={pins} />

      {/* Bottom overlay: location + distance + explore */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.overlay}>
        <View style={styles.overlayRow}>
          <View style={[styles.nearIcon, { backgroundColor: 'rgba(0,219,233,0.15)', borderColor: 'rgba(0,219,233,0.3)' }]}>
            <Ionicons name="navigate" size={18} color={theme.cyan} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={{ color: '#fff' }} numberOfLines={1}>
              {locationLabel ?? 'Your area'}
            </ThemedText>
            <ThemedText type="labelSm" style={{ color: theme.textSecondary }}>
              {withinMiles != null
                ? `You're within ${withinMiles} ${withinMiles === 1 ? 'mile' : 'miles'}`
                : 'Live shows near you'}
            </ThemedText>
          </View>
          <PressableScale
            haptic={false}
            onPress={onExplore}
            style={[styles.exploreBtn, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: theme.border }]}>
            <ThemedText type="label" style={{ color: '#fff', fontSize: 12 }}>
              Explore Area
            </ThemedText>
          </PressableScale>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 224,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  overlayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  nearIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
