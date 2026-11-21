import { useState } from 'react';
import { View } from 'react-native';
import { BRIEFING_STAGES, BriefingStage, demoBriefing } from '../briefing/demo';
import { useMesh, useRuntime } from '../store/Runtime';
import { useTheme } from '../theme/theme';
import { tokens as t } from '../theme/tokens';
import { Button, Card, Txt } from './ui';

/** Demo controls for the simulated link only. Never shown on a real phone. */
export function DeveloperPanel() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<BriefingStage>('nothing');
  const simulation = runtime.simulation;
  if (!simulation) return null;
  const mode = simulation.getHubMode();
  const pick = (next: BriefingStage) => { setStage(next); runtime.briefing.set(demoBriefing(next)); };
  const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.s2 };
  return <View style={{ gap: t.space.s3 }}>
    <Button variant="quiet" height={t.target} title={open ? 'Hide demo controls' : 'Demo controls'} onPress={() => setOpen(!open)} />
    {open && <Card tone="quiet">
      <Txt variant="caption" color={c.ink2}>These change the demo on this phone only. Answers are canned; no model runs.</Txt>
      <Txt variant="bodyStrong">News</Txt>
      <View style={row}>{BRIEFING_STAGES.map(item => <Button key={item.stage} height={t.target} title={item.title}
        variant={stage === item.stage ? 'primary' : 'outline'} onPress={() => pick(item.stage)} />)}</View>
      <Txt variant="bodyStrong">Help point</Txt>
      <View style={row}>{(['online', 'offline', 'error'] as const).map(value => <Button key={value} height={t.target}
        title={value === 'online' ? 'Answers' : value === 'offline' ? 'Out of reach' : 'Fails'}
        variant={mode === value ? 'primary' : 'outline'} onPress={() => simulation.setHubMode(value)} />)}</View>
      <Txt variant="bodyStrong">Bluetooth</Txt>
      <View style={row}>
        <Button height={t.target} title="On" variant={mesh.link === 'running' ? 'primary' : 'outline'} onPress={() => simulation.setBluetooth(true)} />
        <Button height={t.target} title="Off" variant={mesh.link === 'bluetooth_off' ? 'primary' : 'outline'} onPress={() => simulation.setBluetooth(false)} />
      </View>
    </Card>}
  </View>;
}
