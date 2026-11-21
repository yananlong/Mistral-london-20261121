import { StyleSheet, View } from 'react-native';
import { Txt } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { Pin } from './Pin';
import { MapPoint } from './types';

/**
 * The map when the full offline basemap can't run (web, Expo Go, or no map
 * file yet): the same pins at their real relative positions on a plain dark
 * field, like the drawn map in design/components.html. No roads, but you can
 * still see which place is closest and in what direction.
 */
export function SchematicMap({ points, height = 210, note }: { points: MapPoint[]; height?: number; note?: string }) {
  const lats = points.map(point => point.position.lat);
  const lons = points.map(point => point.position.lon);
  const pad = 0.0015;
  const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons) - pad, maxLon = Math.max(...lons) + pad;
  // Keep the aspect honest: one degree of longitude is shorter than one of latitude.
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * lonScale, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const place = (point: MapPoint) => ({
    left: `${(((point.position.lon - minLon) * lonScale) / spanX) * 100}%` as const,
    top: `${((maxLat - point.position.lat) / spanY) * 100}%` as const,
  });
  return <View>
    <View style={[map.field, { height }]} accessibilityRole="image"
      accessibilityLabel={`Map: ${points.filter(point => point.kind === 'place').length} places, numbered like the list`}>
      <View style={[map.street, { top: '35%' }]} /><View style={[map.street, { top: '72%' }]} />
      <View style={[map.avenue, { left: '22%' }]} /><View style={[map.avenue, { left: '58%' }]} />
      <View style={map.inner}>
        {points.map(point => <View key={point.id} style={[map.anchor, place(point)]}><Pin point={point} /></View>)}
      </View>
    </View>
    {note && <Txt variant="caption" muted style={{ marginTop: t.space.xs }}>{note}</Txt>}
  </View>;
}

const map = StyleSheet.create({
  field: { borderRadius: t.radius.m, borderWidth: 1, borderColor: t.color.line, backgroundColor: t.color.surface, overflow: 'hidden' },
  inner: { position: 'absolute', left: 28, right: 28, top: 24, bottom: 24 },
  anchor: { position: 'absolute', transform: [{ translateX: -12 }, { translateY: -12 }] },
  street: { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: t.color.line, borderRadius: 3 },
  avenue: { position: 'absolute', top: 0, bottom: 0, width: 6, backgroundColor: t.color.line, borderRadius: 3 },
});
