import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { EventMapList } from '@/components/event-map-list';
import { MeshBackground } from '@/components/mesh-background';
import { TopBar } from '@/components/top-bar';
import type { Coords } from '@/lib/types';

export default function MapScreen() {
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords: Coords | null = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;

  return (
    <View style={{ flex: 1 }}>
      <MeshBackground />
      {coords && <EventMapList coords={coords} radius={Number(radius) || 50} />}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <TopBar back title="Map" />
      </View>
    </View>
  );
}
