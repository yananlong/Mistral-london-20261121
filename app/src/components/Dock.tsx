import { ReactNode, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AskSession } from '../ask/AskController';
import { LocationState } from '../location/LocationStore';
import { MAX_QUESTION_BYTES, prefixBytes, trim } from '../protocol';
import { SosMode } from '../sos/SosController';
import { MeshState } from '../store/MeshStore';
import { useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Arrive, Button, Icon, Txt } from './ui';

/**
 * The dock pinned under the thread: a notice (only when the person has to know
 * something), the SOS bar (never scrolls away) and the question box.
 * The app shows no connection status at all (PRINCIPLES §2): no "online", no
 * counts of phones. Only "Bluetooth is off" and "Not getting through" appear.
 */
export type NoticeKind = 'bluetooth_off' | 'unauthorized' | 'stuck' | null;
export function noticeFor(mesh: MeshState, ask: AskSession, sos: SosMode): NoticeKind {
  if (mesh.link === 'bluetooth_off') return 'bluetooth_off';
  if (mesh.link === 'unauthorized') return 'unauthorized';
  if (mesh.link === 'stopped' || mesh.link === 'unsupported') return 'stuck';
  if (ask.state === 'queued' || ask.state === 'unreachable' || sos === 'waiting') return 'stuck';
  return null;
}

export function Dock({ mesh, ask, sos, location }: { mesh: MeshState; ask: AskSession; sos: SosMode; location: LocationState }) {
  const notice = noticeFor(mesh, ask, sos);
  return <View style={k.dock}>
    {notice && <Arrive key={notice}><Notice kind={notice} /></Arrive>}
    <SosBar mode={sos} hasLocation={location.kind === 'ready'} />
    <AskBox location={location} busy={ask.state === 'queued' || ask.state === 'sent' || ask.state === 'received' || ask.state === 'unreachable'} />
  </View>;
}

function Notice({ kind }: { kind: Exclude<NoticeKind, null> }) {
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const turnOn = () => { if (runtime.simulation) runtime.simulation.setBluetooth(true); else void Linking.openSettings(); };
  if (kind === 'bluetooth_off' || kind === 'unauthorized') return <View style={k.notice}>
    <View style={k.noticeTop}>
      <Icon name="bluetooth-disabled" color={t.color.yellow} />
      <View style={{ flex: 1 }}>
        <Txt strong>{kind === 'bluetooth_off' ? 'Bluetooth is off' : 'Bluetooth is not allowed'}</Txt>
        <Txt variant="callout" muted style={{ marginTop: 2 }}>{kind === 'bluetooth_off' ? 'Turn it on to send questions.' : 'Allow Bluetooth for this app in Settings to send questions.'} First aid works without it.</Txt>
      </View>
    </View>
    <Button icon="bluetooth" title={kind === 'bluetooth_off' ? 'Turn on Bluetooth' : 'Open Settings'} onPress={turnOn} small style={{ marginTop: t.space.sm }} />
  </View>;
  return <View style={k.notice}>
    <View style={k.noticeTop}>
      <Icon name="schedule" color={t.color.yellow} />
      <View style={{ flex: 1 }}>
        <Txt strong>Not getting through right now</Txt>
        <Txt variant="callout" muted style={{ marginTop: 2 }}>The app keeps trying. First aid and the news still work.</Txt>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="How does this work?" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={k.how}>
      <Icon name="help" size={20} color={t.color.ink2} />
      <Txt variant="callout" muted style={{ flex: 1 }}>How does this work?</Txt>
      <Icon name={open ? 'expand-less' : 'expand-more'} size={20} color={t.color.ink2} />
    </Pressable>
    {open && <View style={{ gap: 2, paddingBottom: 6 }}>
      <Txt variant="callout" muted>This app works with no phone signal and no internet.</Txt>
      <Txt variant="callout" muted>Your phone passes your message to other phones by Bluetooth, until one of them can get an answer.</Txt>
      <Txt variant="callout" muted>Nobody can read your private messages on the way.</Txt>
    </View>}
  </View>;
}

function SosBar({ mode, hasLocation }: { mode: SosMode; hasLocation: boolean }) {
  const { sos } = useRuntime();
  const cancel = <Button kind="line" small title="Cancel SOS" onPress={() => sos.cancel()} />;
  const line = (icon: 'warning' | 'sos' | 'check-circle' | 'schedule', color: string, text: string, action: ReactNode) =>
    <View style={k.sosLine}><Icon name={icon} color={color} /><Txt variant="callout" style={{ flex: 1 }}>{text}</Txt>{action}</View>;
  return <View style={[k.sos, mode === 'confirm' && k.sosBig]} accessibilityLiveRegion="assertive">
    {mode === 'idle' && line('warning', t.color.red, 'In danger? Ask for help.', <Button kind="red" small title="SOS" label="SOS. Ask for help" onPress={() => sos.request()} style={{ minWidth: 76 }} />)}
    {mode === 'confirm' && <Arrive>
      <Txt variant="title2">Send SOS?</Txt>
      <Txt style={{ marginTop: 2 }}>{hasLocation ? 'It asks everyone nearby for help and sends where you are.' : 'It asks everyone nearby for help.'}</Txt>
      <View style={k.sosActs}>
        <Button kind="red" title="Send SOS" onPress={() => { void sos.send(); }} style={{ flex: 1 }} />
        <Button kind="line" title="Cancel" label="Don't send SOS" onPress={() => sos.cancel()} />
      </View>
    </Arrive>}
    {mode === 'sending' && line('sos', t.color.red, 'Sending SOS', cancel)}
    {mode === 'sent' && line('check-circle', t.color.green, 'SOS sent to everyone nearby.', cancel)}
    {mode === 'waiting' && line('schedule', t.color.yellow, 'SOS not sent yet. The app keeps trying.', cancel)}
  </View>;
}

function AskBox({ location, busy }: { location: LocationState; busy: boolean }) {
  const { ask } = useRuntime();
  const [text, setText] = useState('');
  const [withLocation, setWithLocation] = useState(false);
  const [hint, setHint] = useState('');
  const send = () => {
    if (!trim(text)) return;
    if (busy) { setHint('One question at a time. Your last one is still on its way.'); return; }
    const sent = ask.ask(text, withLocation && location.kind === 'ready' ? location.position : null);
    if (sent) { setText(''); setHint(''); setWithLocation(false); }
  };
  const locationNote = !withLocation ? '' : location.kind === 'ready' ? 'Where you are goes with this question.'
    : location.kind === 'denied' ? 'Location is off for this app. Your question goes without it.' : 'Finding where you are…';
  return <View style={{ gap: 6 }}>
    <View style={k.ask}>
      <TextInput accessibilityLabel="Ask anything" placeholder="Ask anything" placeholderTextColor={t.color.ink2} value={text}
        onChangeText={value => { setText(prefixBytes(value, MAX_QUESTION_BYTES)); setHint(''); }} onSubmitEditing={send} returnKeyType="send"
        style={k.input} />
      <Pressable accessibilityRole="switch" accessibilityLabel="Include where I am" accessibilityState={{ checked: withLocation }} onPress={() => setWithLocation(!withLocation)}
        style={[k.iconBtn, withLocation && k.iconBtnOn]} hitSlop={4}>
        <Icon name="location-on" size={20} color={withLocation ? t.color.onInk : t.color.ink2} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} style={({ pressed }) => [k.send, pressed && { transform: [{ scale: 0.97 }] }]}>
        <Icon name="arrow-upward" size={20} color={t.color.onInk} />
      </Pressable>
    </View>
    {(hint || locationNote) !== '' && <Txt variant="caption" muted>{hint || locationNote}</Txt>}
  </View>;
}

const k = StyleSheet.create({
  dock: { paddingTop: t.space.xs, paddingHorizontal: t.space.sm, paddingBottom: t.space.xs, gap: t.space.xs, backgroundColor: t.color.surface, borderTopWidth: 1, borderColor: t.color.line },
  notice: { borderWidth: 1, borderColor: t.color.line, borderRadius: t.radius.m, padding: t.space.sm, backgroundColor: t.color.surface },
  noticeTop: { flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' },
  how: { marginTop: t.space.xs, borderTopWidth: 1, borderColor: t.color.line, minHeight: t.targetSmall, flexDirection: 'row', alignItems: 'center', gap: t.space.xs },
  sos: { borderWidth: 1, borderColor: t.color.redLine, backgroundColor: t.color.redTint, borderRadius: t.radius.m, paddingVertical: t.space.xs, paddingRight: t.space.xs, paddingLeft: t.space.sm },
  sosBig: { padding: 14 },
  sosLine: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: t.targetSmall },
  sosActs: { marginTop: t.space.sm, flexDirection: 'row', gap: t.space.xs },
  ask: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, height: 52, borderRadius: t.radius.m, borderWidth: 1, borderColor: t.color.lineStrong, paddingLeft: t.space.md, paddingRight: 6 },
  input: { flex: 1, minWidth: 0, color: t.color.ink, fontFamily: t.font.regular, fontSize: 17, height: '100%' },
  iconBtn: { width: 40, height: 40, borderRadius: t.radius.s, alignItems: 'center', justifyContent: 'center' },
  iconBtnOn: { backgroundColor: t.color.ink },
  send: { width: 40, height: 40, borderRadius: t.radius.s, backgroundColor: t.color.ink, alignItems: 'center', justifyContent: 'center' },
});
