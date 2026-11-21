import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, ScrollViewInstance, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Briefing } from './components/Briefing';
import { DeveloperPanel } from './components/DeveloperPanel';
import { Dock } from './components/Dock';
import { FamilySheet, FirstAidSheet, PinSheet, PlacesSheet, Sheet, SheetState } from './components/Sheets';
import { Thread } from './components/Thread';
import { Topics } from './components/Topics';
import { Txt } from './components/ui';
import { peerMessages } from './store/MeshStore';
import { AppRuntime, RuntimeProvider, useAsk, useAskHistory, useLocation, useMesh, useNews, useRuntime, useSos } from './store/Runtime';
import { tokens as t } from './theme/tokens';

/**
 * One screen, built to design/components.html (the benchmark):
 *   What's going on?  — the briefing, first and largest
 *   What you can find — six topics; each opens a sheet with its map
 *   Your messages     — questions and what happened to them, and messages from people nearby
 *   Dock (pinned)     — a notice only when needed, the SOS bar, and "Ask anything"
 */
function AppShell() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const session = useAsk();
  const history = useAskHistory();
  const sos = useSos();
  const news = useNews();
  const location = useLocation();
  const [sheet, setSheet] = useState<SheetState>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const close = () => setSheet(null);

  // New things in the thread scroll into view; the briefing never jumps.
  const threadSize = history.length + (session.state === 'idle' ? 0 : 1) + peerMessages(mesh).length;
  const threadKey = `${threadSize}:${session.state}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (threadSize > 0) scroll.current?.scrollToEnd({ animated: true });
  }, [threadKey, threadSize]);

  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
    <StatusBar style="light" />
    <KeyboardAvoidingView style={s.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} testID="main-scroll" contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {runtime.kind === 'simulated' && <View style={s.demo}>
          <View style={s.demoTag}><Txt variant="label">Demo</Txt></View>
          <Txt variant="caption" muted style={{ flex: 1 }}>Example answers. Nothing leaves this phone.</Txt>
        </View>}
        <Briefing news={news} />
        <Topics news={news} onOpen={key => setSheet({ kind: 'topic', key })} />
        <Thread session={session} history={history} mesh={mesh} news={news}
          openTopic={key => setSheet({ kind: 'topic', key })} openPin={focus => setSheet({ kind: 'pin', focus })} />
        <DeveloperPanel />
      </ScrollView>
      <Dock mesh={mesh} ask={session} sos={sos} location={location} />
    </KeyboardAvoidingView>
    <Sheet sheet={sheet} onClose={close}>
      {sheet?.kind === 'topic' && sheet.key === 'firstaid' && <FirstAidSheet onClose={close} />}
      {sheet?.kind === 'topic' && sheet.key === 'family' && <FamilySheet mesh={mesh} location={location} onClose={close} />}
      {sheet?.kind === 'topic' && sheet.key !== 'firstaid' && sheet.key !== 'family' &&
        <PlacesSheet topicKey={sheet.key} news={news} location={location} onClose={close} onAsk={question => { close(); runtime.ask.ask(question, null); }} />}
      {sheet?.kind === 'pin' && <PinSheet focus={sheet.focus} location={location} onClose={close} />}
    </Sheet>
  </SafeAreaView>;
}

export function MeshApp({ runtime }: { runtime: AppRuntime }) {
  return <SafeAreaProvider><RuntimeProvider runtime={runtime}><AppShell /></RuntimeProvider></SafeAreaProvider>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.color.surface },
  frame: { flex: 1, width: '100%', maxWidth: t.contentWidth, alignSelf: 'center', backgroundColor: t.color.surface },
  content: { paddingTop: t.space.xs, paddingHorizontal: t.space.gutter, paddingBottom: t.space.lg },
  demo: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, marginBottom: t.space.md },
  demoTag: { borderWidth: 1, borderColor: t.color.lineStrong, borderRadius: t.radius.xs, paddingHorizontal: 5, paddingVertical: 1 },
});
