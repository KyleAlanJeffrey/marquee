import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollowedVenues } from '@/lib/followed-venues-store';
import { formatEventDate, formatTime } from '@/lib/format';
import { useNearbyVenues, useVenueUpcoming } from '@/hooks/queries';
import { parseCoords, parseRadius } from '@/lib/params';

/**
 * The map, on a phone: a real interactive MapView (Apple Maps on iOS — no
 * token, no tile bill) instead of the old 300-pixel static image above a list.
 * Full screen because that's what a map is for, and the sheet a pin opens names
 * the venue as a link, which is the whole reason someone taps a pin. The web
 * file mirrors this with Mapbox GL.
 *
 * **Pins are venues, and the lineup is fetched on the tap that reads it.** They
 * used to be derived by grouping a 400-row page of *events* by venue
 * coordinate, which got the relationship backwards: the map's coverage became a
 * side effect of an event feed's page size, so a room whose shows fell past row
 * 400 simply had no pin, and drawing a dot cost that venue's entire lineup up
 * front. `/venues/nearby` answers the question a map is actually asking — which
 * rooms are here, and where — and `useVenueUpcoming` answers "what's on" once,
 * for the one venue somebody chose.
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
/** A pin. One venue, with the coordinates the server gave it. */
type VenuePin = {
  key: string;
  venueId: string;
  lat: number;
  lng: number;
  name: string;
  /** The zone the shows happen in — a 23:00 gig in London is not a 3pm gig.
   *  The venue rows carry it; `/venues/:id/events` doesn't, so it rides here. */
  timezone: string | null;
  upcoming: number;
  following: boolean;
};

/**
 * How many rooms a map asks for. The server caps this at 200 and scans no more
 * than that either way; a map that stops short just has holes, and nothing on
 * screen tells you whether an empty patch is quiet or truncated.
 */
const MAP_VENUE_LIMIT = 200;

export default function MapScreen() {
  const theme = useTheme();
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords = parseCoords(lat, lng);
  const radiusMiles = parseRadius(radius);

  const venues = useNearbyVenues(coords, radiusMiles, MAP_VENUE_LIMIT);
  // A venue pin highlights a followed *venue*. It used to light up when a
  // followed artist happened to be playing there, which needed every pin's
  // lineup loaded in advance to decide the colour of a dot — and said something
  // about the night rather than about the room the pin marks.
  const { isFollowingVenue } = useFollowedVenues();
  const { width, height } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const fittedRef = useRef(false);
  // The visible region, for converting a tapped coordinate into screen points.
  // A ref, not state: it changes on every pan frame and nothing renders from it.
  const regionRef = useRef<Region | null>(null);
  // Stored by key and resolved from the current groups, so a venue that drops
  // out of the feed closes the sheet on its own — same shape as the web map.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // fitToCoordinates silently no-ops before the native map has laid out, and
  // cached query data can win that race — so the fit waits for onMapReady.
  const [mapReady, setMapReady] = useState(false);

  // Keyed by rounded coordinates rather than venue id, so two rooms of one
  // building don't draw two pins on the same spot. The busiest room wins the
  // pin — `/venues/nearby` returns them busiest first, so the first to claim a
  // coordinate is the one worth naming.
  const groups = useMemo(() => {
    const m = new Map<string, VenuePin>();
    for (const v of venues.data ?? []) {
      if (v.lat == null || v.lng == null) continue;
      const key = `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`;
      const existing = m.get(key);
      if (existing) {
        // Still worth counting: the sheet says how many nights are on at this
        // spot, and a shared building's rooms are one spot to whoever taps it.
        existing.upcoming += v.upcoming;
        existing.following ||= isFollowingVenue({ venueId: v.id });
        continue;
      }
      m.set(key, {
        key,
        venueId: v.id,
        lat: v.lat,
        lng: v.lng,
        name: v.name,
        timezone: v.timezone,
        upcoming: v.upcoming,
        following: isFollowingVenue({ venueId: v.id }),
      });
    }
    return [...m.values()];
  }, [venues.data, isFollowingVenue]);

  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  // Only the chosen room's lineup, and only once chosen.
  const lineup = useVenueUpcoming(selected?.venueId ?? null);
  const shows = lineup.data?.items ?? [];

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
    let best: VenuePin | null = null;
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
    if (!mapReady || fittedRef.current || groups.length === 0 || !mapRef.current) return;
    fittedRef.current = true;
    mapRef.current.fitToCoordinates(
      groups.map((g) => ({ latitude: g.lat, longitude: g.lng })),
      { edgePadding: { top: 120, right: 60, bottom: 120, left: 60 }, animated: false },
    );
  }, [groups, mapReady]);

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
        onMapReady={() => setMapReady(true)}
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
          {/* The lineup arrives after the tap, so the sheet opens immediately
              with the room's name and holds this space while it loads. The
              venue's own upcoming count is already known, so the wait never
              looks like an empty venue. */}
          {lineup.isPending ? (
            <View style={styles.sheetLoading}>
              <ActivityIndicator color={theme.cyan} />
              <ThemedText type="labelSm" style={{ color: theme.textTertiary }}>
                {selected.upcoming} {selected.upcoming === 1 ? 'SHOW' : 'SHOWS'} COMING UP
              </ThemedText>
            </View>
          ) : lineup.isError ? (
            <ThemedText type="labelSm" style={styles.sheetNote}>
              Couldn&apos;t load what&apos;s on here.
            </ThemedText>
          ) : shows.length === 0 ? (
            <ThemedText type="labelSm" style={styles.sheetNote}>
              Nothing on sale here right now.
            </ThemedText>
          ) : (
            <>
              {shows.slice(0, 4).map((e) => (
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
                        ? formatEventDate(e.starts_at, selected.timezone)
                        : `${formatEventDate(e.starts_at, selected.timezone)} · ${formatTime(e.starts_at, selected.timezone)}`}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                </PressableScale>
              ))}
              {selected.upcoming > shows.slice(0, 4).length && (
                <ThemedText type="labelSm" style={{ color: theme.textTertiary, textAlign: 'center' }}>
                  +{selected.upcoming - shows.slice(0, 4).length} MORE AT THIS VENUE
                </ThemedText>
              )}
            </>
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
  // Tall enough that the sheet doesn't resize under the finger when the lineup
  // lands — the pin it belongs to would slide out from under the tap.
  sheetLoading: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  sheetNote: { minHeight: 72, textAlign: 'center', textAlignVertical: 'center', paddingTop: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
  },
});
