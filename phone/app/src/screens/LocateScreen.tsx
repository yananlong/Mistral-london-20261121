import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { LocalTile, Marker } from 'react-native-maps';
import { useTransport } from '../transport/TransportContext';
import { usePositionContext } from '../locate/PositionContext';
import { LatLon, findLocLine, formatLocLine } from '../locate/locLine';
import {
  LONDON_REGION,
  MAP_ATTRIBUTION,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_PATH_TEMPLATE,
  bundledTilesCover,
  deltaForZoom,
} from '../locate/tiles';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

interface SharedPin {
  id: string;
  from: string;
  lat: number;
  lon: number;
}

/** Zoom-step clamps derived from the bundled zoom pyramid. */
const MIN_DELTA = deltaForZoom(MAX_ZOOM, LONDON_REGION.latitude);
const MAX_DELTA = deltaForZoom(MIN_ZOOM, LONDON_REGION.latitude) * 1.5;

export function LocateScreen() {
  const transport = useTransport();
  const position = usePositionContext();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState(LONDON_REGION);
  const [pins, setPins] = useState<SharedPin[]>([]);
  const [justShared, setJustShared] = useState(false);

  useEffect(() => {
    const unsubscribe = transport.subscribe((message) => {
      const loc = findLocLine(message.text);
      if (!loc) return;
      setPins((prev) =>
        prev.some((pin) => pin.id === message.id)
          ? prev
          : [...prev, { id: message.id, from: message.from, lat: loc.lat, lon: loc.lon }],
      );
    });
    return unsubscribe;
  }, [transport]);

  const coords: LatLon | null = position.coords;
  // Before the first fix we show the downloaded London area; after a fix we
  // check whether the tiles cover where the user actually is.
  const tilesAvailable = coords ? bundledTilesCover(coords) : true;

  function shareLocation() {
    if (!coords) return;
    transport.send('public', formatLocLine(coords));
    setJustShared(true);
  }

  /** Pan/zoom stays inside the bundled tile pyramid. */
  function zoomBy(factor: number) {
    const nextLat = Math.min(MAX_DELTA, Math.max(MIN_DELTA, region.latitudeDelta * factor));
    const ratio = nextLat / region.latitudeDelta;
    mapRef.current?.animateToRegion({
      latitude: region.latitude,
      longitude: region.longitude,
      latitudeDelta: nextLat,
      longitudeDelta: region.longitudeDelta * ratio,
    });
  }

  function centerOnMe() {
    if (!coords) return;
    const latDelta = Math.max(region.latitudeDelta, deltaForZoom(15, coords.lat));
    mapRef.current?.animateToRegion({
      latitude: coords.lat,
      longitude: coords.lon,
      latitudeDelta: latDelta,
      longitudeDelta: latDelta,
    });
  }

  if (position.status === 'denied') {
    return (
      <View style={styles.container}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Location permission denied</Text>
          <Text style={styles.noticeHint}>
            Enable location permission in Settings to see your position on the offline map.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType="standard"
        initialRegion={LONDON_REGION}
        onRegionChangeComplete={setRegion}
        scrollEnabled
        zoomEnabled
        pitchEnabled
        rotateEnabled
        minZoomLevel={MIN_ZOOM}
        maxZoomLevel={MAX_ZOOM}
        showsCompass
      >
        <LocalTile pathTemplate={TILE_PATH_TEMPLATE} tileSize={256} />
        {coords && (
          <Marker
            coordinate={{ latitude: coords.lat, longitude: coords.lon }}
            title="You"
            pinColor={colors.accent}
          />
        )}
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.lat, longitude: pin.lon }}
            title={`Shared by ${pin.from}`}
            pinColor={colors.warning}
          />
        ))}
      </MapView>
      <View style={styles.mapControls} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => zoomBy(0.5)}
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
        >
          <Text style={styles.controlText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => zoomBy(2)}
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
        >
          <Text style={styles.controlText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlButton, !coords && styles.controlButtonDisabled]}
          onPress={centerOnMe}
          disabled={!coords}
          accessibilityRole="button"
          accessibilityLabel="Center on my location"
        >
          <Text style={styles.controlText}>◎</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.attributionWrap} pointerEvents="none">
        <Text style={styles.attribution}>{MAP_ATTRIBUTION}</Text>
      </View>
      {position.status === 'pending' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Getting your position…</Text>
        </View>
      )}
      {!tilesAvailable && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Map not downloaded for this area</Text>
        </View>
      )}
      <View style={styles.bottomPanel}>
        <TouchableOpacity
          style={[styles.shareButton, !coords && styles.shareButtonDisabled]}
          onPress={shareLocation}
          disabled={!coords}
          accessibilityRole="button"
        >
          <Text style={styles.shareButtonText}>Share location</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {coords
            ? justShared
              ? `Shared ${formatLocLine(coords)} with the mesh`
              : 'Sends a loc: line to the public channel'
            : 'Waiting for a position fix…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  mapControls: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    flexDirection: 'column',
    gap: spacing.sm,
  },
  controlButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.surface,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonDisabled: { backgroundColor: colors.border },
  controlText: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  attributionWrap: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
  },
  attribution: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.radiusSm,
  },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  noticeTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  noticeHint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  banner: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  bannerText: { color: colors.text, fontSize: fontSize.body, textAlign: 'center' },
  bottomPanel: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: layout.borderWidth,
    borderTopColor: colors.border,
  },
  shareButton: {
    minHeight: layout.minTapTarget,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonDisabled: { backgroundColor: colors.border },
  shareButtonText: {
    color: colors.accentText,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
