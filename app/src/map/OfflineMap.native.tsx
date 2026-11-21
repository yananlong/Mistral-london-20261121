import { Component, lazy, PropsWithChildren, Suspense, useState } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Button, Card, Txt } from '../components/ui';
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
      ? <Card tone="quiet"><Txt>The map could not open. The place details are listed below.</Txt></Card> : this.props.children;
  }
}

export default function OfflineMap(props: OfflineMapProps) {
  const [file, setFile] = useState(findMap);
  const position = props.focus?.position ?? props.points.find(point => point.kind === 'self')?.position;
  if (file.kind === 'unsupported') return <Card tone="quiet"><Txt>The map needs the full app. The place details are listed below.</Txt></Card>;
  if ((position && !isInLondon(position)) || file.kind === 'missing') return <View style={{ gap: 12 }}>
    <Card tone="quiet"><Txt>Map not downloaded for this area. Copy london.pmtiles to this app’s Documents folder.</Txt></Card>
    <Button variant="outline" title="Check for downloaded map" onPress={() => setFile(findMap())} />
  </View>;
  return <MapBoundary><Suspense fallback={<Txt>Opening the map…</Txt>}>
    <MapCanvas {...props} uri={file.uri} />
  </Suspense></MapBoundary>;
}
