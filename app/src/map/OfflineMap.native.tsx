import { Component, lazy, PropsWithChildren, ReactNode, Suspense, useState } from 'react';
import { TurboModuleRegistry, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Button } from '../components/ui';
import { tokens as t } from '../theme/tokens';
import { SchematicMap } from './SchematicMap';
import { OfflineMapProps, isInLondon } from './types';

const MapCanvas = lazy(() => import('./MapCanvas'));
type MapFile = { kind: 'unsupported' } | { kind: 'missing' } | { kind: 'ready'; uri: string };

function findMap(): MapFile {
  if (!TurboModuleRegistry.get('MLRNMapViewModule')) return { kind: 'unsupported' };
  try {
    const file = new File(Paths.document, 'london.pmtiles');
    return file.exists && file.size > 0 ? { kind: 'ready', uri: file.uri } : { kind: 'missing' };
  } catch { return { kind: 'missing' }; }
}

class MapBoundary extends Component<PropsWithChildren<{ fallback: ReactNode }>, { kind: 'ready' | 'failed' }> {
  state: { kind: 'ready' | 'failed' } = { kind: 'ready' };
  static getDerivedStateFromError() { return { kind: 'failed' }; }
  render() { return this.state.kind === 'failed' ? this.props.fallback : this.props.children; }
}

/**
 * The street map stored on the phone (london.pmtiles + MapLibre), drawn in a
 * development build. Anywhere it can't run — Expo Go, no map file, outside
 * London — the same pins are drawn on the schematic map, so a topic always
 * opens on a map, as the design asks.
 */
export default function OfflineMap(props: OfflineMapProps) {
  const [file, setFile] = useState(findMap);
  const position = props.focus?.position ?? props.points.find(point => point.kind === 'self')?.position;
  const schematic = (note?: string) => <SchematicMap points={props.points} height={props.height} note={note} />;
  if (file.kind === 'unsupported') return schematic();
  if ((position && !isInLondon(position)) || file.kind === 'missing') return <View style={{ gap: t.space.xs }}>
    {schematic('The street map is not on this phone yet. Copy london.pmtiles to the app’s Documents folder.')}
    <Button kind="line" small title="Check for the street map" onPress={() => setFile(findMap())} />
  </View>;
  return <MapBoundary fallback={schematic()}><Suspense fallback={schematic()}>
    <MapCanvas {...props} uri={file.uri} />
  </Suspense></MapBoundary>;
}
