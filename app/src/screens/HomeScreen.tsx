import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, ScrollViewInstance, StyleSheet, View } from 'react-native';
import { TopicId } from '../briefing/types';
import { BriefingFacts, BriefingHeader, TopicGrid } from '../components/BriefingView';
import { DeveloperPanel } from '../components/DeveloperPanel';
import { AskBox, LinkCard, openBluetoothSettings, SosBar } from '../components/Dock';
import { Thread } from '../components/Thread';
import { TopicSheet } from '../components/TopicSheet';
import { DEMO_CONTACT } from '../relay/RelayStore';
import { useBriefing, useLocation, useMesh, useQuestions, useRelay, useRuntime } from '../store/Runtime';
import { useStyles } from '../theme/theme';
import { Palette, tokens as t } from '../theme/tokens';

/** How long the app waits for any phone nearby before saying "Not getting through". */
export const QUIET_GRACE_MS = 5_000;

/**
 * The one screen. What's happening first, then what you can find, then the
 * three questions and your messages. SOS and "Ask anything" stay at the bottom.
 * No connection status: each message says what happened to it.
 */
export function HomeScreen() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const briefing = useBriefing();
  const questions = useQuestions();
  const relay = useRelay();
  const location = useLocation();
  const s = useStyles(makeStyles);
  const scroll = useRef<ScrollViewInstance>(null);
  const [topic, setTopic] = useState<TopicId | null>(null);
  const [quiet, setQuiet] = useState(false);

  const nobodyNear = mesh.link === 'running' && !mesh.peers.some(peer => peer.reachable);
  useEffect(() => {
    if (!nobodyNear) { setQuiet(false); return; }
    const timer = setTimeout(() => setQuiet(true), QUIET_GRACE_MS);
    return () => clearTimeout(timer);
  }, [nobodyNear]);
  const stuck = questions.some(item => item.status === 'notSent' || item.status === 'noAnswer')
    || relay.sos?.status === 'notSent' || relay.family.some(item => item.status === 'notSent');
  const notGettingThrough = mesh.link === 'stopped' || (mesh.link === 'running' && (quiet || stuck));

  const ask = (text: string) => {
    if (runtime.questions.submit(text)) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };
  const bluetooth = () => runtime.simulation ? runtime.simulation.setBluetooth(true) : openBluetoothSettings();

  return <KeyboardAvoidingView style={s.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} testID="main-scroll" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <BriefingHeader briefing={briefing} />
      <TopicGrid briefing={briefing} onOpen={setTopic} />
      <View style={{ gap: t.space.s8 }}>
        <BriefingFacts briefing={briefing} />
        {questions.length > 0 && <Thread items={questions} />}
      </View>
      <DeveloperPanel />
    </ScrollView>
    <View style={s.dock}>
      <LinkCard link={mesh.link} notGettingThrough={notGettingThrough} onBluetooth={bluetooth} />
      <SosBar sos={relay.sos} onCancel={() => runtime.relay.cancelSos()}
        onSend={() => runtime.relay.sendSos(location.kind === 'ready' ? location.position : null)} />
      <AskBox onSend={ask} />
    </View>
    <TopicSheet topic={topic} briefing={briefing} family={relay.family} onClose={() => setTopic(null)}
      onAsk={ask} onFamily={text => runtime.relay.sendFamily(DEMO_CONTACT, text)} />
  </KeyboardAvoidingView>;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  frame: { flex: 1, width: '100%', maxWidth: t.contentWidth, alignSelf: 'center', backgroundColor: c.surface },
  content: { paddingHorizontal: t.space.s5, paddingBottom: t.space.s8, gap: t.space.s12 - t.space.s2 },
  dock: { gap: t.space.s3, paddingHorizontal: t.space.s3, paddingTop: t.space.s3, paddingBottom: t.space.s2, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.surface },
});
