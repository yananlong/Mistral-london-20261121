import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BriefingView, formatTime, Place, TopicId } from '../briefing/types';
import { FIRST_AID, FirstAidGuide } from '../content/firstAid';
import { TOPICS } from '../content/topics';
import OfflineMap from '../map/OfflineMap';
import { MapPoint } from '../map/types';
import { DEMO_CONTACT, RelayItem } from '../relay/RelayStore';
import { useLocation } from '../store/Runtime';
import { useStyles, useTheme } from '../theme/theme';
import { Palette, tokens as t } from '../theme/tokens';
import { relayShown, SentMessage } from './Thread';
import { Button, Divider, Icon, StateLine, Txt } from './ui';

/** One topic at a time, in a sheet that slides up over the home screen. */
export function TopicSheet({ topic, briefing, family, onClose, onAsk, onFamily }: {
  topic: TopicId | null; briefing: BriefingView; family: RelayItem[];
  onClose: () => void; onAsk: (question: string) => void; onFamily: (text: string) => void;
}) {
  const s = useStyles(makeStyles);
  const { reduceMotion } = useTheme();
  return <Modal visible={topic !== null} transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
    <View style={s.scrim}>
      <Pressable style={{ flex: 1 }} accessibilityLabel="Close" onPress={onClose} />
      {topic && <SafeAreaView edges={['bottom']} style={s.sheet}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.top}>
            <Icon name={TOPICS[topic].icon} size={44} />
            <Button title="Close" icon="close" variant="outline" onPress={onClose} style={{ minWidth: 120 }} />
          </View>
          <Txt variant="title1" accessibilityRole="header" style={{ fontSize: 34, lineHeight: 40 }}>{TOPICS[topic].question}</Txt>
          {topic === 'family' ? <Family items={family} onSend={onFamily} />
            : topic === 'firstAid' ? <FirstAid />
              : <Places places={briefing.places[topic] ?? []} onAsk={() => { onAsk(TOPICS[topic].question); onClose(); }} />}
        </ScrollView>
      </SafeAreaView>}
    </View>
  </Modal>;
}

function Places({ places, onAsk }: { places: Place[]; onAsk: () => void }) {
  const { c } = useTheme();
  const location = useLocation();
  const [shown, setShown] = useState<Place | null>(null);
  if (!places.length) return <View style={{ gap: t.space.s4 }}>
    <StateLine kind="waiting" strong>Nothing yet</StateLine>
    <Txt color={c.ink2}>Nobody has shared this yet. You can still ask.</Txt>
    <Button title="Ask" icon="arrow-upward" onPress={onAsk} />
  </View>;
  const points: MapPoint[] = [];
  if (location.kind === 'ready') points.push({ id: 'self', label: 'You', position: location.position, kind: 'self' });
  if (shown) points.push({ id: shown.id, label: shown.name, position: shown.position, kind: 'focus' });
  return <View>
    {shown && <View style={{ gap: t.space.s3, paddingBottom: t.space.s4 }}>
      <OfflineMap points={points} focus={{ position: shown.position, label: shown.name }} />
      <Button title="Hide map" variant="outline" onPress={() => setShown(null)} />
    </View>}
    {places.map(place => <View key={place.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.distance}. ${place.detail} Show on map`}
        onPress={() => setShown(place)} style={({ pressed }) => [local.place, pressed && { opacity: 0.7 }]}>
        <Icon name="location-on" size={28} />
        <View style={{ flex: 1, gap: t.space.s1 }}>
          <Txt variant="title2" style={{ fontSize: 20 }}>{place.name}</Txt>
          <Txt variant="bodyStrong" color={c.ink2}>{place.distance}</Txt>
          <Txt style={{ fontSize: 19, lineHeight: 27, marginTop: t.space.s1 }}>{place.detail}</Txt>
          <Txt variant="caption" style={{ fontSize: 15 }}>From {place.source}, {formatTime(place.at)}</Txt>
        </View>
      </Pressable>
      <Divider />
    </View>)}
  </View>;
}

/** Two ready messages, so nobody has to type. The contact gets it as a normal text message. */
function Family({ items, onSend }: { items: RelayItem[]; onSend: (text: string) => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const contact = DEMO_CONTACT;
  return <View style={{ gap: t.space.s5 }}>
    <View style={s.contact}>
      <View style={s.avatar}><Icon name="person" size={30} /></View>
      <View style={{ flex: 1, gap: t.space.s1 }}>
        <Txt variant="title2" style={{ fontSize: 20 }}>{contact.name}</Txt>
        <Txt variant="caption" style={{ fontSize: 15 }}>Gets it as a text message, {contact.number}</Txt>
      </View>
    </View>
    <View style={{ flexDirection: 'row', gap: t.space.s3 }}>
      <Button title="I'm OK" style={{ flex: 1 }} label={`Send I'm OK to ${contact.name}`} onPress={() => onSend("I'm OK.")} />
      <Button title="I need help" variant="outline" style={{ flex: 1 }} label={`Send I need help to ${contact.name}`} onPress={() => onSend('I need help.')} />
    </View>
    {items.map(item => <SentMessage key={item.id} text={item.text} shown={relayShown(item.status, contact.name)} />)}
    {!items.length && <Txt variant="caption" color={c.ink2} style={{ fontSize: 15 }}>Tap one to send it.</Txt>}
  </View>;
}

/** First aid works on the phone. One step at a time. */
function FirstAid() {
  const [guide, setGuide] = useState<FirstAidGuide | null>(null);
  const [step, setStep] = useState(0);
  const { c } = useTheme();
  if (!guide) return <View>
    <StateLine kind="found" variant="body">On your phone. Works without Bluetooth.</StateLine>
    <View style={{ height: t.space.s4 }} />
    {FIRST_AID.map(item => <View key={item.id}><Divider />
      <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => { setGuide(item); setStep(0); }}
        style={({ pressed }) => [local.guide, pressed && { opacity: 0.7 }]}>
        <Txt variant="title2" style={{ flex: 1, fontSize: 20 }}>{item.title}</Txt>
        <Icon name="chevron-right" color={c.ink2} />
      </Pressable></View>)}
    <Divider />
  </View>;
  const last = step === guide.steps.length - 1;
  return <View style={{ gap: t.space.s5 }}>
    <Txt variant="bodyStrong" color={c.ink2}>{guide.title}. Step {step + 1} of {guide.steps.length}</Txt>
    <Txt variant="title1" accessibilityLiveRegion="polite">{guide.steps[step]}</Txt>
    <View style={{ flexDirection: 'row', gap: t.space.s3 }}>
      <Button title={step === 0 ? 'All first aid' : 'Back'} variant="outline" style={{ flex: 1 }}
        onPress={() => step === 0 ? setGuide(null) : setStep(step - 1)} />
      <Button title={last ? 'Done' : 'Next step'} style={{ flex: 1 }} onPress={() => last ? setGuide(null) : setStep(step + 1)} />
    </View>
  </View>;
}

const local = StyleSheet.create({
  place: { flexDirection: 'row', gap: t.space.s4, paddingVertical: t.space.s5, alignItems: 'flex-start' },
  guide: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: t.space.s3 },
});

const makeStyles = (c: Palette) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    maxHeight: '88%', backgroundColor: c.surface, borderTopLeftRadius: t.radius.l, borderTopRightRadius: t.radius.l,
    borderWidth: 1, borderBottomWidth: 0, borderColor: c.lineStrong + '88', width: '100%', maxWidth: t.contentWidth, alignSelf: 'center',
  },
  content: { padding: t.space.s5, paddingTop: t.space.s6, gap: t.space.s5 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: t.space.s4, borderWidth: 1, borderColor: c.line, borderRadius: t.radius.m, padding: t.space.s4 },
  avatar: { width: 56, height: 56, borderRadius: t.radius.s, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
});
