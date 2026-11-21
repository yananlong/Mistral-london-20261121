import { Component, lazy, PropsWithChildren, Suspense, useState } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Body, Button, Notice, styles } from '../components/ui';
import { View } from 'react-native';
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

class MapBoundary extends Component<PropsWithChildren, { kind: 'ready' | 'failed' }> {
  state: { kind: 'ready' | 'failed' } = { kind: 'ready' };
  static getDerivedStateFromError() { return { kind: 'failed' }; }
  render() {
    return this.state.kind === 'failed'
      ? <Notice>The offline map could not open. Your position and pins are still listed below.</Notice> : this.props.children;
  }
}

export default function OfflineMap(props: OfflineMapProps) {
  const [file, setFile] = useState(findMap);
  const position = props.focus?.position ?? props.points.find(point => point.kind === 'self')?.position;
  if (file.kind === 'unsupported') return <Notice>Offline map needs a development build. Your position and shared pins are listed below.</Notice>;
  if ((position && !isInLondon(position)) || file.kind === 'missing') return <View style={styles.stack}>
    <Notice>Map not downloaded for this area. Copy london.pmtiles to this app’s Documents folder before going offline.</Notice>
    <Button secondary title="Check for downloaded map" onPress={() => setFile(findMap())} />
  </View>;
  return <MapBoundary><Suspense fallback={<Body>Opening your offline London map…</Body>}>
    <MapCanvas {...props} uri={file.uri} />
  </Suspense></MapBoundary>;
}
