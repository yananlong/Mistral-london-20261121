import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
  type MapProps,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Txt } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { Pin } from './Pin';
import { SchematicMap } from './SchematicMap';
import { OfflineMapProps } from './types';
import { buildMapStyle, INITIAL_ZOOM, LONDON_CENTER, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './mapStyle';


/**
 * The offline London map: Protomaps vector tiles from london.pmtiles, drawn
 * with the full basemap style in mapStyle.ts. Fully navigable — pan, pinch
 * zoom, rotate and pitch are on, zoom is clamped to the downloaded area, and
 * the on-map buttons zoom in/out or recenter on the selected position.
 */
export default function MapCanvas({ points, focus, uri, height = 260 }: OfflineMapProps & { uri: string }) {
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

  if (state === 'failed') return <SchematicMap points={points} height={height} note="The stored street map could not open. Places are shown in the right direction." />;
  return <View style={{ gap: t.space.xs }}>
    <View style={local.frame}>
      <Map
        style={{ height, width: '100%' }}
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
            <Pin point={point} />
          </Marker>
        ))}
      </Map>
      <View style={local.controls} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" style={local.controlButton} onPress={() => zoomBy(1.5)}>
          <Icon name="add" size={22} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" style={local.controlButton} onPress={() => zoomBy(-1.5)}>
          <Icon name="remove" size={22} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Center on selected position" style={local.controlButton} onPress={recenter}>
          <Icon name="my-location" size={20} />
        </Pressable>
      </View>
    </View>
    <Txt variant="caption" muted>{state === 'opening' ? 'Opening the map stored on your phone…' : 'Stored on your phone. © OpenStreetMap contributors · Protomaps'}</Txt>
  </View>;
}

const local = StyleSheet.create({
  frame: { borderRadius: t.radius.m, borderWidth: 1, borderColor: t.color.line, overflow: 'hidden' },
  controls: { position: 'absolute', top: t.space.xs, right: t.space.xs, gap: t.space.xxs },
  controlButton: {
    width: t.targetSmall, height: t.targetSmall, borderRadius: t.radius.s, backgroundColor: t.color.surface,
    borderWidth: 1, borderColor: t.color.line, alignItems: 'center', justifyContent: 'center',
  },
});
