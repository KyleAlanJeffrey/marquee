import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EventMapList } from '@/components/event-map-list';
import { PageMeta } from '@/components/page-meta';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { parseCoords, parseRadius } from '@/lib/params';

export default function MapScreen() {
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords = parseCoords(lat, lng);

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
      <StageBackground />
      {coords ? (
        <EventMapList coords={coords} radius={parseRadius(radius)} />
      ) : (
        // Same answer the web map gives: arriving here without a point is a
        // dead end only if the screen stays silent about it.
        <View style={styles.noCoords}>
          <ThemedText themeColor="textSecondary">
            Pick a location on Browse to map the shows around it.
          </ThemedText>
        </View>
      )}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <TopBar back title="Map" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  noCoords: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.five },
});
