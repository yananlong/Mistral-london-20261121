import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NEWS, NEWS_ORDER } from '../content/scenario';
import { fixedLocation } from '../location/LocationStore';
import { useLocation, useMesh, useNews, useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Button, Toggle, Txt } from './ui';

/**
 * Demo controls, only on the simulated link. They set the story from
 * design/components.html on this phone: Bluetooth, whether questions get
 * through, how much news has arrived, and what Phone B does.
 */
export function DeveloperPanel() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const news = useNews();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const simulation = runtime.simulation;
  if (!simulation) return null;
  const hub = simulation.getHubMode();
  const bluetooth = simulation.isBluetoothOn();
  const phoneNearby = mesh.peers.some(peer => peer.nickname === 'Phone B');
  return <View style={p.wrap}>
    <Button kind="line" small icon={open ? 'expand-less' : 'expand-more'} title={open ? 'Hide demo controls' : 'Demo controls'} onPress={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }} />
    {open && <View style={p.panel}>
      <Txt variant="caption" muted>Demo only. These change this phone. Answers are examples, not from a model.</Txt>
      <Group title="Bluetooth">
        <Toggle title="On" selected={bluetooth} onPress={() => simulation.setBluetooth(true)} />
        <Toggle title="Off" selected={!bluetooth} onPress={() => simulation.setBluetooth(false)} />
      </Group>
      <Group title="Questions">
        <Toggle title="Getting through" selected={hub === 'online'} onPress={() => simulation.setHubMode('online')} />
        <Toggle title="Not getting through" selected={hub === 'offline'} onPress={() => simulation.setHubMode('offline')} />
        <Toggle title="No answer" selected={hub === 'error'} onPress={() => simulation.setHubMode('error')} />
      </Group>
      <Group title="News">
        {NEWS_ORDER.map(key => <Toggle key={key} title={NEWS[key].name} selected={news === key} onPress={() => runtime.news.set(key)} />)}
      </Group>
      <Group title="Phone B">
        <Toggle title="Nearby" selected={phoneNearby} onPress={() => simulation.setPhoneNearby(true)} />
        <Toggle title="Away" selected={!phoneNearby} onPress={() => simulation.setPhoneNearby(false)} />
      </Group>
      <View style={p.row}>
        <Button kind="line" small title="Phone B messages you" onPress={() => simulation.sendPhoneMessage('private')} />
        <Button kind="line" small title="Phone B messages everyone" onPress={() => simulation.sendPhoneMessage('public')} />
        <Button kind="line" small title="Phone B shares where they are" onPress={() => simulation.sendPhoneLocation()} />
        <Button kind="line" small title="Phone B sends SOS" onPress={() => simulation.sendPhoneSos()} />
      </View>
      <Group title="Your position">
        <Toggle title="Demo" selected={location.kind === 'ready' && location.source === 'demo'} onPress={() => runtime.useDemoPosition()} />
        <Toggle title="Device" selected={location.kind === 'ready' && location.source === 'device'} onPress={() => runtime.useDevicePosition()} />
        <Toggle title="No fix" selected={location.kind === 'locating'} onPress={() => { void runtime.location.start(fixedLocation({ kind: 'locating' })); }} />
        <Toggle title="Denied" selected={location.kind === 'denied'} onPress={() => { void runtime.location.start(fixedLocation({ kind: 'denied' })); }} />
      </Group>
    </View>}
  </View>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: t.space.xs }}><Txt variant="label" muted accessibilityRole="header">{title}</Txt><View style={p.row}>{children}</View></View>;
}

const p = StyleSheet.create({
  wrap: { marginTop: t.space.xl, gap: t.space.xs },
  panel: { borderWidth: 1, borderColor: t.color.line, borderRadius: t.radius.l, padding: t.space.md, gap: t.space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },
});
