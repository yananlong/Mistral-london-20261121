import { useState } from 'react';
import { Camera, Layer, LayerAnnotation, Map, MapProps } from '@maplibre/maplibre-react-native';
import { View } from 'react-native';
import { Body, Notice, styles } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { OfflineMapProps } from './types';

export default function MapCanvas({ points, focus, uri }: OfflineMapProps & { uri: string }) {
  const [state, setState] = useState<'opening' | 'ready' | 'failed'>('opening');
  const center = focus?.position ?? points.find(point => point.kind === 'self')?.position ?? { lat: 51.5007, lon: -0.1246 };
  const mapStyle: MapProps['mapStyle'] = {
    version: 8,
    sources: { london: { type: 'vector', url: `pmtiles://${uri}`, attribution: '© OpenStreetMap contributors · Protomaps' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': t.color.mapLand } },
      { id: 'earth', type: 'fill', source: 'london', 'source-layer': 'earth', paint: { 'fill-color': t.color.mapLand } },
      { id: 'water', type: 'fill', source: 'london', 'source-layer': 'water', paint: { 'fill-color': t.color.mapWater } },
      { id: 'buildings', type: 'fill', source: 'london', 'source-layer': 'buildings', paint: { 'fill-color': t.color.mapBuilding } },
      { id: 'roads', type: 'line', source: 'london', 'source-layer': 'roads', paint: { 'line-color': t.color.mapRoad, 'line-width': 2 } },
    ],
  };
  if (state === 'failed') return <Notice>The offline map could not open. Check the London map file. Your coordinates and pins are below.</Notice>;
  return <View style={styles.stack}>
    {state === 'opening' && <Body>Opening your offline London map…</Body>}
    <Map style={{ height: 340, width: '100%', borderRadius: t.radius.md }} mapStyle={mapStyle}
      onDidFinishLoadingMap={() => setState('ready')} onDidFailLoadingMap={() => setState('failed')}>
      <Camera key={`${center.lat},${center.lon}`} initialViewState={{ center: [center.lon, center.lat], zoom: 13 }} />
      {points.map(point => <LayerAnnotation key={point.id} id={point.id} lngLat={[point.position.lon, point.position.lat]}>
        <Layer id={`${point.id}-dot`} type="circle" paint={{ 'circle-radius': point.kind === 'self' ? 10 : 8,
          'circle-color': point.kind === 'self' ? t.color.position : t.color.pin, 'circle-stroke-color': t.color.white, 'circle-stroke-width': 3 }} />
      </LayerAnnotation>)}
    </Map>
    <Body style={styles.small}>London · offline · © OpenStreetMap contributors · Protomaps</Body>
  </View>;
}
