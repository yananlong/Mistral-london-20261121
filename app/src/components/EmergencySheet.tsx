import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { encodeSOS } from '../protocol';
import { useLocation, useMesh, useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Body, Button, Notice, styles } from './ui';

/** Questions used by the guided emergency flow (kept short for the 200-byte question limit). */
export const FIRST_AID_QUESTION = 'First aid: what should I do right now?';
export const ANALYSIS_QUESTION = 'What is happening around me and what should I do?';

export type EmergencyTarget = 'ask' | 'chats';

/**
 * The emergency sheet behind the small SOS header action. It is deliberately
 * not one big red button: SOS is a guided escalation — try to resolve it
 * yourself first (first aid, ask what is happening), then call for help —
 * and the top action does both at once. Rendered as an inline overlay so the
 * shell stays put underneath.
 */
export function EmergencySheet({
  visible,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  onNavigate: (target: EmergencyTarget) => void;
}) {
  const runtime = useRuntime();
  const mesh = useMesh();
  const location = useLocation();
  const [receipt, setReceipt] = useState('');
  const loc = location.kind === 'ready' ? location.position : null;
  const canReachMesh = mesh.link === 'running';
  const canAskHub = canReachMesh && mesh.hubId !== null;

  if (!visible) return null;

  const sendSOS = async (): Promise<boolean> => {
    try {
      await runtime.mesh.send('public', encodeSOS(loc));
      return true;
    } catch {
      return false;
    }
  };
  const askHub = (question: string) => {
    setReceipt('');
    runtime.ask.submit(question, loc);
    onNavigate('ask');
  };
  const sosAndFirstAid = async () => {
    const sent = await sendSOS();
    setReceipt(
      sent
        ? 'SOS sent to everyone on the mesh — it is in Chats, and your location is a pin on their maps. First-aid guidance is on its way.'
        : 'SOS could not be sent. Check the link and try again. First-aid guidance is on its way.',
    );
    runtime.ask.submit(FIRST_AID_QUESTION, loc);
    onNavigate('ask');
  };
  const sosOnly = async () => {
    const sent = await sendSOS();
    setReceipt(
      sent
        ? 'SOS sent to everyone on the mesh. It is in Chats; with a position fix your pin is on their maps.'
        : 'SOS could not be sent. Check the link and try again.',
    );
  };

  const step = (n: number, title: string) => (
    <View style={local.step}>
      <Text style={local.stepNumber}>{n}</Text>
      <Text style={local.stepTitle}>{title}</Text>
    </View>
  );

  return (
    <View style={local.overlay} accessibilityViewIsModal>
      <View style={local.sheet}>
        <Text accessibilityRole="header" style={styles.subheading}>Emergency</Text>
        <Body style={styles.small}>Do what you can first, then call for help — or both at once.</Body>
        <Button
          title="Send SOS + get first-aid guidance"
          onPress={() => void sosAndFirstAid()}
          disabled={!canReachMesh}
        />
        {step(1, 'First aid — try to resolve it yourself')}
        <Button secondary title="Get first-aid guidance" label="Get first-aid guidance from the hub"
          disabled={!canAskHub} onPress={() => askHub(FIRST_AID_QUESTION)} />
        {step(2, 'Help — reach the people around you')}
        <Button secondary title="Message people nearby" onPress={() => onNavigate('chats')} />
        {step(3, 'What is happening — get an analysis')}
        <Button secondary title="Ask what is happening around me" disabled={!canAskHub}
          onPress={() => askHub(ANALYSIS_QUESTION)} />
        {step(4, 'Call for help — alert everyone on the mesh')}
        <Button secondary title="Send SOS to everyone nearby" disabled={!canReachMesh}
          onPress={() => void sosOnly()} />
        {receipt !== '' && <Notice>{receipt}</Notice>}
        <Body style={styles.small}>
          If you can reach 999 or 112, call them. With a position fix, SOS also shares your location as a pin.
        </Body>
        <Pressable accessibilityRole="button" accessibilityLabel="Close emergency options" onPress={onClose} style={local.close}>
          <Text style={local.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(18, 47, 53, 0.55)',
    justifyContent: 'center',
    padding: t.space.lg,
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space.lg,
    gap: t.space.sm,
    maxHeight: '90%',
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginTop: t.space.xs },
  stepNumber: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: t.color.primarySoft,
    color: t.color.ink, fontWeight: t.weight.bold, fontSize: t.font.small, textAlign: 'center', textAlignVertical: 'center',
  },
  stepTitle: { color: t.color.ink, fontWeight: t.weight.medium, fontSize: t.font.body, flex: 1 },
  close: { minHeight: t.target, justifyContent: 'center', alignItems: 'center', borderRadius: t.radius.sm, borderWidth: 1, borderColor: t.color.border },
  closeText: { color: t.color.ink, fontWeight: t.weight.bold, fontSize: t.font.body },
});
