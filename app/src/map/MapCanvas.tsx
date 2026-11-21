import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
  type MapProps,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Notice, styles } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { OfflineMapProps } from './types';
import { buildMapStyle, INITIAL_ZOOM, LONDON_CENTER, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './mapStyle';

const MAP_HEIGHT = 380;

/**
 * The offline London map: Protomaps vector tiles from london.pmtiles, drawn
 * with the full basemap style in mapStyle.ts. Fully navigable — pan, pinch
 * zoom, rotate and pitch are on, zoom is clamped to the downloaded area, and
 * the on-map buttons zoom in/out or recenter on the selected position.
 */
export default function MapCanvas({ points, focus, uri }: OfflineMapProps & { uri: string }) {
  const [state, setState] = useState<'opening' | 'ready' | 'failed'>('opening');
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const cameraRef = useRef<CameraRef>(null);
  const center = focus?.position ?? points.find((point) => point.kind === 'self')?.position ?? LONDON_CENTER;
  const mapStyle = useMemo(() => buildMapStyle(uri), [uri]);

  // Follow the selected position / own position when it changes.
  const centerKey = `${center.lat},${center.lon}`;
  useEffect(() => {
    cameraRef.current?.flyTo({ center: [center.lon, center.lat], zoom: Math.max(zoom, INITIAL_ZOOM), duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  const zoomBy = (delta: number) => {
    const next = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom + delta));
    cameraRef.current?.zoomTo(next, { duration: 200 });
  };
  const recenter = () => {
    cameraRef.current?.flyTo({ center: [center.lon, center.lat], zoom: Math.max(zoom, INITIAL_ZOOM), duration: 500 });
  };

  if (state === 'failed') return <Notice>The offline map could not open. Check the London map file. Your coordinates and pins are below.</Notice>;
  return <View style={styles.stack}>
    {state === 'opening' && <Body>Opening your offline London map…</Body>}
    <View>
      <Map
        style={local.map}
        mapStyle={mapStyle as MapProps['mapStyle']}
        dragPan
        touchZoom
        doubleTapZoom
        doubleTapHoldZoom
        touchRotate
        touchPitch
        onDidFinishLoadingMap={() => setState('ready')}
        onDidFailLoadingMap={() => setState('failed')}
        onRegionDidChange={(event: { nativeEvent: ViewStateChangeEvent }) => setZoom(event.nativeEvent.zoom)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [center.lon, center.lat], zoom: INITIAL_ZOOM, pitch: 0, bearing: 0 }}
          minZoom={MAP_MIN_ZOOM}
          maxZoom={MAP_MAX_ZOOM}
        />
        {points.map((point) => (
          <Marker key={point.id} id={point.id} lngLat={[point.position.lon, point.position.lat]}>
            <View style={[local.pin, { backgroundColor: point.kind === 'self' ? t.color.position : t.color.pin }]}>
              <Text numberOfLines={1} style={local.pinText}>{point.label}</Text>
            </View>
          </Marker>
        ))}
      </Map>
      <View style={local.controls} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" style={local.controlButton} onPress={() => zoomBy(1.5)}>
          <Text style={local.controlText}>+</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" style={local.controlButton} onPress={() => zoomBy(-1.5)}>
          <Text style={local.controlText}>−</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Center on selected position" style={local.controlButton} onPress={recenter}>
          <Text style={local.controlText}>◎</Text>
        </Pressable>
      </View>
    </View>
    <Body style={styles.small}>London · pan and pinch to explore · offline · © OpenStreetMap contributors · Protomaps</Body>
  </View>;
}

const local = StyleSheet.create({
  map: { height: MAP_HEIGHT, width: '100%', borderRadius: t.radius.md },
  controls: {
    position: 'absolute',
    top: t.space.sm,
    right: t.space.sm,
    flexDirection: 'column',
    gap: t.space.xs,
  },
  controlButton: {
    width: t.target,
    height: t.target,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { color: t.color.ink, fontSize: t.font.subtitle, fontWeight: t.weight.bold },
  pin: { maxWidth: 180, paddingHorizontal: t.space.sm, paddingVertical: t.space.xs, borderRadius: t.radius.pill, borderWidth: 2, borderColor: t.color.white },
  pinText: { color: t.color.white, fontSize: t.font.small, fontWeight: t.weight.bold },
});
