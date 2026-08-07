import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EventMapList } from '@/components/event-map-list';
import { PageMeta } from '@/components/page-meta';
import { PressableScale } from '@/components/pressable-scale';
import { StageBackground } from '@/components/stage-background';
import { MAPBOX_TOKEN } from '@/components/static-map';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Glow, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFollowedVenues } from '@/lib/followed-venues-store';
import { formatEventDate, formatTime } from '@/lib/format';
import { useNearbyVenues, useVenueUpcoming } from '@/hooks/queries';
import { parseCoords, parseRadius } from '@/lib/params';

// Load Mapbox GL (JS + CSS) from the CDN once, on demand — keeps it out of the
// bundle and off native (this file is web-only).
let loader: Promise<any> | null = null;
function loadMapbox(): Promise<any> {
  const w = window as any;
  if (w.mapboxgl) return Promise.resolve(w.mapboxgl);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://api.mapbox.com/mapbox-gl-js/v3.9.1/mapbox-gl.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://api.mapbox.com/mapbox-gl-js/v3.9.1/mapbox-gl.js';
    s.async = true;
    s.onload = () => resolve(w.mapboxgl);
    s.onerror = (err) => {
      // Don't cache the failure — a later visit should be able to retry.
      loader = null;
      reject(err);
    };
    document.head.appendChild(s);
  });
  return loader;
}

/**
 * A pin: one venue, at the coordinates the server gave it.
 *
 * Pins used to be derived by grouping a 400-row page of *events* by venue
 * coordinate, which made the map's coverage a side effect of an event feed's
 * page size — a room whose shows fell past row 400 had no pin at all, and
 * drawing a dot cost that venue's whole lineup up front. `/venues/nearby`
 * answers what a map is actually asking, and `useVenueUpcoming` fills in
 * what's on for the one room somebody clicks. Mirrors map.tsx.
 */
type VenuePin = {
  key: string;
  venueId: string;
  lat: number;
  lng: number;
  name: string;
  /** `/venues/:id/events` doesn't carry a zone; the venue rows do. */
  timezone: string | null;
  upcoming: number;
  following: boolean;
};

/** See map.tsx — a map wants pins, not the dozen busiest rooms. */
const MAP_VENUE_LIMIT = 200;

export default function MapScreen() {
  const theme = useTheme();
  const { lat, lng, radius } = useLocalSearchParams<{ lat: string; lng: string; radius: string }>();
  const coords = parseCoords(lat, lng);
  const radiusMiles = parseRadius(radius);

  const venues = useNearbyVenues(coords, radiusMiles, MAP_VENUE_LIMIT);
  // Highlights a followed *venue*, which is what a venue pin marks — the old
  // colouring meant "a followed artist plays here", and needed every pin's
  // lineup in hand before it could choose the colour of a dot.
  const { isFollowingVenue } = useFollowedVenues();
  const { width, height } = useWindowDimensions();
  // A callback ref (not useRef) so the init effect re-runs once the DOM node is
  // actually attached — a plain ref can still be null on the first effect pass.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const glRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  // The failure is stored *with the location it belongs to* and derived from
  // there, rather than as a sticky boolean: a transient GL failure used to
  // outlive a location change with no way back — the fallback branch never
  // mounts the container, so no effect could ever run to reset it.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const coordsKey = coords ? `${coords.lat},${coords.lng}` : null;
  const loadFailed = failedFor !== null && failedFor === coordsKey;
  // The selection is stored by key and resolved from the current groups, so a
  // venue that drops out of the feed closes the sheet on its own.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // One pin per spot: rooms sharing a building share a coordinate, and two
  // overlapping dots are one dot with a worse hit area. `/venues/nearby` comes
  // back busiest first, so the first to claim a coordinate names it.
  const groups = useMemo(() => {
    const m = new Map<string, VenuePin>();
    for (const v of venues.data ?? []) {
      if (v.lat == null || v.lng == null) continue;
      const key = `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`;
      const existing = m.get(key);
      if (existing) {
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
  const lineup = useVenueUpcoming(selected?.venueId ?? null);
  const shows = lineup.data?.items ?? [];

  // Create the map once per location. Markers are a separate effect — rebuilding
  // the map whenever the event list or follow state changed would throw away the
  // user's pan/zoom.
  useEffect(() => {
    if (!MAPBOX_TOKEN || !coords || !container) return;
    let map: any;
    let cancelled = false;
    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled) return;
        glRef.current = mapboxgl;
        mapboxgl.accessToken = MAPBOX_TOKEN;
        map = new mapboxgl.Map({
          container,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [coords.lng, coords.lat],
          zoom: 11,
          attributionControl: false,
        });
        mapRef.current = map;
        // Pins are DOM overlays, so they only need the style — waiting for the
        // full 'load' (which needs a completed first paint) can leave a map with
        // no pins on a slow or software-rendered client.
        const styleReady = () => {
          if (cancelled) return;
          map.resize();
          setReady(true);
        };
        let styled = false;
        const styleReadyOnce = () => {
          styled = true;
          styleReady();
        };
        if (map.isStyleLoaded()) styleReadyOnce();
        else map.once('style.load', styleReadyOnce);
        // A bad token or an unreachable style fails asynchronously, long after
        // loadMapbox() resolved. Only failures before the style lands are fatal
        // — GL also emits 'error' for a single missing tile on a live map.
        map.on('error', (e: { error?: Error }) => {
          console.warn('mapbox error:', e?.error ?? e);
          if (!cancelled && !styled) setFailedFor(coordsKey);
        });
        map.on('click', () => setSelectedKey(null));
      })
      .catch(() => {
        // GL couldn't load (offline, blocked CDN) — fall back to the list.
        if (!cancelled) setFailedFor(coordsKey);
      });
    return () => {
      cancelled = true;
      setReady(false);
      markersRef.current = [];
      fittedRef.current = false;
      mapRef.current = null;
      if (map) map.remove();
    };
    // coords is rebuilt each render from params; depend on its stable primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, coords?.lat, coords?.lng]);

  // Pins: redraw on data/follow changes, leaving the camera where the user put it.
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = glRef.current;
    if (!ready || !map || !mapboxgl) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    for (const g of groups) {
      // Followed artists take the primary lime so they read first; everything
      // else sits back in the supporting cyan.
      const color = g.following ? theme.primary : theme.cyanSoft;
      const el = document.createElement('div');
      el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:2px solid ${theme.backgroundLowest};box-shadow:0 0 10px ${color};cursor:pointer;`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSelectedKey(g.key);
        map.flyTo({ center: [g.lng, g.lat], zoom: Math.max(map.getZoom(), 13), duration: 500 });
      });
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map));
      bounds.extend([g.lng, g.lat]);
    }

    // Frame the pins on the first load only.
    if (groups.length > 1 && !fittedRef.current) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 0 });
      fittedRef.current = true;
    }
    // The three theme tokens are listed because the pin markup reads them; the
    // palette is a module constant, so in practice they never re-fire this.
  }, [groups, ready, theme.primary, theme.cyanSoft, theme.backgroundLowest]);

  // Keep the GL canvas sized to the window.
  useEffect(() => {
    mapRef.current?.resize();
  }, [width, height]);

  // No token, GL failed to load, or no usable location in the URL → the shared
  // static-map + list fallback.
  if (!MAPBOX_TOKEN || loadFailed || !coords) {
    return (
      <View style={{ flex: 1 }}>
        <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
        <StageBackground />
        {coords ? (
          <EventMapList coords={coords} radius={radiusMiles} />
        ) : (
          <View style={styles.noCoords}>
            <ThemedText themeColor="textSecondary">Pick a location on Browse to map the shows around it.</ThemedText>
          </View>
        )}
        <View style={styles.topBar}>
          <TopBar back title="Map" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <PageMeta title="Concert map" description="Every upcoming concert near you, plotted on a map by venue." />
      {/* Mapbox GL renders into this DOM node (explicit px size so its 100%
          children resolve to a real height) */}
      <View ref={setContainer as never} style={{ width, height }} />

      <View style={styles.topBar}>
        <TopBar transparent back title="Map" />
      </View>

      {selected && (
        <View style={[styles.sheet, { backgroundColor: theme.glass, borderColor: theme.border }, Glow.cyan]}>
          <View style={styles.sheetHead}>
            {/* The venue is the link, not a label — opening its page is why
                anyone clicks a pin. Manual venues have no page and stay text. */}
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
              onPress={() => setSelectedKey(null)}>
              <Ionicons name="close" size={20} color={theme.textTertiary} />
            </PressableScale>
          </View>
          {/* Fetched on the click that opens this. The room's own count is
              already known, so the wait never reads as an empty venue. */}
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
              {shows.slice(0, 5).map((e) => (
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
              {selected.upcoming > shows.slice(0, 5).length && (
                <ThemedText type="labelSm" style={{ color: theme.textTertiary, textAlign: 'center' }}>
                  +{selected.upcoming - shows.slice(0, 5).length} MORE AT THIS VENUE
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
  // Reserved so the sheet doesn't jump when the lineup lands under the cursor.
  sheetLoading: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  sheetNote: { minHeight: 72, textAlign: 'center', paddingTop: Spacing.three },
  noCoords: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  sheet: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.four,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetVenue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
  },
});
