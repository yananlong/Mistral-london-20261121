import { ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FIRST_AID, NewsKey, placesFor, topic, TopicKey } from '../content/scenario';
import { walkLabel } from '../location/distance';
import { LocationState } from '../location/LocationStore';
import OfflineMap from '../map/OfflineMap';
import { MapFocus, MapPoint } from '../map/types';
import { encodeLocationShare, HUB_NICKNAME, MAX_MESSAGE_BYTES, prefixBytes, trim } from '../protocol';
import { MeshState, ThreadKey } from '../store/MeshStore';
import { useRuntime } from '../store/Runtime';
import { tokens as t } from '../theme/tokens';
import { Delivery } from './Delivery';
import { Button, Icon, NotKnownYet, Toggle, Txt, useReduceMotion } from './ui';

export type SheetState = { kind: 'topic'; key: TopicKey } | { kind: 'pin'; focus: MapFocus } | null;

/** One topic at a time, in a sheet that slides up (design: "Sheet: one topic at a time"). */
export function Sheet({ sheet, onClose, children }: { sheet: SheetState; onClose: () => void; children: ReactNode }) {
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const title = sheet?.kind === 'topic' ? topic(sheet.key).label : sheet?.kind === 'pin' ? sheet.focus.label : '';
  return <Modal visible={sheet !== null} transparent animationType={reduce ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
    <View style={sh.wrap}>
      {/* Tapping outside closes it too; screen readers use the Close button instead. */}
      <Pressable style={sh.scrim} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden onPress={onClose} />
      <View style={[sh.sheet, { paddingBottom: Math.max(insets.bottom, t.space.lg) }]} accessibilityViewIsModal accessibilityLabel={title}>
        <ScrollView contentContainerStyle={{ paddingBottom: t.space.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}

function Top({ icon, title, onClose }: { icon: Parameters<typeof Icon>[0]['name']; title: string; onClose: () => void }) {
  return <View>
    <View style={sh.top}><Icon name={icon} size={32} /><Button kind="line" small icon="close" title="Close" onPress={onClose} /></View>
    <Txt variant="title1" accessibilityRole="header" style={{ marginTop: t.space.sm }}>{title}</Txt>
  </View>;
}

const selfPoint = (location: LocationState): MapPoint[] =>
  location.kind === 'ready' ? [{ id: 'self', label: 'You', position: location.position, kind: 'self' }] : [];

/** A topic opens on the map stored on the phone, every place pinned and numbered like the list under it. */
export function PlacesSheet({ topicKey, news, location, onClose, onAsk }: {
  topicKey: TopicKey; news: NewsKey; location: LocationState; onClose: () => void; onAsk: (question: string) => void;
}) {
  const item = topic(topicKey);
  const places = placesFor(topicKey, news);
  const points: MapPoint[] = [...selfPoint(location), ...(places ?? []).map((place, i) => ({ id: place.id, label: place.name, position: place.position, kind: 'place' as const, number: i + 1 }))];
  return <View>
    <Top icon={item.icon} title={item.question} onClose={onClose} />
    {points.length > 0 && <View style={{ marginTop: t.space.sm }}><OfflineMap points={points} focus={null} height={places ? 220 : 160} /></View>}
    {!places ? <View style={sh.empty}>
      <NotKnownYet />
      <Txt muted>Nobody has shared this yet.</Txt>
      <Button kind="line" small icon="arrow-upward" title="Ask anyway" label={`Ask anyway: ${item.question}`} onPress={() => onAsk(item.question)} />
    </View> : <View style={{ marginTop: t.space.sm }}>
      {places.map((place, i) => <View key={place.id} style={sh.place}>
        <View style={sh.pn}><Txt variant="label" style={{ color: t.color.onInk }}>{i + 1}</Txt></View>
        <View style={{ flex: 1 }}>
          <Txt strong>{place.name}</Txt>
          {location.kind === 'ready' && <Txt variant="callout" muted>{walkLabel(location.position, place.position)}</Txt>}
          <Txt style={{ marginTop: 4 }}>{place.text}</Txt>
          <Txt variant="caption" muted style={{ marginTop: 4 }}>{place.source}</Txt>
        </View>
      </View>)}
    </View>}
  </View>;
}

/** First aid: on the phone, always works. One guide open at a time, one step per line. */
export function FirstAidSheet({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return <View>
    <Top icon="medical-services" title={topic('firstaid').question} onClose={onClose} />
    <View style={{ marginTop: t.space.sm }}>
      {FIRST_AID.map(guide => {
        const expanded = open === guide.title;
        return <View key={guide.title} style={sh.guideWrap}>
          <Pressable accessibilityRole="button" accessibilityLabel={guide.title} accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : guide.title)} style={sh.guide}>
            <Icon name="medical-services" size={20} />
            <Txt strong style={{ flex: 1 }}>{guide.title}</Txt>
            <Icon name={expanded ? 'expand-less' : 'expand-more'} size={20} color={t.color.ink2} />
          </Pressable>
          {expanded && <View style={{ paddingBottom: t.space.sm, gap: t.space.xs }}>
            {guide.steps.map((step, i) => <View key={step} style={sh.step}>
              <View style={sh.pn}><Txt variant="label" style={{ color: t.color.onInk }}>{i + 1}</Txt></View>
              <Txt style={{ flex: 1 }}>{step}</Txt>
            </View>)}
          </View>}
        </View>;
      })}
    </View>
    <Txt variant="callout" muted style={{ marginTop: t.space.sm }}>These guides are on your phone. They always work.</Txt>
  </View>;
}

/** Family: ready messages so nobody has to type, sent over Bluetooth to the person you pick. */
export function FamilySheet({ mesh, location, onClose }: { mesh: MeshState; location: LocationState; onClose: () => void }) {
  const runtime = useRuntime();
  const people = Object.values(mesh.knownPeers).filter(peer => peer.id !== mesh.hubId && peer.nickname !== HUB_NICKNAME);
  const [to, setTo] = useState<ThreadKey>('public');
  const [text, setText] = useState('');
  const [confirmLocation, setConfirmLocation] = useState(false);
  const toName = to === 'public' ? 'everyone nearby' : mesh.knownPeers[to]?.nickname ?? 'them';
  const send = (message: string) => { void runtime.mesh.send(to, message).catch(() => {}); };
  const last = [...(mesh.conversations[to] ?? [])].reverse().find(message => message.direction === 'out');
  return <View>
    <Top icon="family-restroom" title={topic('family').question} onClose={onClose} />
    <Txt variant="callout" muted style={{ marginTop: t.space.sm, marginBottom: t.space.xs }}>Send to</Txt>
    <View style={sh.choices}>
      <Toggle title="Everyone nearby" selected={to === 'public'} onPress={() => setTo('public')} />
      {people.map(person => <Toggle key={person.id} icon="person" title={person.nickname} selected={to === person.id} onPress={() => setTo(person.id)} />)}
    </View>
    {to !== 'public' && !mesh.peers.some(peer => peer.id === to && peer.reachable) &&
      <Txt variant="caption" muted style={{ marginTop: t.space.xs }}>Not nearby right now. It may not reach them.</Txt>}
    <View style={sh.acts}>
      <Button title="I'm OK" label={`Send I'm OK to ${toName}`} onPress={() => send("I'm OK.")} style={{ flex: 1 }} />
      <Button kind="line" title="I need help" label={`Send I need help to ${toName}`} onPress={() => send('I need help.')} style={{ flex: 1 }} />
    </View>
    <View style={[sh.write, { marginTop: t.space.xs }]}>
      <TextInput accessibilityLabel="Write a message" placeholder="Write a message" placeholderTextColor={t.color.ink2} value={text}
        onChangeText={value => setText(prefixBytes(value, MAX_MESSAGE_BYTES))} style={sh.input} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Send message to ${toName}`} onPress={() => { if (trim(text)) { send(trim(text)); setText(''); } }} style={sh.send}>
        <Icon name="arrow-upward" size={20} color={t.color.onInk} />
      </Pressable>
    </View>
    {location.kind === 'ready' && (!confirmLocation
      ? <Button kind="line" small icon="location-on" title="Send where I am" label={`Send where I am to ${toName}`} onPress={() => setConfirmLocation(true)} style={{ marginTop: t.space.xs, alignSelf: 'flex-start' }} />
      : <View style={sh.confirm}>
        <Txt strong>Send where you are to {toName}?</Txt>
        <View style={sh.acts}>
          <Button title="Send" label="Send my location" onPress={() => { send(encodeLocationShare(null, location.position.lat, location.position.lon)); setConfirmLocation(false); }} style={{ flex: 1 }} />
          <Button kind="line" title="Cancel" label="Don't send my location" onPress={() => setConfirmLocation(false)} />
        </View>
      </View>)}
    {last && <View style={{ marginTop: t.space.md, alignItems: 'flex-end' }}>
      {last.status === 'sending' ? <Delivery bars={1} text="Sending" />
        : last.status === 'failed' ? <Delivery bars={0} text="Not sent" tone="wait" />
          : <Delivery bars={3} text={`Sent to ${toName}`} tone="ok" />}
    </View>}
  </View>;
}

/** A location someone shared, on the same map. */
export function PinSheet({ focus, location, onClose }: { focus: MapFocus; location: LocationState; onClose: () => void }) {
  const points: MapPoint[] = [...selfPoint(location), { id: 'focus', label: focus.label, position: focus.position, kind: 'peer' }];
  return <View>
    <Top icon="location-on" title={focus.label === 'You' ? 'Where you are' : `Where ${focus.label} is`} onClose={onClose} />
    <View style={{ marginTop: t.space.sm }}><OfflineMap points={points} focus={focus} height={240} /></View>
    {location.kind === 'ready' && focus.label !== 'You' && <Txt variant="callout" muted style={{ marginTop: t.space.xs }}>{walkLabel(location.position, focus.position)}</Txt>}
    <Txt variant="caption" muted style={{ marginTop: t.space.xs }}>Where they were when they sent it. They may have moved.</Txt>
  </View>;
}

const sh = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: t.color.scrim },
  sheet: { maxHeight: '88%', backgroundColor: t.color.surface, borderTopWidth: 1, borderColor: t.color.lineStrong, borderTopLeftRadius: t.radius.l, borderTopRightRadius: t.radius.l, paddingTop: t.space.sm, paddingHorizontal: t.space.gutter, width: '100%', maxWidth: t.contentWidth, alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.space.sm },
  empty: { marginTop: t.space.md, gap: t.space.xs, alignItems: 'flex-start' },
  place: { paddingVertical: 14, borderBottomWidth: 1, borderColor: t.color.line, flexDirection: 'row', gap: 10 },
  pn: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.ink, alignItems: 'center', justifyContent: 'center' },
  guideWrap: { borderBottomWidth: 1, borderColor: t.color.line },
  guide: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },
  acts: { marginTop: t.space.sm, flexDirection: 'row', gap: t.space.xs },
  write: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, height: 52, borderRadius: t.radius.m, borderWidth: 1, borderColor: t.color.lineStrong, paddingLeft: t.space.md, paddingRight: 6 },
  input: { flex: 1, minWidth: 0, color: t.color.ink, fontFamily: t.font.regular, fontSize: 17, height: '100%' },
  send: { width: 40, height: 40, borderRadius: t.radius.s, backgroundColor: t.color.ink, alignItems: 'center', justifyContent: 'center' },
  confirm: { marginTop: t.space.sm, borderWidth: 1, borderColor: t.color.line, borderRadius: t.radius.m, padding: t.space.sm },
});
