import { useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Card, Heading, Notice, styles } from '../components/ui';
import OfflineMap from '../map/OfflineMap';
import { MapFocus, MapPoint } from '../map/types';
import { encodeLocationShare, HUB_NICKNAME } from '../protocol';
import { ThreadKey } from '../store/MeshStore';
import { useLocation, useMesh, useRuntime } from '../store/Runtime';

export function LocateScreen({ focus, clearFocus }: { focus: MapFocus | null; clearFocus: () => void }) {
  const runtime = useRuntime();
  const mesh = useMesh();
  const location = useLocation();
  const [sharing, setSharing] = useState<'closed' | 'choosing' | 'sending'>('closed');
  const [receipt, setReceipt] = useState('');
  const points: MapPoint[] = Object.values(mesh.pins).map(pin => ({ id: pin.peerId, label: pin.nickname, position: { lat: pin.lat, lon: pin.lon }, kind: 'peer' }));
  if (location.kind === 'ready') points.unshift({ id: 'self', label: 'Your position', position: location.position, kind: 'self' });
  if (focus) points.push({ id: 'focused-message', label: focus.label, position: focus.position, kind: 'focus' });
  const recipients = mesh.peers.filter(peer => peer.nickname !== HUB_NICKNAME && peer.id !== mesh.hubId);
  const share = async (to: ThreadKey, label: string) => {
    if (location.kind !== 'ready' || sharing === 'sending' || to === mesh.hubId) return;
    setSharing('sending');
    try {
      await runtime.mesh.send(to, encodeLocationShare(null, location.position.lat, location.position.lon));
      setReceipt(`Location shared with ${label}.`);
    } catch { setReceipt('Your location could not be sent. Check the link and try again.'); }
    finally { setSharing('closed'); }
  };
  return <View style={styles.stack}>
    <View><Heading>Locate</Heading><Body>Your position. Shared by choice.</Body></View>
    {location.kind === 'ready' ? <Notice>
      {location.source === 'demo' ? 'Demo position · Westminster, London' : 'Your position · satellite positioning'}
      {location.accuracy !== null ? ` · accurate to about ${Math.round(location.accuracy)} m` : ''}
    </Notice> : location.kind === 'denied' ? <Notice>Location permission denied. Allow location in your device settings, then try again. Shared pins still work.</Notice>
      : location.kind === 'locating' ? <Notice>No position fix yet. A satellite fix can take longer offline. Try a clear view of the sky.</Notice>
        : <Notice>{location.detail}</Notice>}
    <Button secondary title={location.kind === 'denied' ? 'Try location permission again' : 'Use device position'} onPress={() => runtime.useDevicePosition()} />
    {focus && <Card><Text style={styles.subheading}>Selected location · {focus.label}</Text>
      <Body>{focus.position.lat.toFixed(5)}, {focus.position.lon.toFixed(5)}</Body>
      <Button secondary title="Show all pins" onPress={clearFocus} />
    </Card>}
    <OfflineMap points={points} focus={focus} />
    <Text accessibilityRole="header" style={styles.subheading}>Position and shared pins</Text>
    {points.filter(point => point.kind !== 'focus').map(point => <Card key={point.id}>
      <Text style={styles.subheading}>{point.kind === 'self' ? '● ' : '◆ '}{point.label}</Text>
      <Body selectable>{point.position.lat.toFixed(5)}, {point.position.lon.toFixed(5)}</Body>
      <Body style={styles.small}>{point.kind === 'self' ? location.kind === 'ready' && location.source === 'demo' ? 'Simulated GPS position' : 'Only on this phone until you share' : 'Latest location shared by this peer. It may have changed.'}</Body>
    </Card>)}
    {!Object.keys(mesh.pins).length && <Body style={styles.small}>No peer locations shared yet.</Body>}
    <Button title="Share location" disabled={location.kind !== 'ready' || mesh.link !== 'running' || sharing === 'sending'} onPress={() => { setReceipt(''); setSharing('choosing'); }} />
    {sharing === 'choosing' && <Card>
      <Text style={styles.subheading}>Who should see your location?</Text>
      <Button secondary title="Share with public channel" onPress={() => { void share('public', 'the public channel'); }} />
      {recipients.map(peer => <Button key={peer.id} secondary title={`Share with ${peer.nickname}`} onPress={() => { void share(peer.id, peer.nickname); }} />)}
      <Button secondary title="Cancel sharing" onPress={() => setSharing('closed')} />
    </Card>}
    {sharing === 'sending' && <Body accessibilityLiveRegion="polite">Sending your location…</Body>}
    {receipt !== '' && <Notice>{receipt}</Notice>}
    <Body style={styles.small}>Only coordinates travel over the link. Share again if you move.</Body>
  </View>;
}
