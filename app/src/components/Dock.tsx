import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { MAX_QUESTION_BYTES, prefixBytes, trim } from '../protocol';
import { RelayItem } from '../relay/RelayStore';
import { useStyles, useTheme } from '../theme/theme';
import { Palette, tokens as t } from '../theme/tokens';
import { LinkState } from '../transport/types';
import { Button, Card, Divider, Icon, StateIcon, textStyle, Txt } from './ui';

/**
 * Who an SOS reaches. design/components.html ("Decide: who gets an SOS?"):
 * until the server has a real way to reach emergency services, the bar says
 * "your family", not "emergency services".
 */
export const SOS_RECIPIENT = 'your family';

export const HOW_IT_WORKS = 'Your message hops from phone to phone over Bluetooth until it reaches a help point that can pass it on. Answers come back the same way, so they can take a few minutes. Answers are written by a computer and are not checked by a person.';

export function HowItWorks() {
  const [open, setOpen] = useState(false);
  const { c } = useTheme();
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="How does this work?" accessibilityState={{ expanded: open }}
      onPress={() => setOpen(!open)} style={local.how}>
      <Icon name="help" color={c.ink2} size={26} />
      <Txt variant="bodyStrong" color={c.ink2} style={{ flex: 1 }}>How does this work?</Txt>
      <Icon name={open ? 'expand-less' : 'expand-more'} color={c.ink2} />
    </Pressable>
    {open && <Txt color={c.ink2}>{HOW_IT_WORKS}</Txt>}
  </View>;
}

/** Only two things ever appear by themselves: Bluetooth is off, and Not getting through. */
export function LinkCard({ link, notGettingThrough, onBluetooth }: { link: LinkState; notGettingThrough: boolean; onBluetooth: () => void }) {
  const { c } = useTheme();
  if (link === 'bluetooth_off' || link === 'unauthorized') {
    const off = link === 'bluetooth_off';
    return <Card style={{ gap: t.space.s4 }}>
      <View style={local.row} accessibilityRole="alert">
        <Icon name="bluetooth-disabled" color={c.yellow} size={28} />
        <View style={{ flex: 1, gap: t.space.s1 }}>
          <Txt variant="title2" style={{ fontSize: 20 }}>{off ? 'Bluetooth is off' : 'Bluetooth is not allowed'}</Txt>
          <Txt color={c.ink2}>{off ? 'Turn it on to send questions. First aid works without it.' : 'Allow it in Settings to send questions. First aid works without it.'}</Txt>
        </View>
      </View>
      <Button title={off ? 'Turn on Bluetooth' : 'Allow Bluetooth'} icon="bluetooth" onPress={onBluetooth} />
    </Card>;
  }
  if (link === 'unsupported') return <Card>
    <View style={local.row}><Icon name="bluetooth-disabled" color={c.yellow} size={28} />
      <View style={{ flex: 1, gap: t.space.s1 }}><Txt variant="title2" style={{ fontSize: 20 }}>This phone can't send questions</Txt>
        <Txt color={c.ink2}>First aid works without it.</Txt></View></View>
  </Card>;
  if (!notGettingThrough) return null;
  return <Card style={{ gap: t.space.s3 }}>
    <View style={local.row} accessibilityRole="alert">
      <StateIcon kind="waiting" size={28} />
      <View style={{ flex: 1, gap: t.space.s1 }}>
        <Txt variant="title2" style={{ fontSize: 20 }}>Not getting through right now</Txt>
        <Txt color={c.ink2}>The app keeps trying. First aid and the news still work.</Txt>
      </View>
    </View>
    <Divider />
    <HowItWorks />
  </Card>;
}

/** Opens the phone's Bluetooth settings: apps can't switch Bluetooth on by themselves on iPhone. */
export function openBluetoothSettings(): void {
  if (Platform.OS === 'android') void Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings());
  else void Linking.openSettings().catch(() => {});
}

/** The SOS bar: always at the bottom. Red is used only here. It asks once before sending. */
export function SosBar({ sos, onSend, onCancel }: { sos: RelayItem | null; onSend: () => void; onCancel: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { c } = useTheme();
  const s = useStyles(makeStyles);
  if (!sos && confirming) return <View style={[s.sos, { flexDirection: 'column', alignItems: 'stretch', gap: t.space.s3, padding: t.space.s5 }]}>
    <Txt variant="title2" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 30 }}>Send SOS?</Txt>
    <Txt>It asks for help and sends where you are.</Txt>
    <View style={local.row}>
      <Button title="Send SOS" variant="danger" style={{ flex: 1 }} onPress={() => { setConfirming(false); onSend(); }} />
      <Button title="Cancel" variant="outline" onPress={() => setConfirming(false)} />
    </View>
  </View>;
  if (!sos) return <View style={s.sos}>
    <Icon name="warning" color={c.red} size={26} />
    <Txt variant="bodyStrong" style={{ flex: 1 }}>In danger? Ask for help.</Txt>
    <Button title="SOS" label="SOS. Ask for help" variant="danger" style={{ minWidth: 76 }} onPress={() => setConfirming(true)} />
  </View>;
  const word = sos.status === 'sending' ? 'Sending SOS'
    : sos.status === 'delivered' ? `SOS delivered to ${SOS_RECIPIENT}.` : 'SOS not sent yet. The app keeps trying.';
  return <View style={s.sos} accessibilityLiveRegion="assertive">
    {sos.status === 'sending' ? <Icon name="sos" color={c.red} size={26} />
      : <StateIcon kind={sos.status === 'delivered' ? 'done' : 'waiting'} size={26} />}
    <Txt variant="bodyStrong" style={{ flex: 1 }}>{word}</Txt>
    <Button title="Cancel SOS" variant="outline" onPress={onCancel} style={{ borderColor: c.lineStrong }} />
  </View>;
}

/** "Ask anything". No badge, no "online". Each message shows what happened to it. */
export function AskBox({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const ready = trim(text) !== '';
  const send = () => { if (!ready) return; onSend(text); setText(''); };
  return <View style={s.ask}>
    <TextInput accessibilityLabel="Ask anything" placeholder="Ask anything" placeholderTextColor={c.ink2} value={text}
      onChangeText={value => setText(prefixBytes(value, MAX_QUESTION_BYTES))} onSubmitEditing={send} returnKeyType="send" submitBehavior="blurAndSubmit"
      style={[textStyle('body'), s.input, { fontSize: 19 }]} />
    <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={send}
      style={({ pressed }) => [s.send, !ready && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
      <Icon name="arrow-upward" color={c.onInk} size={26} />
    </Pressable>
  </View>;
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.s3 },
  how: { flexDirection: 'row', alignItems: 'center', gap: t.space.s3, minHeight: t.target },
});

const makeStyles = (c: Palette) => StyleSheet.create({
  sos: {
    flexDirection: 'row', alignItems: 'center', gap: t.space.s3, backgroundColor: c.redTint, borderWidth: 1, borderColor: c.redFill + '66',
    borderRadius: t.radius.m, paddingVertical: t.space.s2, paddingLeft: t.space.s5, paddingRight: t.space.s2, minHeight: 64,
  },
  ask: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: c.lineStrong, borderRadius: t.radius.m,
    paddingLeft: t.space.s5, paddingRight: t.space.s2, minHeight: 64, backgroundColor: c.surface,
  },
  input: { flex: 1, color: c.ink, minHeight: t.target, paddingVertical: t.space.s2 },
  send: { width: 52, height: 48, borderRadius: t.radius.m, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
});
