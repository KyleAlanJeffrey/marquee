import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollows } from '@/lib/follows-store';
import { formatEventDate, formatTime } from '@/lib/format';
import { useNearbyEvents } from '@/hooks/queries';
import { parseCoords, parseRadius } from '@/lib/params';
import type { NearbyEvent } from '@/lib/types';

/**
 * The map, on a phone: a real interactive MapView (Apple Maps on iOS — no
 * token, no tile bill) instead of the old 300-pixel static image above a list.
 * Full screen because that's what a map is for; one pin per venue because
 * events stack there; and the sheet a pin opens names the venue as a link,
 * which is the whole reason someone taps a pin. The web file mirrors this
 * with Mapbox GL.
 *
 * Pin taps are hit-tested in JS from the map's own onPress coordinate rather
 * than through Marker onPress: under Expo Go's New Architecture the markers'
 * native press events never arrive (and image-based default pins don't render
 * at all — measured on SDK 56), while onPress + custom marker children work
 * everywhere. It also buys a bigger tap radius than the 16-point dot itself.
 *
 * Android note: Expo Go carries its own Google Maps key, so this works there,
 * but a *standalone* Android build needs `android.config.googleMaps.apiKey`
 * in app.json — parked with the Play-store setup in todo.md.
 */
type VenueGroup = {
  key: string;
  venueId: string | null;
  lat: number;
  lng: number;
  name: string;
  events: NearbyEvent[];
  following: boolean;
};

export default function MapScreen() {
  const theme = useTheme();
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords = parseCoords(lat, lng);
  const radiusMiles = parseRadius(radius);

  const events = useNearbyEvents(coords, radiusMiles);
  const { isFollowing } = useFollows();
  const { width, height } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const fittedRef = useRef(false);
  // The visible region, for converting a tapped coordinate into screen points.
  // A ref, not state: it changes on every pan frame and nothing renders from it.
  const regionRef = useRef<Region | null>(null);
  // Stored by key and resolved from the current groups, so a venue that drops
  // out of the feed closes the sheet on its own — same shape as the web map.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const all = useMemo(() => events.data?.items ?? [], [events.data]);
  const ref = (e: NearbyEvent) => ({ artistId: e.artist_id, spotifyId: e.artist_spotify_id });

  // One pin per venue (events stack there). Keyed by rounded coordinates, not
  // venue id, so two rooms of one building don't draw two overlapping pins.
  const groups = useMemo(() => {
    const m = new Map<string, VenueGroup>();
    for (const e of all) {
      if (e.venue_lat == null || e.venue_lng == null) continue;
      const key = `${e.venue_lat.toFixed(4)},${e.venue_lng.toFixed(4)}`;
      const g =
        m.get(key) ??
        {
          key,
          venueId: e.venue_id ?? null,
          lat: e.venue_lat,
          lng: e.venue_lng,
          name: e.venue_name ?? 'Venue',
          events: [],
          following: false,
        };
      g.events.push(e);
      if (isFollowing(ref(e))) g.following = true;
      m.set(key, g);
    }
    return [...m.values()];
  }, [all, isFollowing]);

  const selected = groups.find((g) => g.key === selectedKey) ?? null;

  // The JS stand-in for marker presses (see the header comment): take the
  // tapped coordinate, measure each pin's distance from it in screen points at
  // the current zoom, and select the nearest pin within a finger's reach.
  const onMapPress = (tap: { latitude: number; longitude: number }) => {
    // Before the first settle reports in, fall back to initialRegion's shape.
    const region =
      regionRef.current ??
      (coords
        ? { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.25, longitudeDelta: 0.25 }
        : null);
    if (!region || groups.length === 0) {
      setSelectedKey(null);
      return;
    }
    const TAP_RADIUS_PTS = 28;
    let best: VenueGroup | null = null;
    let bestDist = Infinity;
    for (const g of groups) {
      const dx = ((g.lng - tap.longitude) / region.longitudeDelta) * width;
      const dy = ((g.lat - tap.latitude) / region.latitudeDelta) * height;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = g;
      }
    }
    if (best && bestDist <= TAP_RADIUS_PTS) {
      setSelectedKey(best.key);
      mapRef.current?.animateCamera(
        { center: { latitude: best.lat, longitude: best.lng } },
        { duration: 350 },
      );
    } else {
      setSelectedKey(null);
    }
  };

  // Frame the pins once per visit; after that the camera belongs to the user.
  useEffect(() => {
    if (fittedRef.current || groups.length === 0 || !mapRef.current) return;
    fittedRef.current = true;
    mapRef.current.fitToCoordinates(
      groups.map((g) => ({ latitude: g.lat, longitude: g.lng })),
      { edgePadding: { top: 120, right: 60, bottom: 120, left: 60 }, animated: false },
    );
  }, [groups]);

  if (!coords) {
    return (
      <View style={{ flex: 1 }}>
        <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
        <StageBackground />
        <View style={styles.noCoords}>
          <ThemedText themeColor="textSecondary">
            Pick a location on Browse to map the shows around it.
          </ThemedText>
        </View>
        <View style={styles.topBar}>
          <TopBar back title="Map" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle="dark"
        initialRegion={{
          latitude: coords.lat,
          longitude: coords.lng,
          latitudeDelta: 0.25,
          longitudeDelta: 0.25,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        onRegionChangeComplete={(region) => {
          regionRef.current = region;
        }}
        onPress={(ev) => onMapPress(ev.nativeEvent.coordinate)}>
        {groups.map((g) => {
          // Followed artists take the primary lime so they read first;
          // everything else sits back in the supporting cyan. The markers are
          // purely visual — taps arrive through the map's onPress above.
          const color = g.following ? theme.primary : theme.cyanSoft;
          const active = g.key === selectedKey;
          return (
            <Marker
              // The active half of the key remounts the marker when selection
              // changes: with tracksViewChanges off, iOS rasterizes the child
              // once, so a style-only change would never reach the screen.
              key={`${g.key}:${active ? 1 : 0}`}
              coordinate={{ latitude: g.lat, longitude: g.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}>
              <View
                style={[
                  styles.pinDot,
                  active && styles.pinDotActive,
                  { backgroundColor: color, shadowColor: color, borderColor: theme.backgroundLowest },
                ]}
              />
            </Marker>
          );
        })}
      </MapView>

      <View style={styles.topBar}>
        <TopBar transparent back title="Map" />
      </View>

      {selected && (
        <View style={[styles.sheet, { backgroundColor: theme.glass, borderColor: theme.border }, Glow.cyan]}>
          <View style={styles.sheetHead}>
            {/* The venue is the link, not a label — opening its page is why
                anyone taps a pin. Manual venues have no page and stay text. */}
            {selected.venueId ? (
              <PressableScale
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel={`Open ${selected.name}`}
                onPress={() => router.push(`/venue/${selected.venueId}`)}
                style={styles.sheetVenue}>
                <Ionicons name="location" size={16} color={theme.cyan} />
                <ThemedText type="title" numberOfLines={1} style={{ flex: 1, fontSize: 18 }}>
                  {selected.name}
                </ThemedText>
                <Ionicons name="chevron-forward" size={18} color={theme.cyan} />
              </PressableScale>
            ) : (
              <View style={styles.sheetVenue}>
                <Ionicons name="location" size={16} color={theme.cyan} />
                <ThemedText type="title" numberOfLines={1} style={{ flex: 1, fontSize: 18 }}>
                  {selected.name}
                </ThemedText>
              </View>
            )}
            <PressableScale
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Close the venue details"
              onPress={() => setSelectedKey(null)}
              style={styles.sheetClose}>
              <Ionicons name="close" size={20} color={theme.textTertiary} />
            </PressableScale>
          </View>
          {selected.events.slice(0, 4).map((e) => (
            <PressableScale
              key={e.event_id}
              onPress={() => router.push(`/event/${e.event_id}`)}
              style={[styles.row, { borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {e.artist_name}
                </ThemedText>
                <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                  {e.time_unknown
                    ? formatEventDate(e.starts_at, e.venue_timezone)
                    : `${formatEventDate(e.starts_at, e.venue_timezone)} · ${formatTime(e.starts_at, e.venue_timezone)}`}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
            </PressableScale>
          ))}
          {selected.events.length > 4 && (
            <ThemedText type="labelSm" style={{ color: theme.textTertiary, textAlign: 'center' }}>
              +{selected.events.length - 4} MORE AT THIS VENUE
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  noCoords: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  pinDotActive: { width: 22, height: 22, borderRadius: 11 },
  sheet: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.four,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetVenue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
  },
});
