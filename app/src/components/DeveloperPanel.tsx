import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { fixedLocation } from '../location/LocationStore';
import { useMesh, useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Body, Button, Card, styles } from './ui';

export function DeveloperPanel() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const [view, setView] = useState<'collapsed' | 'expanded'>('collapsed');
  const simulation = runtime.simulation;
  if (!simulation) return null;
  const mode = simulation.getHubMode();
  return <View style={styles.stack}>
    <Button secondary title={view === 'collapsed' ? 'Demo controls' : 'Hide demo controls'} onPress={() => setView(view === 'collapsed' ? 'expanded' : 'collapsed')} />
    {view === 'expanded' && <Card>
      <Text style={styles.subheading}>Simulated link controls</Text>
      <Body style={styles.small}>These controls change the demo on this phone. They do not connect to another phone or run a model.</Body>
      <Body>Hub mode: {mode}</Body>
      <View style={styles.row}>
        <Button secondary selected={mode === 'online'} title="Hub online" onPress={() => simulation.setHubMode('online')} />
        <Button secondary selected={mode === 'offline'} title="Hub offline" onPress={() => simulation.setHubMode('offline')} />
        <Button secondary selected={mode === 'error'} title="Hub error" onPress={() => simulation.setHubMode('error')} />
      </View>
      <View style={[styles.row, { justifyContent: 'space-between', minHeight: t.target }]}><Body style={{ flex: 1 }}>Phone B nearby</Body>
        <Switch accessibilityLabel="Phone B nearby" value={mesh.peers.some(peer => peer.nickname === 'Phone B')}
          onValueChange={nearby => simulation.setPhoneNearby(nearby)} hitSlop={{ top: t.space.sm, bottom: t.space.sm, left: t.space.sm, right: t.space.sm }} trackColor={{ false: t.color.border, true: t.color.primary }} />
      </View>
      <Button secondary title="Phone B sends a private message" onPress={() => simulation.sendPhoneMessage('private')} />
      <Button secondary title="Phone B sends a public message" onPress={() => simulation.sendPhoneMessage('public')} />
      <Button secondary title="Phone B shares a location" onPress={() => simulation.sendPhoneLocation()} />
      <Button secondary title="Use demo London position" onPress={() => runtime.useDemoPosition()} />
      <Button secondary title="Demo: no position fix" onPress={() => { void runtime.location.start(fixedLocation({ kind: 'locating' })); }} />
      <Button secondary title="Demo: location denied" onPress={() => { void runtime.location.start(fixedLocation({ kind: 'denied' })); }} />
    </Card>}
  </View>;
}
