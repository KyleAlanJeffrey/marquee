import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { EventMapList } from '@/components/event-map-list';
import { PageMeta } from '@/components/page-meta';
import { StageBackground } from '@/components/stage-background';
import { TopBar } from '@/components/top-bar';
import { parseCoords, parseRadius } from '@/lib/params';

export default function MapScreen() {
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords = parseCoords(lat, lng);

  return (
    <View style={{ flex: 1 }}>
      <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
      <StageBackground />
      {coords && <EventMapList coords={coords} radius={parseRadius(radius)} />}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <TopBar back title="Map" />
      </View>
    </View>
  );
}
